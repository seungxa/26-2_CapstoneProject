import os
import tempfile
import threading
import time

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
# 녹음도 임시 폴더에(개발용 backend/recordings/를 건드리지 않게). .env보다 먼저 정해 둔다
os.environ["RECORDINGS_DIR"] = f"{_tmp}/recordings"
os.environ["AUTH_DISABLED"] = "true"
os.environ["SUPABASE_URL"] = ""
os.environ["AUDIO_RETENTION_DAYS"] = "30"
os.environ["PURGE_INTERVAL_MIN"] = "60"
# 자동 전사는 기본으로 끈다. 전사가 필요한 테스트는 fake_stt(가짜 로컬 제공자)를, 로컬 faster-whisper 자체는
# test_local_stt.py가 가짜 모델을 끼워 검사한다
os.environ["STT_PROVIDER"] = "off"
# 꼬리질문 모델도 끈다: 테스트는 실제 모델을 불러오거나 내려받지 않는다. 생성 경로가 필요한 테스트는 fake_followup을 쓴다
os.environ["FOLLOWUP_MODEL"] = "off"

os.environ["PRACTICE_INSIGHTS_ENABLED"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


class FakeStt:
    """가짜 로컬 전사 제공자(stt._Local 자리에 끼운다). 녹음 내용과 상관없이 reply를 돌려준다.

    reply: 돌려줄 전사문, 또는 던질 예외(실제 제공자처럼 stt.STTError). 빈 전사문은 실제 제공자처럼 no_speech 실패다.
    calls: 받은 (audio, filename, content_type).
    """

    name = "local"

    def __init__(self):
        self.reply: str | Exception = "가짜 전사문입니다."
        self.calls: list = []

    def available(self) -> bool:
        return True

    def unavailable_reason(self) -> str:
        return ""

    def details(self) -> dict:
        return {"model": "fake", "state": "ready", "error": None}

    def transcribe(self, audio: bytes, filename: str, content_type: str) -> str:
        from app import stt

        self.calls.append((audio, filename, content_type))
        reply = self.reply
        if isinstance(reply, BaseException):
            raise reply
        if not reply.strip():
            raise stt.STTError("no_speech", "No speech recognized. Record again and speak closer to the microphone.")
        return reply


@pytest.fixture
def fake_stt(monkeypatch) -> FakeStt:
    """자동 전사를 켜고(STT_PROVIDER=local) 로컬 제공자를 FakeStt로 바꿔 끼운다. 전사를 잠시 끄려면
    monkeypatch.setattr(settings, "stt_provider", "off")."""
    from app import stt
    from app.config import settings

    fake = FakeStt()
    monkeypatch.setitem(stt._PROVIDERS, "local", fake)
    monkeypatch.setattr(settings, "stt_provider", "local")
    return fake


class FakeFollowup:
    """가짜 꼬리질문 모델(followup_model._loader 자리에 끼운다). llama.cpp 없이 로딩·직렬화·시간 상한·검증 경로를 그대로 돈다.

    reply: 모델이 낼 원문, 또는 생성할 때 던질 예외. delay: 생성 한 번에 걸리는 시간(초).
    load_error: 불러올 때 던질 예외(ImportError는 라이브러리 없음, OSError는 내려받기 실패 등).
    load_gate: 정해 두면 로더가 이 Event가 열릴 때까지 멈춘다(긴 로딩·첫 내려받기 흉내, 최대 10초).
    calls: 생성 호출마다 {"messages", "max_tokens", "temperature", "start", "end"}(time.monotonic 시각). loads: 로더 호출 수.
    """

    def __init__(self):
        self.reply: str | Exception = "그때 본인이 맡은 역할은 무엇이었나요?"
        self.delay: float = 0.0
        self.load_error: Exception | None = None
        self.load_gate: threading.Event | None = None
        self.calls: list = []
        self.loads = 0

    def load(self, settings):
        self.loads += 1
        if self.load_gate is not None and not self.load_gate.wait(10):
            raise AssertionError("load_gate was never opened")
        if self.load_error is not None:
            raise self.load_error
        return self

    def create_chat_completion(self, messages, max_tokens, temperature) -> dict:
        call = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature,
                "start": time.monotonic(), "end": None}
        self.calls.append(call)
        time.sleep(self.delay)
        call["end"] = time.monotonic()
        if isinstance(self.reply, BaseException):
            raise self.reply
        return {"choices": [{"message": {"role": "assistant", "content": self.reply}}]}


@pytest.fixture
def fake_followup(monkeypatch) -> FakeFollowup:
    """꼬리질문 모델을 켜고(FOLLOWUP_MODEL=local) 로더를 FakeFollowup으로 바꿔 끼운다. 불러온 모델·실패 기억·대기열은
    테스트마다 새로 시작한다. 다시 끄려면 monkeypatch.setattr(settings, "followup_model", "off")."""
    from app import followup_model
    from app.config import settings

    fake = FakeFollowup()
    monkeypatch.setattr(followup_model, "_runner", followup_model._Runner(installed=True))
    monkeypatch.setattr(followup_model, "_loader", fake.load)
    monkeypatch.setattr(settings, "followup_model", "local")
    return fake


@pytest.fixture
def consent(client):
    """녹음 동의(업로드 전에 필요). consent(headers, keep_audio=False)"""
    def _consent(headers: dict, keep_audio: bool = False) -> dict:
        r = client.put("/practice/settings", json={"consent": True, "keep_audio": keep_audio}, headers=headers)
        assert r.status_code == 200, r.text
        return r.json()
    return _consent


@pytest.fixture
def isolated_db(client, tmp_path, monkeypatch):
    """이 테스트만 쓰는 빈 DB와 녹음 폴더(세션 팩토리를 돌려준다).

    다른 테스트는 사용자 id로만 나뉜 공용 DB를 함께 쓴다. 만료 정리처럼 DB·저장소 전체를 훑는 작업은 그 데이터까지
    건드려 결과가 실행 순서에 따라 달라지므로, 그런 테스트는 이 픽스처로 API·백그라운드 작업·정리를 모두 새 DB에 묶는다.
    """
    from sqlalchemy.orm import sessionmaker

    from app import db as app_db
    from app import debrief, retention
    from app.config import settings
    from app.seed import seed_question_bank

    engine = app_db.make_engine(f"sqlite:///{tmp_path / 'isolated.db'}")
    app_db.upgrade_sqlite(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as s:
        seed_question_bank(s)

    def get_db():
        s = factory()
        try:
            yield s
        finally:
            s.close()

    for module in (app_db, retention, debrief):
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(settings, "local_recordings_dir", tmp_path / "recordings")
    app.dependency_overrides[app_db.get_db] = get_db
    try:
        yield factory
    finally:
        app.dependency_overrides.pop(app_db.get_db, None)
        engine.dispose()
