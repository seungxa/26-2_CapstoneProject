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


def _module_strings(tree: ast.Module) -> dict[str, str]:
    """Module-level NAME = "..." string constants."""
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    out[t.id] = node.value.value
    return out


def _user_strings():
    """String literals inside HTTPException/STTError/ValueError calls, the module-level string constants those calls
    name (e.g. HTTPException(409, DUPLICATE_URL)), the strings returned by unavailable_reason(), plus the shared
    error constants."""
    trees = {path: ast.parse(path.read_text(encoding="utf-8")) for path in sorted(APP.rglob("*.py"))}
    everywhere: dict[str, str] = {}
    for tree in trees.values():
        everywhere.update(_module_strings(tree))
    found = []
    for path, tree in trees.items():
        local = _module_strings(tree)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                name = f.id if isinstance(f, ast.Name) else getattr(f, "attr", "")
                if name in {"HTTPException", "STTError", "ValueError"}:
                    for n in ast.walk(node):
                        if isinstance(n, ast.Constant) and isinstance(n.value, str):
                            found.append((path.name, node.lineno, n.value))
                        elif isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id in (local | everywhere):
                            found.append((path.name, node.lineno, local.get(n.id, everywhere.get(n.id))))
            # stt.unavailable_reason() is shown as the 503 detail of Retry Transcription
            if isinstance(node, ast.FunctionDef) and node.name == "unavailable_reason":
                for ret in (r for r in ast.walk(node) if isinstance(r, ast.Return) and r.value is not None):
                    for n in ast.walk(ret.value):
                        if isinstance(n, ast.Constant) and isinstance(n.value, str):
                            found.append((path.name, ret.lineno, n.value))
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {"NEED_CONSENT", "ANSWER_NOT_FOUND"}
                                                    for t in node.targets):
                found.append((path.name, node.lineno, ast.literal_eval(node.value)))
    return found


def test_the_scan_sees_named_constants_and_unavailable_reasons():
    strings = {s for _, _, s in _user_strings()}
    from app import stt
    from app.routers import track
    assert track.DUPLICATE_URL in strings  # raised as HTTPException(409, DUPLICATE_URL)
    assert stt._Off().unavailable_reason() in strings
    assert stt._Local().unavailable_reason() in strings


def test_duplicate_posting_url_is_explained_in_english(client):
    h = {"X-User-Id": "user-english-dup"}
    body = {"company": "중복공고사", "position": "백엔드", "url": "https://example.com/jobs/english-dup"}
    assert client.post("/track/applications", json=body, headers=h).status_code == 201
    r = client.post("/track/applications", json=body, headers=h)
    assert r.status_code == 409
    _clean(r.json()["detail"])
    assert "URL" in r.json()["detail"]


def test_transcription_unavailable_reasons_are_english(monkeypatch):
    from app import stt
    from app.config import settings
    for name in ("off", "local", "openai"):
        monkeypatch.setattr(settings, "stt_provider", name)
        _clean(stt.unavailable_reason())


def test_no_korean_in_user_facing_backend_strings():
    strings = _user_strings()
    assert len(strings) > 40
    bad = [(f, line, s) for f, line, s in strings if HANGUL.search(s)]
    assert not bad, bad
    # Allowlist: template questions (llm.py) and the follow-up text assembled in coaching._basic stay Korean.
