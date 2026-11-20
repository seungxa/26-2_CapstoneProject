"""세션 종료 자동 디브리프 작업(보고서가 없는 답변의 기본 점검)과 다시 연습할 답변 고르기.

세션 요약은 만들지 않는다. 예전에 저장된 요약·AI 보고서는 기록으로 읽기만 한다.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event

import pytest

from app import coaching, debrief, llm
from app.db import SessionLocal
from app.models import PracticeAnswer, PracticeSession
from app.routers import practice

T1 = "작년 동아리에서 저는 회계 정리를 맡았고 엑셀 매크로로 정산 시간을 절반으로 줄였습니다."
T2 = "지원 동기는 고객 데이터를 직접 다루는 일을 하고 싶어서입니다."


def _bank(client, h, n):
    qs = client.get("/practice/questions", params={"source": "bank"}, headers=h).json()
    return [q for q in qs if "자기소개" not in q["text"]][:n]


def _session(client, h, n, **body):
    qs = _bank(client, h, n)
    r = client.post("/practice/sessions", json={"mode": "free", "question_ids": [q["id"] for q in qs], **body}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _coach_reply(transcript: str, weak: bool = True) -> dict:
    """예전 AI 코칭(PR #2 형식)이 남긴 보고서 내용. 인용은 이번 답변 앞부분을 그대로 쓴다(제출본 연결은 판단유보)."""
    quote = transcript[:10]
    return {"summary": "결과 확인 과정을 더 말해 보세요.", "next_action": "결과를 확인한 방법을 한 문장으로 덧붙이세요.",
            "criteria": [
                {"key": "specificity", "label": "구체성", "status": "보완" if weak else "충분",
                 "reason": "결과를 확인한 방법이 없어요.", "answer_quote": quote},
                {"key": "relevance", "label": "질문 적합성", "status": "충분", "reason": "질문에 바로 답했어요.",
                 "answer_quote": quote},
                {"key": "consistency", "label": "제출본 연결", "status": "판단유보", "reason": "비교할 자소서가 없어요."}],
            "followup": {"text": "그 결과는 어떻게 확인했나요?", "focus": "specificity", "reason": "결과 확인 과정",
                         "answer_quote": quote}}


def _legacy_ai_report(client, h, aid: str, weak: bool = True) -> None:
    """예전 AI 코칭이 남긴, 지금 전사문의 보고서를 만든다: 기본 점검의 지문은 그대로 두고 내용만 AI 보고서로 바꾼다."""
    assert client.post(f"/practice/answers/{aid}/coach", headers=h).status_code == 200
    with SessionLocal() as db:
        a = db.get(PracticeAnswer, aid)
        stamps = {k: a.coaching.report[k] for k in
                  ("input_status", "input_sha256", "transcript_sha256", "question_classification_sha256", "rubric_version")}
        a.coaching.report = {**_coach_reply(a.transcript, weak), "method": "ai", **stamps}
        db.commit()


def _watch_coaching(monkeypatch, calls: list, during=None) -> None:
    """기본 점검(coaching.build_report)을 부를 때마다 점검한 전사문을 calls에 남긴다.
    during(transcript): 보고서를 만든 뒤 저장하기 전에 끼워 넣을 일(다른 요청, 기다리기 등)."""
    original = coaching.build_report

    def watched(question, transcript, *args, **kwargs):
        calls.append(transcript)
        report = original(question, transcript, *args, **kwargs)
        if during:
            during(transcript)
        return report

    monkeypatch.setattr(coaching, "build_report", watched)


def test_finish_coaches_answers_with_basic_checks_and_makes_no_summary(client, monkeypatch):
    h = {"X-User-Id": "user-debrief"}
    calls: list = []
    _watch_coaching(monkeypatch, calls)
    s = _session(client, h, 3)
    a1, a2, a3 = (a["id"] for a in s["answers"])
    client.patch(f"/practice/answers/{a1}", json={"transcript": T1, "self_rating": 4, "reflection_note": "결론이 늦었다"},
                 headers=h)
    client.patch(f"/practice/answers/{a2}", json={"transcript": T2}, headers=h)

    r = client.post(f"/practice/sessions/{s['id']}/finish", headers=h).json()
    assert r["debrief_running"] is True and r["debrief_status"] == "none"  # 응답은 바로, 점검은 백그라운드에서
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["debrief_running"] is False and got["debrief_status"] == "none" and got["debrief"] is None
    assert calls == [T1, T2]  # 전사문이 있는 답변만, /coach와 같은 기본 점검으로
    by_id = {a["id"]: a for a in got["answers"]}
    for aid in (a1, a2):
        assert by_id[aid]["coaching_report"]["method"] == "basic"
    assert by_id[a3]["coaching_report"] is None

    # 다시 끝내면 이미 있는 점검은 다시 하지 않고, 작업도 붙이지 않는다
    again = client.post(f"/practice/sessions/{s['id']}/finish", headers=h).json()
    assert again["debrief_running"] is False and calls == [T1, T2]


def test_finish_runs_basic_coaching_and_status_stays_none(client):
    h = {"X-User-Id": "user-debrief-off"}
    s = _session(client, h, 2)
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", json={"transcript": T1}, headers=h)
    r = client.post(f"/practice/sessions/{s['id']}/finish", headers=h).json()
    assert r["debrief_status"] == "none"
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    # 코칭은 기본 점검으로 돈다(AI 평가로 표시하지 않음). 요약은 만들지 않는다
    assert got["answers"][0]["coaching_report"]["method"] == "basic" and got["answers"][1]["coaching_report"] is None
    assert got["debrief_status"] == "none" and got["debrief"] is None and got["debrief_running"] is False
    assert client.post(f"/practice/sessions/{s['id']}/debrief", headers=h).json()["debrief_status"] == "none"

    s2 = _session(client, h, 1)
    r = client.post(f"/practice/sessions/{s2['id']}/finish", headers=h).json()
    assert r["debrief_status"] == "none" and r["debrief_running"] is False


def test_stored_summary_and_its_status_are_read_only(client):
    """예전에 만든 세션 요약(done)은 다시 끝내거나 재생성을 눌러도 그대로 남는다."""
    h = {"X-User-Id": "user-debrief-legacy-done"}
    s = _session(client, h, 1)
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", json={"transcript": T1}, headers=h)
    client.post(f"/practice/sessions/{s['id']}/finish", headers=h)  # 기본 점검까지 끝낸다
    with SessionLocal() as db:
        x = db.get(PracticeSession, s["id"])
        x.debrief = {"lesson": "예전 요약의 교훈", "next_action": "예전 행동", "moments": [],
                     "generated_at": "2026-11-01T00:00:00+00:00", "model": "legacy-model",
                     "input_sha256": debrief.debrief_fingerprint(x)}
        x.debrief_status = "done"
        db.commit()
    for path in ("finish", "debrief"):
        r = client.post(f"/practice/sessions/{s['id']}/{path}", headers=h).json()
        assert r["debrief_status"] == "done" and r["debrief"]["lesson"] == "예전 요약의 교훈"
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["debrief_status"] == "done" and got["debrief"]["input_sha256"] and got["debrief_running"] is False


@pytest.mark.parametrize("stored", ["failed", "unavailable"])
def test_other_stored_statuses_are_kept(client, stored):
    h = {"X-User-Id": f"user-debrief-legacy-{stored}"}
    s = _session(client, h, 1)
    with SessionLocal() as db:
        db.get(PracticeSession, s["id"]).debrief_status = stored
        db.commit()
    assert client.post(f"/practice/sessions/{s['id']}/debrief", headers=h).json()["debrief_status"] == stored


def test_pending_left_by_an_old_summary_job_is_settled(client):
    """예전 요약 작업이 'pending'을 남기고 사라졌으면 그 작업은 다시 오지 않는다: 다시 시도하면 'none'으로 정리하고,
    점검할 답변이 있으면 기본 점검만 한다."""
    h = {"X-User-Id": "user-debrief-legacy-pending"}
    s = _session(client, h, 1)
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", json={"transcript": T1}, headers=h)
    with SessionLocal() as db:
        db.get(PracticeSession, s["id"]).debrief_status = "pending"
        db.commit()
    lost = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert lost["debrief_status"] == "pending" and lost["debrief_running"] is False  # 화면은 '다시 시도'를 보인다
    r = client.post(f"/practice/sessions/{s['id']}/debrief", headers=h).json()
    assert r["debrief_status"] == "none"
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["debrief_status"] == "none" and got["debrief"] is None and got["debrief_running"] is False
    assert got["answers"][0]["coaching_report"]["method"] == "basic"


@pytest.mark.parametrize("path", ["finish", "debrief"])
def test_pending_with_a_stored_summary_keeps_rendering_it(client, path):
    """예전 흐름은 다시 끝내거나 재생성할 때 저장된 요약을 둔 채 'pending'으로 바꿨다. 그 작업이 사라졌으면(이번 배포 등)
    행에는 'pending'과 유효한 요약이 함께 남는다. 정리할 때 요약을 감추지 않고 'done'으로 되돌린다."""
    h = {"X-User-Id": f"user-debrief-legacy-pending-summary-{path}"}
    s = _session(client, h, 1)
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", json={"transcript": T1}, headers=h)
    client.post(f"/practice/sessions/{s['id']}/finish", headers=h)  # 기본 점검까지 끝낸다
    with SessionLocal() as db:
        x = db.get(PracticeSession, s["id"])
        x.debrief = {"lesson": "예전 요약의 교훈", "next_action": "예전 행동", "moments": [],
                     "generated_at": "2026-11-01T00:00:00+00:00", "model": "legacy-model",
                     "input_sha256": debrief.debrief_fingerprint(x)}
        x.debrief_status = "pending"
        db.commit()
    r = client.post(f"/practice/sessions/{s['id']}/{path}", headers=h).json()
    assert r["debrief_status"] == "done" and r["debrief"]["lesson"] == "예전 요약의 교훈"
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["debrief_status"] == "done" and got["debrief"]["lesson"] == "예전 요약의 교훈"
    assert got["debrief_running"] is False


def _edit_transcript(answer_id: str, text: str) -> None:
    """다른 요청(PATCH)이 전사문을 고친 것처럼 별도 DB 세션에서 바꾼다(코칭도 PATCH처럼 무효화)."""
    with SessionLocal() as db:
        a = db.get(PracticeAnswer, answer_id)
        practice._invalidate_coaching(a)
        a.transcript = text
        db.commit()


def test_answer_edited_during_coaching_is_skipped_then_coached_again(client, monkeypatch):
    """점검 중에 전사문이 바뀐 답변은 /coach처럼 409로 버리고, 다음 바퀴에서 새 전사문으로 다시 점검한다."""
    h = {"X-User-Id": "user-debrief-race"}
    t2_old, t2_new = "작년 동아리에서 저는 발표를 맡았습니다.", "인턴십에서 저는 데이터 정리 자동화를 맡았습니다."
    a1_new = "고친 첫 답변입니다. 저는 일정을 다시 짰습니다."
    calls: list = []
    ids: dict = {}

    def racing(transcript):
        if calls == [T1]:
            _edit_transcript(ids["a1"], a1_new)  # 점검 중인 답변을 고침
            _edit_transcript(ids["a2"], t2_new)  # 아직 점검하지 않은 답변을 고침

    _watch_coaching(monkeypatch, calls, racing)
    s = _session(client, h, 2)
    ids["a1"], ids["a2"] = (a["id"] for a in s["answers"])
    client.patch(f"/practice/answers/{ids['a1']}", json={"transcript": T1}, headers=h)
    client.patch(f"/practice/answers/{ids['a2']}", json={"transcript": t2_old}, headers=h)

    client.post(f"/practice/sessions/{s['id']}/finish", headers=h)
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    a1, a2 = got["answers"]
    assert got["debrief_running"] is False
    assert calls == [T1, t2_new, a1_new]
    assert a1["transcript"] == a1_new and a1["coaching_report"]["criteria"][0]["answer_quote"] == a1_new
    assert a2["transcript"] == t2_new and a2["coaching_report"]["criteria"][0]["answer_quote"] == t2_new


def test_finish_does_not_start_second_debrief_while_running(client, monkeypatch):
    h = {"X-User-Id": "user-debrief-pending"}
    calls: list = []
    _watch_coaching(monkeypatch, calls)
    s = _session(client, h, 1)
    client.patch(f"/practice/answers/{s['answers'][0]['id']}", json={"transcript": T1}, headers=h)
    with SessionLocal() as db:
        db.get(PracticeSession, s["id"]).debrief_started_at = datetime.now(timezone.utc)  # 다른 작업이 점검하는 중
        db.commit()
    r = client.post(f"/practice/sessions/{s['id']}/finish", headers=h).json()
    assert r["debrief_running"] is True
    # 2분 뒤 화면의 '다시 시도'는 먼저 상태를 확인한다: 작업이 돌고 있으면 재생성을 보내지 않는다
    assert client.get(f"/practice/sessions/{s['id']}", headers=h).json()["debrief_running"] is True
    # 그래도 재생성 요청이 오면 도는 작업이 있으니 하나 더 붙이지 않는다
    assert client.post(f"/practice/sessions/{s['id']}/debrief", headers=h).json()["debrief_running"] is True
    assert calls == []

    # 5분이 지나도 끝나지 않았으면 작업이 사라진 것(서버 재시작 등)으로 보고 다시 시작한다
    with SessionLocal() as db:
        db.get(PracticeSession, s["id"]).debrief_started_at = datetime.now(timezone.utc) - timedelta(minutes=6)
        db.commit()
    lost = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert lost["debrief_running"] is False
    assert client.post(f"/practice/sessions/{s['id']}/debrief", headers=h).json()["debrief_running"] is True
    assert calls == [T1]
    done = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert done["debrief_running"] is False and done["answers"][0]["coaching_report"]["method"] == "basic"


def test_redrill_also_takes_low_self_ratings_in_order(client):
    """다시 연습할 답변은 저장된 보고서(예전 AI 보고서 포함)의 '보완'과 낮은 자기평가로 고른다."""
    h = {"X-User-Id": "user-redrill"}
    s = _session(client, h, 4, title="금요일 연습")
    a1, a2, a3, a4 = (a["id"] for a in s["answers"])
    client.patch(f"/practice/answers/{a1}", json={"self_rating": 2}, headers=h)  # 글 답변 없이 자기평가만
    client.patch(f"/practice/answers/{a2}", json={"transcript": T1}, headers=h)
    client.patch(f"/practice/answers/{a3}", json={"transcript": T2, "self_rating": 3}, headers=h)
    client.patch(f"/practice/answers/{a4}", json={"transcript": T2, "self_rating": 1}, headers=h)
    _legacy_ai_report(client, h, a2, weak=True)
    _legacy_ai_report(client, h, a3, weak=False)  # 보완 없음, 자기평가 3점
    _legacy_ai_report(client, h, a4, weak=False)  # 보완 없음, 자기평가 1점

    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert [(w["answer_id"], w["reasons"]) for w in got["redrill"]] == [
        (a1, ["자기평가 2점"]), (a2, ["AI · 구체성 보완"]), (a4, ["자기평가 1점"])]
    assert got["redrill"][0]["question_text"] == s["answers"][0]["question"]["text"]

    r = client.post(f"/practice/sessions/{s['id']}/redrill", headers=h)
    assert r.status_code == 201, r.text
    drill = r.json()
    assert [a["question"]["id"] for a in drill["answers"]] == [s["answers"][i]["question"]["id"] for i in (0, 1, 3)]
    assert drill["title"] == "보완 연습 · 금요일 연습" and drill["mode"] == "free"
    targets = drill["context_snapshot"]["drill_targets"]
    assert [(t["answer_id"], t["focus"]) for t in targets] == [(a1, ["자기평가 2점"]), (a2, ["구체성"]), (a4, ["자기평가 1점"])]
    assert "rated this answer 2" in targets[0]["next_action"]  # 코칭이 없으면 자기평가로 안내한다
    assert targets[1]["next_action"] == "결과를 확인한 방법을 한 문장으로 덧붙이세요."  # 코칭의 다음 연습
    assert targets[2]["next_action"] == "결과를 확인한 방법을 한 문장으로 덧붙이세요."


def test_basic_coaching_reasons_are_not_labeled_ai_and_redrill_caps_at_20(client):
    h = {"X-User-Id": "user-redrill-basic"}
    app = client.post("/track/applications", headers=h, json={"company": "테스트회사", "position": "백엔드"}).json()
    client.post(f"/track/applications/{app['id']}/essays", headers=h,
                json={"question_text": "성과", "content": "캐시를 도입해 응답 시간을 40% 줄였습니다."})
    qs = [client.post("/practice/questions", headers=h, json={"category": "직무", "text": f"성과 질문 {i}번"}).json()["id"]
          for i in range(21)]
    s = client.post("/practice/sessions", headers=h, json={"mode": "free", "application_id": app["id"],
                                                          "question_ids": qs}).json()
    first = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{first}", json={"transcript": "제가 캐시를 도입했습니다."}, headers=h)
    report = client.post(f"/practice/answers/{first}/coach", headers=h).json()["coaching_report"]
    assert report["method"] == "basic"
    for a in s["answers"][1:]:
        client.patch(f"/practice/answers/{a['id']}", json={"self_rating": 1}, headers=h)
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["redrill"][0]["reasons"] == ["Specificity 보완"]  # 기본 점검은 'AI ·'를 붙이지 않는다
    assert len(got["redrill"]) == 20 and got["redrill"][-1]["order_no"] == 20
    drill = client.post(f"/practice/sessions/{s['id']}/redrill", headers=h).json()
    assert len(drill["answers"]) == 20
    assert [t["answer_id"] for t in drill["context_snapshot"]["drill_targets"]] == [w["answer_id"] for w in got["redrill"]]


def test_redrill_nothing_qualifies_and_other_user(client):
    h, other = {"X-User-Id": "user-redrill-none"}, {"X-User-Id": "user-redrill-other"}
    s = _session(client, h, 1)
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", json={"self_rating": 3}, headers=h)
    r = client.post(f"/practice/sessions/{s['id']}/redrill", headers=h)
    assert r.status_code == 422 and "need work" in r.json()["detail"] and "self-rating" in r.json()["detail"]
    assert client.get(f"/practice/sessions/{s['id']}", headers=h).json()["redrill"] == []
    assert client.post(f"/practice/sessions/{s['id']}/redrill", headers=other).status_code == 404
    assert client.post(f"/practice/sessions/{s['id']}/debrief", headers=other).status_code == 404
    assert client.post(f"/practice/sessions/{s['id']}/finish", headers=other).status_code == 404
    assert client.delete(f"/practice/answers/{aid}/audio", headers=other).status_code == 404


def test_rubric_endpoint_serves_coaching_criteria_with_anchors(client):
    r = client.get("/practice/rubric", headers={"X-User-Id": "user-rubric"}).json()
    assert [c["key"] for c in r["criteria"]] == ["specificity", "relevance", "consistency"]
    assert [c["label"] for c in r["criteria"]] == ["Specificity", "Relevance", "Match With Submitted Essay"]
    assert {c["key"]: c["label"] for c in r["criteria"]} == coaching.LABELS
    for c in r["criteria"]:
        assert c["checks"] and set(c["anchors"]) == {"충분", "보완"} and all(c["anchors"].values())
    star = r["criteria"][0]["star"]
    assert star["when"] == "Questions about past experience"
    assert [a.split(":")[0] for a in star["anchors"]] == ["Situation and task", "Own role and reasoning", "Result and lesson"]
    assert set(r["statuses"]) == {"충분", "보완", "판단유보"}
    assert "Rule-based" in r["note"] and "AI" not in r["note"] and "LLM" not in r["note"]
    assert r["version"] == coaching.RUBRIC_VERSION


@pytest.mark.parametrize("quote,transcript,expected", [
    ("정산 시간을 절반으로", "저는 음, 정산 시간을 절반으로 줄였습니다", ("정산 시간을 절반으로", True)),
    ("“정산 시간을, 절반으로”", "저는 정산 시간을 절반으로 줄였습니다", ("정산 시간을 절반으로", True)),
    ("지어낸 문장입니다", "저는 정산 시간을 절반으로 줄였습니다", (None, False)),
    ("저는", "저는 정산 시간을 절반으로 줄였습니다", (None, False)),
    ("", "저는", (None, None)),
])
def test_verify_quote(quote, transcript, expected):
    assert llm.verify_quote(quote, transcript) == expected


# ───────── 다른 전사문을 채점한 보고서 ─────────

def test_report_for_an_older_transcript_counts_as_missing(client, monkeypatch):
    """전사문을 고치는 요청이 보고서보다 먼저 답변을 읽고 나중에 저장하면(_invalidate_coaching이 지울 보고서를 못 봄)
    남은 보고서는 옛 전사문을 채점한 것이다. 응답·다시 연습할 답변·재연습·디브리프는 그 보고서를 없는 것으로 본다."""
    h = {"X-User-Id": "user-stale-report"}
    calls: list = []
    _watch_coaching(monkeypatch, calls)
    s = _session(client, h, 1)
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", json={"transcript": T1}, headers=h)
    with SessionLocal() as edit:  # '저장'(또는 다시 전사) 요청: 보고서가 생기기 전에 답변을 읽었다
        a = edit.get(PracticeAnswer, aid)
        assert a.coaching_report is None
        _legacy_ai_report(client, h, aid, weak=True)  # 그사이 '보완'이 있는 보고서가 저장됐다
        practice._invalidate_coaching(a)  # 이 요청이 읽은 답변에는 보고서가 없다
        a.transcript = T2
        edit.commit()

    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["answers"][0]["transcript"] == T2 and got["answers"][0]["coaching_report"] is None
    assert got["redrill"] == []
    assert client.post(f"/practice/sessions/{s['id']}/redrill", headers=h).status_code == 422
    # 디브리프 작업은 이 답변을 지금 전사문으로 다시 점검한다
    client.post(f"/practice/sessions/{s['id']}/finish", headers=h)
    assert calls == [T1, T2]
    report = client.get(f"/practice/sessions/{s['id']}", headers=h).json()["answers"][0]["coaching_report"]
    assert report["criteria"][0]["answer_quote"] == T2


def test_reports_carry_the_current_rubric_version_and_old_reports_are_kept(client, monkeypatch):
    """PR #2의 기준에 STAR 앵커와 판단 규칙이 더해졌으므로 새 보고서는 새 버전을 찍는다. main이 만든 보고서는 그대로 둔다."""
    assert coaching.RUBRIC_VERSION != "2026-10-15"
    h = {"X-User-Id": "user-rubric-version"}
    calls: list = []
    _watch_coaching(monkeypatch, calls)
    s = _session(client, h, 2)
    a1, a2 = (a["id"] for a in s["answers"])
    client.patch(f"/practice/answers/{a1}", json={"transcript": T1}, headers=h)
    client.patch(f"/practice/answers/{a2}", json={"transcript": T2}, headers=h)
    for aid in (a1, a2):
        basic = client.post(f"/practice/answers/{aid}/coach", headers=h).json()["coaching_report"]
        assert basic["method"] == "basic" and basic["rubric_version"] == coaching.RUBRIC_VERSION
    assert client.get("/practice/rubric").json()["version"] == coaching.RUBRIC_VERSION

    # main이 만든 보고서(2026-10-15, 전사문 지문 없음)는 지금 전사문의 것으로 보고 다시 점검하지 않는다
    old = {**_coach_reply(T1), "method": "ai", "rubric_version": "2026-10-15"}
    with SessionLocal() as db:
        db.get(PracticeAnswer, a1).coaching.report = old
        db.commit()
    n = len(calls)
    client.post(f"/practice/sessions/{s['id']}/finish", headers=h)
    assert calls[n:] == []
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()["answers"][0]["coaching_report"]
    assert got["rubric_version"] == "2026-10-15" and got["method"] == "ai"


# ───────── AI 점검 실패로 대신 붙은 기본 점검(예전 기록) ─────────

def test_stored_fallback_report_is_not_coached_again(client, monkeypatch):
    """예전에 AI 점검이 실패해 기본 점검으로 대신한 보고서(fallback_reason)도 기록으로 두고, 디브리프가 다시 점검하지 않는다."""
    h = {"X-User-Id": "user-debrief-fallback"}
    calls: list = []
    _watch_coaching(monkeypatch, calls)
    s = _session(client, h, 1)
    aid = s["answers"][0]["id"]
    client.patch(f"/practice/answers/{aid}", json={"transcript": T2}, headers=h)
    assert client.post(f"/practice/answers/{aid}/coach", headers=h).json()["coaching_report"]["method"] == "basic"
    with SessionLocal() as db:
        a = db.get(PracticeAnswer, aid)
        a.coaching.report = {**a.coaching.report, "fallback_reason": "ai_error"}
        db.commit()
    n = len(calls)
    for path in ("finish", "debrief"):
        assert client.post(f"/practice/sessions/{s['id']}/{path}", headers=h).json()["debrief_running"] is False
    assert calls[n:] == []
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["answers"][0]["coaching_report"]["method"] == "basic"


# ───────── 오래 걸리는 작업과 작업 중에 들어온 요청 ─────────

class _Clock:
    """디브리프 모듈이 보는 시각을 테스트가 정한다(실제로 몇 분씩 기다리지 않고 오래 걸리는 작업을 흉내 낸다)."""

    def __init__(self, monkeypatch):
        self.now = datetime.now(timezone.utc)
        clock = self

        class Fixed(datetime):
            @classmethod
            def now(cls, tz=None):
                return clock.now if tz else clock.now.replace(tzinfo=None)

        monkeypatch.setattr(debrief, "datetime", Fixed)


def test_long_job_keeps_a_heartbeat_so_retry_does_not_start_a_second_job(client, monkeypatch):
    h = {"X-User-Id": "user-debrief-heartbeat"}
    clock = _Clock(monkeypatch)
    calls: list = []
    entered, resume = Event(), Event()

    def slow(transcript):
        clock.now += timedelta(minutes=4)
        if len(calls) == 2:
            entered.set()
            assert resume.wait(5)

    _watch_coaching(monkeypatch, calls, slow)
    s = _session(client, h, 3)
    for a, t in zip(s["answers"], (T1, T2, T1)):
        client.patch(f"/practice/answers/{a['id']}", json={"transcript": t}, headers=h)
    with ThreadPoolExecutor(max_workers=1) as pool:
        finish = pool.submit(client.post, f"/practice/sessions/{s['id']}/finish", headers=h)
        assert entered.wait(5)
        try:
            # 작업을 시작한 지 8분: 시작 시각만 보면 사라진 작업이지만, 4분 전에 신호를 남겼으니 도는 중이다
            mid = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
            again = client.post(f"/practice/sessions/{s['id']}/debrief", headers=h).json()
        finally:
            resume.set()
        finish.result(timeout=10)
    assert mid["debrief_running"] is True
    assert again["debrief_running"] is True
    assert len(calls) == 3  # 같은 답변을 두 작업이 점검하지 않는다
    done = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert done["debrief_running"] is False and done["debrief_status"] == "none"
    assert all(a["coaching_report"]["method"] == "basic" for a in done["answers"])
    with SessionLocal() as db:
        x = db.get(PracticeSession, s["id"])
        assert (x.debrief_started_at, x.debrief_heartbeat_at, x.debrief_requested_at) == (None, None, None)


def test_lost_job_that_comes_back_does_not_overwrite_the_new_job(client, monkeypatch, caplog):
    """신호가 5분 넘게 끊겨 다시 시작했다면, 돌아온 옛 작업은 이어 점검하지 않고 멈추며 새 작업의 결과를 바꾸지 않는다."""
    h = {"X-User-Id": "user-debrief-takeover"}
    clock = _Clock(monkeypatch)
    calls: list = []
    entered, resume = Event(), Event()

    def stuck_once(transcript):
        if not entered.is_set():
            entered.set()
            assert resume.wait(5)

    _watch_coaching(monkeypatch, calls, stuck_once)
    s = _session(client, h, 2)
    for a, t in zip(s["answers"], (T1, T2)):
        client.patch(f"/practice/answers/{a['id']}", json={"transcript": t}, headers=h)
    with caplog.at_level(logging.INFO, logger="app.debrief"), ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(client.post, f"/practice/sessions/{s['id']}/finish", headers=h)
        assert entered.wait(5)
        try:
            clock.now += timedelta(minutes=6)
            assert client.get(f"/practice/sessions/{s['id']}", headers=h).json()["debrief_running"] is False
            client.post(f"/practice/sessions/{s['id']}/debrief", headers=h)  # 새 작업이 이어받아 끝낸다
            taken = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
        finally:
            resume.set()
        first.result(timeout=10)
    assert taken["debrief_running"] is False
    assert all(a["coaching_report"]["method"] == "basic" for a in taken["answers"])
    assert calls == [T1, T1, T2]  # 옛 작업은 멈춰 있던 첫 답변 뒤로 더 점검하지 않는다
    assert "이어받아 이 작업을 멈춥니다" in caplog.text
    after = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert after["answers"] == taken["answers"] and after["debrief_running"] is False


def test_finish_during_a_running_job_makes_the_job_run_again(client, monkeypatch):
    """작업이 점검을 마치고 끝내려는 사이에 마지막 답변을 저장하고 '면접 마치고 회고 보기'를 누르면, 그 요청을 버리지 않고
    작업이 한 바퀴 더 돌아 그 답변까지 점검한다."""
    h = {"X-User-Id": "user-debrief-rerun"}
    calls: list = []
    _watch_coaching(monkeypatch, calls)
    entered, resume = Event(), Event()
    settle = debrief._settle

    def slow_settle(*args, **kwargs):
        if not entered.is_set():
            entered.set()
            assert resume.wait(5)
        return settle(*args, **kwargs)

    monkeypatch.setattr(debrief, "_settle", slow_settle)
    s = _session(client, h, 2)
    a1, a2 = (a["id"] for a in s["answers"])
    client.patch(f"/practice/answers/{a1}", json={"transcript": T1}, headers=h)
    with ThreadPoolExecutor(max_workers=1) as pool:
        job = pool.submit(client.post, f"/practice/sessions/{s['id']}/debrief", headers=h)  # 끝내기 전에 '디브리프 만들기'
        assert entered.wait(5)
        try:
            client.patch(f"/practice/answers/{a2}", json={"transcript": T2}, headers=h)
            fin = client.post(f"/practice/sessions/{s['id']}/finish", headers=h).json()
        finally:
            resume.set()
        job.result(timeout=10)
    assert fin["debrief_running"] is True  # 작업을 하나 더 붙이지 않는다
    assert calls == [T1, T2]
    got = client.get(f"/practice/sessions/{s['id']}", headers=h).json()
    assert got["debrief_running"] is False and got["finished_at"]
    assert got["answers"][1]["coaching_report"]["method"] == "basic"
