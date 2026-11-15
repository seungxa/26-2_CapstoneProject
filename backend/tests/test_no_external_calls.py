"""The app uses no paid external API: the whole practice flow runs on local code only.

Network entry points fail the test if anything tries to leave the process. The in-process
TestClient (host "testserver") is the only allowed httpx traffic.
"""
import logging
import socket
import urllib.request
import uuid

import httpx
import pytest

from app import stt
from app.config import Settings, settings

ESSAY = "합성 프로젝트에서 저는 캐시를 도입해 응답 시간을 40% 줄인 경험이 있습니다."
ANSWER = "제가 캐시 구조를 직접 설계하고 팀원과 배포 일정을 맞췄습니다."


@pytest.fixture
def external(monkeypatch):
    """Record and refuse every request that would leave the process."""
    attempts: list[str] = []

    def refuse(what):
        attempts.append(what)
        raise AssertionError(f"external request attempted: {what}")

    real_send = httpx.Client.send

    def send(self, request, *args, **kwargs):
        if request.url.host == "testserver":  # TestClient calls the app in-process
            return real_send(self, request, *args, **kwargs)
        refuse(f"httpx {request.method} {request.url}")

    monkeypatch.setattr(httpx.Client, "send", send)
    monkeypatch.setattr(httpx.AsyncClient, "send", lambda self, request, *a, **k: refuse(f"httpx async {request.url}"))
    monkeypatch.setattr(httpx, "post", lambda url, *a, **k: refuse(f"httpx.post {url}"))
    monkeypatch.setattr(urllib.request, "urlopen", lambda url, *a, **k: refuse(f"urlopen {url}"))
    monkeypatch.setattr(socket.socket, "connect", lambda self, address: refuse(f"socket {address}"))
    return attempts


def test_full_practice_flow_makes_no_external_requests(client, external, monkeypatch):
    # A leftover key (in the environment or on the settings object) must not switch anything on.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test-not-a-real-key", raising=False)
    h = {"X-User-Id": f"no-external-{uuid.uuid4()}"}
    app = client.post("/track/applications", headers=h, json={"company": "합성회사", "position": "백엔드 개발자"})
    assert app.status_code == 201, app.text
    app = app.json()
    essay = client.post(f"/track/applications/{app['id']}/essays", headers=h,
                        json={"question_text": "성과 경험", "content": ESSAY})
    assert essay.status_code == 201, essay.text

    generated = client.post("/practice/questions/generate", headers=h,
                            json={"application_id": app["id"], "essay_text": ESSAY, "count": 3})
    assert generated.status_code == 201, generated.text
    questions = generated.json()
    assert len(questions) == 3 and all(q["source"] == "generated" for q in questions)
    assert {q["tagging_source"] for q in questions} == {"rule"}

    s = client.post("/practice/sessions", headers=h, json={
        "mode": "free", "application_id": app["id"], "question_ids": [q["id"] for q in questions],
        "followups_enabled": True, "essay_basis": "latest"})
    assert s.status_code == 201, s.text
    s = s.json()
    first = s["answers"][0]["id"]
    saved = client.patch(f"/practice/answers/{first}", headers=h, json={"transcript": ANSWER, "self_rating": 3})
    assert saved.status_code == 200, saved.text

    coached = client.post(f"/practice/answers/{first}/coach", headers=h)
    assert coached.status_code == 200, coached.text
    assert coached.json()["coaching_report"]["method"] == "basic"

    follow = client.post(f"/practice/answers/{first}/followup", headers=h)
    assert follow.status_code == 201, follow.text
    child = follow.json()["answers"][1]
    assert child["parent_answer_id"] == first
    second = client.patch(f"/practice/answers/{child['id']}", headers=h, json={"transcript": "저는 배포 전후 응답 시간을 비교했습니다."})
    assert second.status_code == 200, second.text

    finished = client.post(f"/practice/sessions/{s['id']}/finish", headers=h)
    assert finished.status_code == 200, finished.text
    got = client.get(f"/practice/sessions/{s['id']}", headers=h)
    assert got.status_code == 200, got.text
    got = got.json()
    # The debrief job finished: every answer with a transcript has a rule-based report, and no summary was made.
    assert got["debrief_running"] is False and got["finished_at"]
    reports = [a["coaching_report"] for a in got["answers"] if a["transcript"]]
    assert len(reports) == 2 and all(r["method"] == "basic" for r in reports)
    assert got["debrief"] is None and got["debrief_status"] != "done"
    assert got["redrill"], "the essay has a number the answer lacks, so the basic check asks for more detail"

    drill = client.post(f"/practice/sessions/{s['id']}/redrill", headers=h)
    assert drill.status_code == 201, drill.text
    again = client.post(f"/practice/sessions/{s['id']}/debrief", headers=h)
    assert again.status_code == 200, again.text

    assert external == []


def test_openai_settings_are_gone(client, monkeypatch, caplog):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
    with caplog.at_level(logging.WARNING, logger="app.config"):
        Settings().check()  # what the server runs at startup
    assert caplog.text.count("OPENAI_API_KEY is ignored") == 1
    assert "sk-test-not-a-real-key" not in caplog.text
    assert not [name for name in vars(settings) if "openai" in name.lower() and not name.startswith("_")]
    assert "openai" not in stt._PROVIDERS

    health = client.get("/health").json()
    assert set(health) == {"ok", "stt", "auth_disabled", "followup"}

    h = {"X-User-Id": f"no-feedback-{uuid.uuid4()}"}
    s = client.post("/practice/sessions", headers=h, json={"mode": "free", "count": 1}).json()
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", headers=h, json={"transcript": ANSWER})
    assert client.post(f"/practice/answers/{aid}/feedback", headers=h).status_code == 404


def test_no_key_means_no_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="app.config"):
        Settings({"AUTH_DISABLED": "true", "OPENAI_API_KEY": ""}).check()
    assert "OPENAI_API_KEY" not in caplog.text
