"""User-facing backend sentences are English; interview content (follow-up text, questions) stays Korean."""
import ast
import re
from pathlib import Path

from app import coaching
from app.routers import practice
from tests.test_interview_coaching import answer, make_session

HANGUL = re.compile(r"[가-힣]")
APP = Path(__file__).resolve().parents[1] / "app"


def _clean(detail):
    assert isinstance(detail, str) and detail.strip(), detail
    assert not HANGUL.search(detail), detail


def test_api_errors_are_english(client, monkeypatch):
    # 401: missing token
    from app.config import settings
    monkeypatch.setattr(settings, "auth_disabled", False)
    r = client.get("/practice/sessions")
    assert r.status_code == 401
    _clean(r.json()["detail"])
    monkeypatch.setattr(settings, "auth_disabled", True)

    h, s, _, _, _ = make_session(client)
    aid = s["answers"][0]["id"]
    # 422: no transcript
    r = client.post(f"/practice/answers/{aid}/coach", headers=h)
    assert r.status_code == 422
    _clean(r.json()["detail"])
    # 409: duplicate follow-up on a follow-up
    answer(client, h, s)
    child = client.post(f"/practice/answers/{aid}/followup", headers=h).json()["answers"][1]
    client.patch(f"/practice/answers/{child['id']}", headers=h, json={"transcript": "후속 답변"})
    r = client.post(f"/practice/answers/{child['id']}/followup", headers=h)
    assert r.status_code == 409
    _clean(r.json()["detail"])
    # 404: unknown answer
    r = client.get("/practice/answers/00000000-0000-0000-0000-000000000000/audio", headers=h)
    assert r.status_code == 404
    _clean(r.json()["detail"])
    # consent required
    audio = {"file": ("a.webm", b"\x1aE\xdf\xa3x", "audio/webm")}
    r = client.post(f"/practice/answers/{aid}/audio", files=audio, headers=h)
    assert r.status_code == 403
    _clean(r.json()["detail"])
    # 413: oversized upload
    client.put("/practice/settings", json={"consent": True}, headers=h)
    monkeypatch.setattr(practice, "MAX_AUDIO_BYTES", 4)
    r = client.post(f"/practice/answers/{aid}/audio", files=audio, headers=h)
    assert r.status_code == 413
    _clean(r.json()["detail"])


def test_basic_coaching_guidance_is_english_but_the_follow_up_stays_korean():
    for ctx in ({"essays": []},
                {"essays": [{"content": "응답 시간을 40% 개선했습니다.", "version_id": "v1"}]}):
        report = coaching._basic("제가 개선했습니다.", ctx)
        _clean(report["summary"])
        _clean(report["next_action"])
        for c in report["criteria"]:
            _clean(c["reason"])
        _clean(report["followup"]["reason"])
        assert HANGUL.search(report["followup"]["text"])
    _clean(coaching.RUBRIC["note"])
    assert "AI" not in coaching.RUBRIC["note"] and "LLM" not in coaching.RUBRIC["note"]


def _user_strings():
    """String literals inside HTTPException/STTError/ValueError calls, plus the shared error constants."""
    found = []
    for path in sorted(APP.rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                name = f.id if isinstance(f, ast.Name) else getattr(f, "attr", "")
                if name in {"HTTPException", "STTError", "ValueError"}:
                    for n in ast.walk(node):
                        if isinstance(n, ast.Constant) and isinstance(n.value, str):
                            found.append((path.name, node.lineno, n.value))
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {"NEED_CONSENT", "ANSWER_NOT_FOUND"}
                                                    for t in node.targets):
                found.append((path.name, node.lineno, ast.literal_eval(node.value)))
    return found


def test_no_korean_in_user_facing_backend_strings():
    strings = _user_strings()
    assert len(strings) > 40
    bad = [(f, line, s) for f, line, s in strings if HANGUL.search(s)]
    assert not bad, bad
    # Allowlist: template questions (llm.py) and the follow-up text assembled in coaching._basic stay Korean.
