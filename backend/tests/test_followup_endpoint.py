"""POST /practice/answers/{id}/followup asks the local follow-up model (FakeFollowup here) and falls back to the
rule-based template question. The response shape and the saved values stay as before."""
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import followup_model
from app.config import settings
from app.services import answer_coaching

QUESTION = "성과를 어떻게 측정하셨나요?"
TRANSCRIPT = "저는 캐시를 도입해서 응답 시간을 40% 줄였습니다."


def make_answer(client):
    """A session with one answered question and follow-ups on: (headers, session id, answer id)."""
    h = {"X-User-Id": f"followup-endpoint-{uuid.uuid4()}"}
    q = client.post("/practice/questions", headers=h, json={"category": "직무", "text": QUESTION}).json()
    s = client.post("/practice/sessions", headers=h,
                    json={"mode": "free", "question_ids": [q["id"]], "followups_enabled": True}).json()
    aid = s["answers"][0]["id"]
    r = client.patch(f"/practice/answers/{aid}", headers=h, json={"transcript": TRANSCRIPT})
    assert r.status_code == 200, r.text
    return h, s["id"], aid


def ask(client, h, aid):
    return client.post(f"/practice/answers/{aid}/followup", headers=h)


def test_generated_question_is_used(client, fake_followup, caplog):
    fake_followup.reply = "응답 시간 40%는 어떤 방법으로 측정했나요?"
    h, _, aid = make_answer(client)
    with caplog.at_level(logging.INFO, logger="app.routers.practice"):
        r = ask(client, h, aid)
    assert r.status_code == 201, r.text
    parent, child = r.json()["answers"]
    assert child["question"]["text"] == "응답 시간 40%는 어떤 방법으로 측정했나요?"
    assert child["parent_answer_id"] == aid
    # The caption above the question is not the template's (that one explains the template question)
    template = parent["coaching_report"]["followup"]
    assert child["followup_reason"] == "This follow-up was written from your answer."
    assert child["followup_reason"] != template["reason"]
    # The model saw this question and this answer
    assert len(fake_followup.calls) == 1
    prompt = fake_followup.calls[0]["messages"][-1]["content"]
    assert QUESTION in prompt and TRANSCRIPT in prompt
    assert "followup generated=True reason=None" in caplog.text


@pytest.mark.parametrize("mode", ["invalid", "off"])
def test_invalid_or_off_uses_template(client, fake_followup, monkeypatch, caplog, mode):
    if mode == "off":
        monkeypatch.setattr(settings, "followup_model", "off")
    else:
        fake_followup.reply = "How did you measure the 40% improvement?"
    h, _, aid = make_answer(client)
    with caplog.at_level(logging.INFO, logger="app.routers.practice"):
        r = ask(client, h, aid)
    assert r.status_code == 201, r.text
    parent, child = r.json()["answers"]
    template = parent["coaching_report"]["followup"]
    assert child["question"]["text"] == template["text"]
    assert child["followup_reason"] == template["reason"]
    assert child["parent_answer_id"] == aid
    assert len(fake_followup.calls) == (0 if mode == "off" else 1)
    reason = "off" if mode == "off" else "not_korean"
    assert f"followup generated=False reason={reason}" in caplog.text


def test_model_is_not_called_under_the_session_lock(client, fake_followup, monkeypatch):
    h, _, aid = make_answer(client)
    # Check the answer first: the follow-up request then takes the session lock only for inserting the question
    assert client.post(f"/practice/answers/{aid}/coach", headers=h).status_code == 200
    locks: list[float] = []
    original = answer_coaching.lock_session

    def recording_lock(db, session_id):
        locks.append(time.monotonic())
        return original(db, session_id)

    monkeypatch.setattr(answer_coaching, "lock_session", recording_lock)
    r = ask(client, h, aid)
    assert r.status_code == 201, r.text
    assert len(fake_followup.calls) == 1
    call = fake_followup.calls[0]
    events = sorted([("model", call["start"]), *(("lock", t) for t in locks)], key=lambda e: e[1])
    assert [kind for kind, _ in events] == ["model", "lock"]
    assert call["end"] <= locks[0]


def test_concurrent_followup_requests_create_one_question(client, fake_followup, monkeypatch):
    fake_followup.delay = 0.3
    h, sid, aid = make_answer(client)
    both = threading.Barrier(2)
    original = followup_model.generate

    def together(*args, **kwargs):
        both.wait(timeout=5)  # both requests passed the "already has a follow-up" check before either inserts
        return original(*args, **kwargs)

    monkeypatch.setattr(followup_model, "generate", together)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: ask(client, h, aid), range(2)))
    assert [r.status_code for r in results] == [201, 201], [r.text for r in results]
    assert len(fake_followup.calls) == 2
    saved = client.get(f"/practice/sessions/{sid}", headers=h).json()["answers"]
    assert [a["parent_answer_id"] for a in saved] == [None, aid]
    assert all(len(r.json()["answers"]) == 2 for r in results)


def test_existing_followup_skips_generation(client, fake_followup):
    h, _, aid = make_answer(client)
    first = ask(client, h, aid)
    assert first.status_code == 201, first.text
    assert len(fake_followup.calls) == 1
    fake_followup.calls.clear()
    again = ask(client, h, aid)
    assert again.status_code == 201, again.text
    assert fake_followup.calls == []
    assert [a["id"] for a in again.json()["answers"]] == [a["id"] for a in first.json()["answers"]]
