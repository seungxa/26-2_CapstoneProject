"""scripts/practice-track/deploy/check_server.py: judging /health and /proc/meminfo after a deploy (no network here)."""
import importlib.util

import pytest

from app.config import BASE_DIR

_spec = importlib.util.spec_from_file_location(
    "check_server", BASE_DIR.parent / "scripts" / "practice-track" / "deploy" / "check_server.py")
check_server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_server)


def health(stt_state="ready", followup_state="ready", followup_mode="local", auth_disabled=False, stt_available=True):
    return {"ok": True, "auth_disabled": auth_disabled,
            "stt": {"provider": "local", "available": stt_available, "model": "base", "state": stt_state, "error": None},
            "followup": {"mode": followup_mode, "available": followup_state != "error", "state": followup_state,
                         "error": "The follow-up model could not be loaded." if followup_state == "error" else None,
                         "model": "LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF/EXAONE-4.0-1.2B-Q4_K_M.gguf"}}


def meminfo(used_percent: float, total_kb: int = 4_000_000) -> str:
    available = int(total_kb * (1 - used_percent / 100))
    return f"MemTotal:       {total_kb} kB\nMemFree:          100000 kB\nMemAvailable:   {available} kB\n"


def grades(lines):
    return [grade for grade, _ in lines]


def test_ready_server_passes():
    lines = check_server.evaluate(health(), meminfo(40))
    assert set(grades(lines)) == {"PASS"}, lines
    assert any("40%" in text for _, text in lines)


def test_model_errors_fail():
    lines = check_server.evaluate(health(stt_state="error", followup_state="error"), meminfo(40))
    failed = [text for grade, text in lines if grade == "FAIL"]
    assert len(failed) == 2
    assert any("speech" in t.lower() for t in failed) and any("follow-up" in t.lower() for t in failed)
    assert any("could not be loaded" in t for t in failed)  # the server's own reason is passed on


def test_unavailable_speech_fails():
    assert "FAIL" in grades(check_server.evaluate(health(stt_available=False), meminfo(40)))


def test_loading_models_warn():
    lines = check_server.evaluate(health(stt_state="loading", followup_state="loading"), meminfo(40))
    assert grades(lines).count("WARN") == 2 and "FAIL" not in grades(lines)
    assert all("again in a minute" in text for grade, text in lines if grade == "WARN")


def test_followup_off_warns():
    lines = check_server.evaluate(health(followup_mode="off", followup_state="idle"), meminfo(40))
    assert "WARN" in grades(lines) and "FAIL" not in grades(lines)


def test_auth_disabled_fails():
    assert "FAIL" in grades(check_server.evaluate(health(auth_disabled=True), meminfo(40)))


def test_low_memory_warns_about_reclaim():
    lines = check_server.evaluate(health(), meminfo(10, total_kb=6_000_000))
    [(grade, text)] = [line for line in lines if "memory" in line[1].lower()]
    assert grade == "WARN" and "20%" in text and "10%" in text


@pytest.mark.parametrize("bad", ["", "MemTotal: 0 kB\n", "nonsense"])
def test_unreadable_meminfo_is_a_warning_not_a_crash(bad):
    [(grade, _)] = [line for line in check_server.evaluate(health(), bad) if "memory" in line[1].lower()]
    assert grade == "WARN"
