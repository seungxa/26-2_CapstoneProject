"""Local follow-up model runner: lazy loading, one generation at a time, a time limit, and /health status.

No real model is loaded here. `fake_followup` swaps `followup_model._loader`, and the default loader is
checked against stand-in `llama_cpp` / `huggingface_hub` modules.
"""
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import followup_model
from app.config import ConfigError, Settings, settings
from app.followup_text import build_messages

BACKEND = Path(__file__).resolve().parent.parent
Q = "팀 프로젝트에서 갈등을 해결한 경험을 말해 주세요."
A = "일정이 밀려서 제가 작업을 다시 나누고 팀원과 마감을 맞췄습니다."
GOOD = "그때 본인이 맡은 역할은 무엇이었나요?"


def ask() -> followup_model.FollowupResult:
    return followup_model.generate(Q, A, "specificity")


def wait_until(check, timeout: float = 5.0) -> None:
    end = time.monotonic() + timeout
    while not check():
        assert time.monotonic() < end, "condition not reached in time"
        time.sleep(0.01)


# ───────── the brief's cases ─────────

def test_off_mode_returns_off_without_loading(fake_followup, monkeypatch):
    monkeypatch.setattr(settings, "followup_model", "off")
    r = ask()
    assert (r.text, r.fallback_reason) == (None, "off") and r.elapsed_ms >= 0
    followup_model.preload()
    assert fake_followup.loads == 0 and fake_followup.calls == []
    assert followup_model.status() == {"mode": "off", "available": False, "model": None, "state": "idle", "error": None}


def test_valid_reply_is_returned(fake_followup):
    r = ask()
    assert r == followup_model.FollowupResult(GOOD, None, r.elapsed_ms)
    [call] = fake_followup.calls
    assert call["messages"] == build_messages(Q, A, "specificity")
    assert (call["max_tokens"], call["temperature"]) == (96, 0.3)


def test_invalid_reply_reports_reason(fake_followup):
    fake_followup.reply = "What was your role in that project?"
    r = ask()
    assert (r.text, r.fallback_reason) == (None, "not_korean")


def test_missing_library_falls_back(fake_followup):
    fake_followup.load_error = ImportError("No module named 'llama_cpp'")
    r = ask()
    assert (r.text, r.fallback_reason) == (None, "unavailable")
    st = followup_model.status()
    assert st["mode"] == "local" and st["available"] is False and st["state"] == "error"
    assert "not installed" in st["error"]
    assert fake_followup.calls == []


def test_download_failure_falls_back(fake_followup):
    fake_followup.load_error = OSError("Connection refused")
    first, second = ask(), ask()
    assert (first.text, first.fallback_reason) == (second.text, second.fallback_reason) == (None, "unavailable")
    assert fake_followup.loads == 1  # the failure is remembered: no new download attempt per request
    st = followup_model.status()
    assert st["available"] is False and st["state"] == "error" and "could not be downloaded" in st["error"]
    assert "Connection refused" not in st["error"]  # /health is public: no raw exception text


def test_slow_generation_times_out_to_template(fake_followup, monkeypatch):
    monkeypatch.setattr(settings, "followup_timeout_sec", 0.2)
    fake_followup.delay = 1.0
    started = time.monotonic()
    first = ask()
    assert (first.text, first.fallback_reason) == (None, "timeout")
    assert time.monotonic() - started < 0.5
    time.sleep(1.0)
    # Only the slow first call must hit the limit: a generous one keeps this step free of timing flakes.
    monkeypatch.setattr(settings, "followup_timeout_sec", 5.0)
    second = ask()
    assert (second.text, second.fallback_reason) == (GOOD, None)
    one, two = fake_followup.calls
    assert one["end"] is not None and one["end"] <= two["start"]  # one generation at a time


def test_loads_once_and_reuses(fake_followup):
    results = [ask() for _ in range(3)]
    assert [r.text for r in results] == [GOOD] * 3
    assert fake_followup.loads == 1 and len(fake_followup.calls) == 3
    assert followup_model.status()["state"] == "ready"


def test_health_reports_followup_status(client, fake_followup):
    st = client.get("/health").json()["followup"]
    assert st == {"mode": "local", "available": True, "state": "idle", "error": None,
                  "model": f"{settings.followup_model_repo}/{settings.followup_model_file}"}
    assert fake_followup.loads == 0  # /health never loads the model
    ask()
    st = client.get("/health").json()["followup"]
    assert st["mode"] == "local" and st["available"] is True and st["state"] == "ready"


# ───────── waiting, errors, preload ─────────

def test_tests_run_with_the_model_off(client):
    assert settings.followup_model == "off"
    assert client.get("/health").json()["followup"]["mode"] == "off"


def test_generation_error_falls_back_and_keeps_the_model(fake_followup):
    fake_followup.reply = RuntimeError("llama_decode returned -1")
    assert ask().fallback_reason == "error"
    fake_followup.reply = GOOD
    assert ask().text == GOOD
    assert fake_followup.loads == 1 and followup_model.status()["state"] == "ready"


def test_waiting_for_a_busy_model_counts_toward_the_limit(fake_followup, monkeypatch):
    monkeypatch.setattr(settings, "followup_timeout_sec", 5.0)
    fake_followup.delay = 1.0
    running = threading.Thread(target=ask)
    running.start()
    wait_until(lambda: fake_followup.calls)  # the first request holds the model
    monkeypatch.setattr(settings, "followup_timeout_sec", 0.2)
    started = time.monotonic()
    r = ask()
    assert (r.text, r.fallback_reason) == (None, "timeout")
    assert time.monotonic() - started < 0.5
    running.join(5)
    assert len(fake_followup.calls) == 1  # the waiting request never reached the model


def test_concurrent_requests_run_one_at_a_time(fake_followup, monkeypatch):
    monkeypatch.setattr(settings, "followup_timeout_sec", 5.0)
    fake_followup.delay = 0.3
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: ask(), range(2)))
    assert [r.text for r in results] == [GOOD, GOOD]
    one, two = sorted(fake_followup.calls, key=lambda c: c["start"])
    assert one["end"] <= two["start"]
    assert fake_followup.loads == 1


def test_preload_loads_once_for_later_requests(fake_followup):
    followup_model.preload()
    assert followup_model.status()["state"] == "ready" and fake_followup.loads == 1
    assert ask().text == GOOD and fake_followup.loads == 1


def test_preload_failure_does_not_raise(fake_followup):
    fake_followup.load_error = ValueError("Failed to load model from file")
    followup_model.preload()
    st = followup_model.status()
    assert st["state"] == "error" and st["available"] is False and st["error"]
    assert ask().fallback_reason == "unavailable" and fake_followup.loads == 1


def test_preload_setting_loads_the_model_at_startup(fake_followup, monkeypatch):
    from app.main import app

    monkeypatch.setattr(settings, "followup_preload", True)
    with TestClient(app):
        wait_until(lambda: followup_model.status()["state"] == "ready")
    assert fake_followup.loads == 1


def test_health_reports_a_missing_library_before_loading(client, monkeypatch):
    monkeypatch.setattr(settings, "followup_model", "local")
    monkeypatch.setattr(followup_model, "_runner", followup_model._Runner(installed=False))
    st = client.get("/health").json()["followup"]
    assert st["available"] is False and st["state"] == "idle" and "not installed" in st["error"]


# ───────── default loader (stand-in libraries) ─────────

@pytest.fixture
def libs(monkeypatch):
    """Stand-in llama_cpp and huggingface_hub so the real loader runs without the packages or a network."""
    rec = SimpleNamespace(cached=True, downloads=[], models=[])

    def hf_hub_download(repo_id, filename, cache_dir=None, local_files_only=False):
        rec.downloads.append({"repo_id": repo_id, "filename": filename, "cache_dir": cache_dir,
                              "local_files_only": local_files_only})
        if local_files_only and not rec.cached:
            raise FileNotFoundError("not in the disk cache")  # like huggingface_hub's LocalEntryNotFoundError
        rec.cached = True
        return f"/cache/{filename}"

    class Llama:
        def __init__(self, **kwargs):
            rec.models.append(kwargs)

    hub, llama = ModuleType("huggingface_hub"), ModuleType("llama_cpp")
    hub.hf_hub_download, llama.Llama = hf_hub_download, Llama
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setitem(sys.modules, "llama_cpp", llama)
    monkeypatch.setattr(settings, "followup_model_dir", "")
    monkeypatch.setattr(settings, "followup_threads", 2)
    monkeypatch.setattr(settings, "followup_allow_download", True)
    return rec


def test_default_loader_uses_the_cache_without_downloading(libs):
    followup_model._loader(settings)
    assert libs.downloads == [{"repo_id": settings.followup_model_repo, "filename": settings.followup_model_file,
                               "cache_dir": None, "local_files_only": True}]
    assert libs.models == [{"model_path": f"/cache/{settings.followup_model_file}", "n_ctx": 1024,
                            "n_threads": 2, "n_threads_batch": 2, "verbose": False}]


def test_default_loader_downloads_once_when_missing(libs, monkeypatch, tmp_path):
    libs.cached = False
    monkeypatch.setattr(settings, "followup_model_dir", str(tmp_path))
    followup_model._loader(settings)
    assert [d["local_files_only"] for d in libs.downloads] == [True, False]
    assert {d["cache_dir"] for d in libs.downloads} == {str(tmp_path)}
    assert len(libs.models) == 1


def test_default_loader_with_downloads_off_uses_only_the_cache(libs, monkeypatch):
    libs.cached = False
    monkeypatch.setattr(settings, "followup_allow_download", False)
    with pytest.raises(OSError):
        followup_model._loader(settings)
    assert [d["local_files_only"] for d in libs.downloads] == [True]
    assert libs.models == []


def test_importing_the_module_does_not_import_the_model_libraries():
    code = ("import sys, app.followup_model, app.main; "
            "assert not {'llama_cpp', 'huggingface_hub'} & set(sys.modules), sorted(sys.modules)")
    env = {**os.environ, "FOLLOWUP_MODEL": "local", "STT_PROVIDER": "off", "AUTH_DISABLED": "true", "SUPABASE_URL": ""}
    done = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr[-2000:]


# ───────── settings ─────────

def test_followup_settings_defaults():
    s = Settings({})
    assert s.followup_model == "local" and s.followup_model_dir == ""
    assert s.followup_model_repo and s.followup_model_file.endswith(".gguf")
    assert s.followup_threads == min(4, os.cpu_count() or 1)
    assert s.followup_timeout_sec == 45.0
    assert s.followup_allow_download is True and s.followup_preload is False
    s = Settings({"FOLLOWUP_MODEL": " OFF ", "FOLLOWUP_ALLOW_DOWNLOAD": "false", "FOLLOWUP_PRELOAD": "true",
                  "FOLLOWUP_THREADS": "2", "FOLLOWUP_TIMEOUT_SEC": "2.5", "FOLLOWUP_MODEL_DIR": "/models"})
    assert (s.followup_model, s.followup_allow_download, s.followup_preload) == ("off", False, True)
    assert (s.followup_threads, s.followup_timeout_sec, s.followup_model_dir) == (2, 2.5, "/models")


@pytest.mark.parametrize("name,value", [("FOLLOWUP_TIMEOUT_SEC", "soon"), ("FOLLOWUP_TIMEOUT_SEC", "0"),
                                        ("FOLLOWUP_TIMEOUT_SEC", "inf"), ("FOLLOWUP_THREADS", "two"),
                                        ("FOLLOWUP_THREADS", "0")])
def test_bad_followup_numbers_name_the_variable(name, value):
    with pytest.raises(ConfigError, match=name):
        Settings({"AUTH_DISABLED": "true", name: value}).check()
