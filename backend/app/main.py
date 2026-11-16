import asyncio
import contextlib
import logging
import sys
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError

from . import followup_model, stt
from .config import settings
from .db import SessionLocal, init_db
from .retention import purge_loop, run_purge
from .routers import practice, track
from .seed import seed_question_bank


class _StderrHandler(logging.StreamHandler):
    """그때그때의 sys.stderr에 쓴다(logging.lastResort처럼). 테스트가 stderr를 바꿔 끼워도 닫힌 스트림에 쓰지 않는다."""

    def __init__(self):
        logging.Handler.__init__(self)

    @property
    def stream(self):
        return sys.stderr


def _setup_app_logging() -> None:
    """app.* 로그의 INFO(꼬리질문 생성 결과·모델 내려받기·로딩 시간)가 uvicorn 기본 설정에서도 보이게 한다.
    uvicorn은 자기 로거만 설정하고 루트 로거는 비워 두므로, 그대로 두면 app.*은 WARNING 이상만 나온다.
    처리기는 app이나 루트 로거에 이미 있으면 붙이지 않는다(같은 줄이 두 번 찍히지 않게). 답변·질문 원문은 남기지 않는다."""
    app_log = logging.getLogger("app")
    app_log.setLevel(logging.INFO)
    if not app_log.handlers and not logging.getLogger().handlers:
        handler = _StderrHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        app_log.addHandler(handler)


_setup_app_logging()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.check()  # 띄워도 동작할 수 없는 설정(인증을 켰는데 JWT 비밀값 없음 등)이면 시작하지 않는다
    init_db()
    if settings.stt_provider not in ("local", "off"):
        logging.getLogger(__name__).warning("STT_PROVIDER=%r is not local|off: transcription is off",
                                            settings.stt_provider)
    if settings.followup_model not in ("local", "off"):
        logging.getLogger(__name__).warning("FOLLOWUP_MODEL=%r is not local|off: follow-up questions use templates",
                                            settings.followup_model)
    if settings.followup_preload and settings.followup_model == "local":
        # 배포용: 첫 요청 전에 꼬리질문 모델을 불러 둔다. 내려받기·로딩이 길 수 있어 시작을 막지 않고 뒤에서 돈다
        # (그동안 /health.followup.state는 loading이고, 들어온 요청은 기다리지 않고 바로 "unavailable"로 고정 문장을 쓴다)
        threading.Thread(target=followup_model.preload, name="followup-preload", daemon=True).start()
    if settings.local_stt_preload and settings.stt_provider == "local":
        # 배포용: 전사 모델도 첫 녹음 전에 불러 둔다. 시작을 막지 않고 뒤에서 돈다(그동안 /health.stt.state는 loading)
        threading.Thread(target=stt.preload, name="stt-preload", daemon=True).start()
    with SessionLocal() as db:
        seed_question_bank(db)
    # 만료된 원본 녹음: 시작할 때 한 번, 이후 PURGE_INTERVAL_MIN분마다 정리(실패해도 앱은 계속 뜬다)
    await asyncio.to_thread(run_purge)
    purger = asyncio.create_task(purge_loop())
    try:
        yield
    finally:
        purger.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await purger


app = FastAPI(title="JobSeeker API (Practice · Track)", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # 크롬 확장(①)에서의 호출 허용
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(practice.router)
app.include_router(track.router)


@app.exception_handler(DataError)
async def invalid_id(_: Request, exc: DataError):
    """uuid가 아닌 id가 Postgres까지 갔을 때(라우터가 미처 거르지 못한 경우) 500 대신 404로 답한다."""
    orig = exc.orig
    if getattr(orig, "sqlstate", None) == "22P02" and "uuid" in str(orig):
        return JSONResponse(status_code=404, content={"detail": "Item not found. Check the address and try again."})
    raise exc


@app.get("/health")
def health():
    """stt: 음성 전사 제공자와 상태. followup: 로컬 꼬리질문 모델의 상태(모델을 불러오지는 않는다).
    외부 AI 서비스는 쓰지 않으므로 그 상태는 없다."""
    return {"ok": True, "stt": stt.status(), "auth_disabled": settings.auth_disabled,
            "followup": followup_model.status()}
