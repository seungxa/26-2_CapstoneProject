"""세션 종료 후 자동 디브리프 작업과 다시 연습할 답변 고르기.

작업은 BackgroundTasks로 돌고 자체 DB 세션을 연다. 하는 일은 두 가지다: 코칭 보고서가 없는 답변을 /coach와 같은
경로(규칙 기반 기본 점검)로 점검하고, 다시 연습할 답변은 규칙으로 고른다(응답마다 다시 계산). 세션 요약은 만들지 않는다.
세션 행에 저장된 예전 요약(debrief)과 그 상태(debrief_status)는 읽기만 한다. 예외로, 예전 요약 작업이 남긴 'pending'은
끝낼 작업이 없으니 다음 종료·재생성 요청에서 'none'으로 정리한다.
점검하는 동안 사용자가 전사문을 고칠 수 있다. 고친 답변은 /coach처럼 409로 버리고 다음 바퀴에서 새 전사문으로 다시 점검한다.

작업은 세션 행에 표시를 남긴다: 시작 시각(debrief_started_at, 작업마다 달라 그 작업의 표시), 살아 있다는 신호
(debrief_heartbeat_at, 답변 하나를 점검할 때마다), 작업 중에 들어온 종료·재생성 요청(debrief_requested_at).
신호가 5분 넘게 끊긴 작업만 사라진 것으로 보고 새로 시작한다. 작업 중에 요청이 들어오면 작업이 끝나기 전에
한 바퀴 더 돌아 그 사이 저장된 답변까지 점검한다. 이어받힌 옛 작업은 표시를 지우지 않고 멈춘다.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from .db import SessionLocal
from .models import PracticeAnswer, PracticeSession
from .taxonomy import classification_hash
from .schemas import WeakAnswerOut
from .services import answer_coaching

log = logging.getLogger(__name__)

MAX_DRILL = 20  # 다시 연습 세션에 담는 답변 수 상한
# 작업의 마지막 신호가 이보다 오래되면 작업이 사라진 것(서버 재시작 등)으로 보고 다시 시작할 수 있다.
# 신호 사이에는 답변 하나의 기본 점검만 있다
DEBRIEF_STALE_AFTER = timedelta(minutes=5)
MAX_PASSES = 3  # 작업 중에 들어온 요청 때문에 다시 도는 횟수 상한(요청이 계속 와도 끝나게)
_JOB_FIELDS = ["debrief_status", "debrief_started_at", "debrief_heartbeat_at", "debrief_requested_at"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _has_transcript(a: PracticeAnswer) -> bool:
    return bool((a.transcript or "").strip())


def _needs_coaching(a: PracticeAnswer) -> bool:
    """전사문은 있는데 지금 전사문을 채점한 보고서가 없다. 있는 보고서(예전 AI 보고서, AI 실패로 대신 붙은
    기본 점검 포함)는 기록으로 두고 다시 점검하지 않는다."""
    return _has_transcript(a) and not a.coaching_report


def drill_picks(s: PracticeSession) -> list[tuple[PracticeAnswer, list[str], int | None]]:
    """다시 연습할 답변: 코칭에 '보완'이 있거나 자기평가가 1~2점. (답변, 보완 기준 이름, 낮은 자기평가), 세션 순서대로 최대 20개."""
    picked = []
    for a in s.answers:
        weak = [c["label"] for c in (answer_coaching.current_report(a) or {}).get("criteria", []) if c["status"] == "보완"]
        low = a.self_rating if a.self_rating in (1, 2) else None
        if weak or low:
            picked.append((a, weak, low))
        if len(picked) == MAX_DRILL:
            break
    return picked


def drill_focus(weak: list[str], low: int | None) -> list[str]:
    """다시 연습 세션(drill_targets)에 남기는 초점 이름."""
    return [*weak, *([f"자기평가 {low}점"] if low else [])]


def weak_answers(s: PracticeSession) -> list[WeakAnswerOut]:
    """화면의 '다시 연습할 답변' 목록(다시 연습 세션에 담길 답변과 같다). AI 코칭에서 나온 이유에는 'AI ·'를 붙인다."""
    out = []
    for a, weak, low in drill_picks(s):
        prefix = "AI · " if (a.coaching_report or {}).get("method") == "ai" else ""
        reasons = [f"{prefix}{label} 보완" for label in weak] + ([f"자기평가 {low}점"] if low else [])
        out.append(WeakAnswerOut(answer_id=a.id, question_id=a.question_id, order_no=a.order_no,
                                 question_text=a.question.text, reasons=reasons))
    return out


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def debrief_running(s: PracticeSession, now: datetime | None = None) -> bool:
    """디브리프 작업이 아직 도는 중인가. 작업 표시가 없거나 마지막 신호(없으면 시작 시각)가 오래됐으면 사라진 작업으로 본다."""
    if not s.debrief_started_at:
        return False
    last = s.debrief_heartbeat_at or s.debrief_started_at
    return (now or _now()) - _utc(last) < DEBRIEF_STALE_AFTER


def _lock(db: Session, session_id: str) -> None:
    """세션 행을 잠근다(짧은 쓰기). 같은 세션의 종료·재생성 요청과 작업의 마무리가 서로를 기다리게 한다."""
    answer_coaching.lock_session(db, session_id)


def prepare_debrief(db: Session, s: PracticeSession) -> bool:
    """종료·재생성 요청에서 작업을 붙일지 동기로 정한다(커밋은 호출한 쪽에서). 점검할 답변이 있어 백그라운드 작업을 붙여야 하면 True.

    저장된 요약과 상태는 바꾸지 않는다. 예전 요약 작업이 남긴 'pending'만 'none'으로 정리한다(그 작업은 다시 오지 않는다).
    이미 도는 작업이 있으면 작업을 하나 더 붙이지 않고 요청 시각만 남긴다: 그 작업이 끝나기 전에 보고 한 바퀴 더 돈다.
    """
    _lock(db, s.id)
    db.refresh(s, _JOB_FIELDS)  # 잠근 뒤 다시 읽는다: 다른 요청이 막 작업을 붙였거나 작업이 막 끝났을 수 있다
    now = _now()
    if debrief_running(s, now):
        s.debrief_requested_at = now
        return False
    if s.debrief_status == "pending":
        s.debrief_status = "none"
    start = any(_needs_coaching(a) for a in s.answers)
    if start:
        s.debrief_started_at = s.debrief_heartbeat_at = now
        s.debrief_requested_at = None
    return start


def _load(db: Session, session_id: str) -> PracticeSession | None:
    return db.scalar(
        select(PracticeSession).where(PracticeSession.id == session_id)
        .options(selectinload(PracticeSession.answers).selectinload(PracticeAnswer.question))
    )


def run_debrief(session_id: str) -> None:
    """코칭 보고서가 없는 답변을 기본 점검한다(BackgroundTask)."""
    try:
        with SessionLocal() as db:
            s = _load(db, session_id)
            if s:
                _run(db, s)
    except Exception:  # 작업 중 세션이 지워지는 등 DB 오류도 로그만 남긴다
        log.exception("세션 디브리프 작업 오류(%s)", session_id)


class _Superseded(Exception):
    """이 작업이 사라진 것으로 보여 다른 작업이 이어받았다."""


def _beat(db: Session, s: PracticeSession, mine: datetime | None) -> None:
    """작업이 살아 있다는 신호를 남긴다. 다른 작업이 이어받았으면(표시가 바뀜) 멈춘다."""
    r = db.execute(update(PracticeSession).where(PracticeSession.id == s.id, PracticeSession.debrief_started_at == mine)
                   .values(debrief_heartbeat_at=_now()), execution_options={"synchronize_session": False})
    db.commit()
    if r.rowcount != 1:
        raise _Superseded


def _coach_all(db: Session, s: PracticeSession, mine: datetime | None, tried: set[tuple[str, str]]) -> None:
    """코칭 보고서가 없는 답변을 /coach와 같은 서비스(services.answer_coaching)로 점검한다. 점검 중 전사문이 바뀐 답변은 건너뛴다."""

    # 점검하는 동안 앞 순서 답변이 새로 녹음되거나 고쳐질 수 있으니, 새로 점검할 것이 없을 때까지 다시 돈다.
    # 같은 (답변, 전사문)은 한 작업에서 한 번만 시도하므로 실패한 점검을 되풀이하지 않는다.
    for _ in range(5):
        progressed = False
        for a in list(s.answers):
            db.refresh(a)  # 앞 답변을 점검하는 동안 고친 전사문·새로 받은 보고서를 다시 읽는다
            if not _needs_coaching(a) or (a.id, a.transcript) in tried:
                continue
            tried.add((a.id, a.transcript))
            progressed = True
            try:
                answer_coaching.coach(a, db)
                db.commit()
            except answer_coaching.TranscriptChanged:  # 점검하는 동안 전사문이 바뀜(서비스가 이미 rollback)
                log.info("점검하는 동안 답변이 바뀌어 점검을 버렸습니다(%s)", a.id)
            except Exception:  # 한 답변의 점검 실패는 디브리프 전체를 막지 않는다(그 답변은 보고서 없음)
                db.rollback()
                log.exception("디브리프 중 답변 점검 실패(%s)", a.id)
            _beat(db, s, mine)
        if not progressed:
            break


def debrief_fingerprint(s: PracticeSession) -> str:
    """All interpretation inputs, including recording revisions and complete current coaching."""
    return classification_hash({"context":s.context_snapshot,"answers":[
        {"id":a.id,"question_id":a.question_id,"question":a.question.text,"order_no":a.order_no,
         "transcript":a.transcript,"self_rating":a.self_rating,"reflection_note":a.reflection_note,
         "classification":a.question_classification,"coaching":a.coaching_report,
         "recorded_at":_utc(a.recorded_at).isoformat() if a.recorded_at else None,"duration_sec":a.duration_sec}
        for a in sorted(s.answers,key=lambda a:(a.order_no,a.id))]})


def _settle(db: Session, s: PracticeSession, mine: datetime | None, pass_started: datetime, last: bool) -> bool:
    """작업을 끝낸다. 이 바퀴를 시작한 뒤 종료·재생성 요청이 들어왔으면 끝내지 않고 False(한 바퀴 더).

    세션 행을 잠그고 확인하므로, 끝내는 사이에 들어온 요청은 이 작업이 끝난 뒤 새 작업을 시작한다.
    """
    _lock(db, s.id)
    db.refresh(s, _JOB_FIELDS)
    if s.debrief_started_at != mine:
        db.rollback()
        raise _Superseded
    requested = s.debrief_requested_at
    if not last and requested and _utc(requested) >= pass_started:
        db.commit()
        return False
    s.debrief_started_at = s.debrief_heartbeat_at = s.debrief_requested_at = None  # 다음 요청은 새로 시작한다
    db.commit()
    return True


def _run(db: Session, s: PracticeSession) -> None:
    mine = s.debrief_started_at  # 이 작업의 표시
    tried: set[tuple[str, str]] = set()
    try:
        for n in range(MAX_PASSES):
            pass_started = _now()
            db.refresh(s)  # 작업 중에 생긴 답변(꼬리질문)도 담는다
            _coach_all(db, s, mine, tried)
            if _settle(db, s, mine, pass_started, last=n == MAX_PASSES - 1):
                return
    except _Superseded:
        log.info("다른 디브리프 작업이 이어받아 이 작업을 멈춥니다(%s)", s.id)
    finally:
        # 끝내지 못했으면(오류) 표시를 지워 다음 요청이 새로 시작하게 한다. 이어받은 작업의 표시는 건드리지 않는다
        db.rollback()
        db.execute(update(PracticeSession).where(PracticeSession.id == s.id, PracticeSession.debrief_started_at == mine)
                   .values(debrief_started_at=None, debrief_heartbeat_at=None),
                   execution_options={"synchronize_session": False})
        db.commit()
