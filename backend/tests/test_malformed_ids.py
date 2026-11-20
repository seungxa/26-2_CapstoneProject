"""uuid가 아닌 id. Postgres(Supabase)는 uuid 컬럼에 그런 값을 넣으면 DataError(500)를 내므로,
DB에 보내기 전에 걸러 그 리소스의 404로 답한다. SQLite에서는 DB로 간 값을 지켜봐서 같은 것을 확인한다."""
import asyncio

import pytest
from sqlalchemy import event
from sqlalchemy.exc import DataError

from app import main
from app.config import settings
from app.db import engine

H = {"X-User-Id": "00000000-0000-0000-0000-0000000bad01"}
BAD = "abc-not-a-uuid"


@pytest.fixture
def sent():
    """DB 드라이버로 보낸 파라미터."""
    seen: list[str] = []

    def listen(conn, cursor, statement, parameters, context, executemany):
        seen.append(repr(parameters))

    event.listen(engine, "before_cursor_execute", listen)
    yield seen
    event.remove(engine, "before_cursor_execute", listen)


@pytest.mark.parametrize("method,path,body,detail", [
    ("GET", f"/practice/sessions/{BAD}", None, "Practice session not found. Check that it still exists."),
    ("POST", f"/practice/sessions/{BAD}/finish", None, "Practice session not found. Check that it still exists."),
    ("POST", f"/practice/sessions/{BAD}/debrief", None, "Practice session not found. Check that it still exists."),
    ("POST", f"/practice/sessions/{BAD}/redrill", None, "Practice session not found. Check that it still exists."),
    ("DELETE", f"/practice/sessions/{BAD}", None, "Practice session not found. Check that it still exists."),
    ("PATCH", f"/practice/answers/{BAD}", {"self_rating": 3}, "Answer not found. Reload the session and try again."),
    ("POST", f"/practice/answers/{BAD}/coach", None, "Answer not found. Reload the session and try again."),
    ("POST", f"/practice/answers/{BAD}/followup", None, "Answer not found. Reload the session and try again."),
    ("POST", f"/practice/answers/{BAD}/transcribe", None, "Answer not found. Reload the session and try again."),
    ("GET", f"/practice/answers/{BAD}/audio", None, "Answer not found. Reload the session and try again."),
    ("DELETE", f"/practice/answers/{BAD}/audio", None, "Answer not found. Reload the session and try again."),
    ("DELETE", f"/practice/questions/{BAD}", None, "This question cannot be deleted. Shared questions are read-only."),
    ("POST", "/practice/sessions", {"mode": "free", "question_ids": [BAD]}, f"Questions not found: ['{BAD}']. Reload the list and pick again."),
    ("POST", "/practice/sessions", {"mode": "free", "application_id": BAD}, "Application not found. Check that it still exists."),
    ("POST", "/practice/questions/generate", {"application_id": BAD}, "Application not found. Check that it still exists."),
    ("GET", f"/track/applications/{BAD}", None, "Application not found. Check that it still exists."),
    ("PATCH", f"/track/applications/{BAD}", {"notes": "x"}, "Application not found. Check that it still exists."),
    ("POST", f"/track/applications/{BAD}/events", {"stage": "서류", "result": "합격"}, "Application not found. Check that it still exists."),
    ("DELETE", f"/track/events/{BAD}", None, "Record not found. Reload the application and try again."),
    ("GET", f"/track/essays/{BAD}/versions", None, "Essay question not found. Check that it still exists."),
    ("POST", f"/track/versions/{BAD}/restore", None, "Version not found. Reload the essay and try again."),
])
def test_malformed_ids_get_the_resource_404_without_reaching_the_database(client, sent, method, path, body, detail):
    r = client.request(method, path, json=body, headers=H)
    assert r.status_code == 404 and r.json()["detail"] == detail
    assert not any(BAD in p for p in sent)


def test_malformed_question_id_next_to_a_valid_one(client, sent):
    bank = client.get("/practice/questions", params={"source": "bank"}, headers=H).json()[0]["id"]
    r = client.post("/practice/sessions", json={"mode": "free", "question_ids": [bank, BAD]}, headers=H)
    assert r.status_code == 404 and r.json()["detail"] == f"Questions not found: ['{BAD}']. Reload the list and pick again."
    assert not any(BAD in p for p in sent)


def test_dev_user_header_must_be_a_uuid_on_postgres(client, monkeypatch):
    """개발 모드(AUTH_DISABLED)의 X-User-Id도 Postgres에서는 uuid 컬럼에 들어간다. 로컬 SQLite는 아무 문자열이나 된다."""
    assert client.get("/practice/sessions", headers={"X-User-Id": "user-abc"}).status_code == 200
    monkeypatch.setattr(settings, "database_url", "postgresql+psycopg://postgres@/jobseeker")
    r = client.get("/practice/sessions", headers={"X-User-Id": "user-abc"})
    assert r.status_code == 400 and r.json()["detail"] == "The X-User-Id header must be a UUID. Send a valid UUID."
    assert client.get("/practice/sessions", headers=H).status_code == 200
    assert client.get("/practice/sessions").status_code == 200  # 헤더가 없으면 고정 dev 사용자(uuid)


def test_invalid_uuid_from_the_database_is_a_404_not_a_500():
    """미처 거르지 못한 값이 Postgres에 가도 500이 아니라 404로 답한다."""

    class InvalidText(Exception):
        sqlstate = "22P02"

    exc = DataError("SELECT 1", {}, InvalidText('invalid input syntax for type uuid: "abc"'))
    r = asyncio.run(main.invalid_id(None, exc))
    assert r.status_code == 404 and r.body.decode() == '{"detail":"Item not found. Check the address and try again."}'
    other = DataError("SELECT 1", {}, type("NumericOverflow", (Exception,), {"sqlstate": "22003"})("out of range"))
    with pytest.raises(DataError):
        asyncio.run(main.invalid_id(None, other))  # uuid가 아닌 다른 데이터 오류는 그대로 500
