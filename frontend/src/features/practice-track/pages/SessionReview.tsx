import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api } from "../api";
import IntegratedCoaching, { AnswerGuidance, CompetencyPanel } from "../components/IntegratedCoaching";
import { FrozenClassification } from "../components/ClassificationControls";
import VoiceDelivery from "../components/VoiceReportCard";
import CameraDelivery from "../components/VideoReportCard";
import { clearSessionVoice, clearVoiceSegment } from "../delivery/voice";
import Stars from "../components/Stars";
import CoachingPanel from "../components/CoachingPanel";
import ConsentPanel from "../components/ConsentPanel";
import InterviewContext from "../components/InterviewContext";
import ReviewInsights from "../components/ReviewInsights";
import { label, langOf, needsWorkReason, reasonLabel } from "../labels";
import { integratedCoaching, localDeliveryFacts } from "../review/coaching";
import { answerVerdict, sessionInsights, stateName, type AnswerMetrics } from "../review/insights";
import type { CoachingRubric, InterviewContext as Context, PracticeAnswer, PracticeSession, PracticeSettings } from "../types";
import { clearSessionVideo, clearVideoSegment } from "../video/metrics";

const POLL_MS = 2500;
const POLL_GIVE_UP_MS = 120_000;
/** Said once, in the Summary (design 4.2 rule 7) */
const LIMIT_LINE = "Rule-based checks, not a hiring assessment.";

/** 자동 삭제까지 남은 날짜(올림) */
const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const length = (sec: number) => {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

/** The folded line's verdict: the current checks, or that only an earlier record exists */
function verdictName(a: PracticeAnswer, m: AnswerMetrics | undefined) {
  if (!m || (!m.recorded && !m.hasTranscript)) return "Not Answered";
  const v = answerVerdict(m);
  if (v === "점검 전" && (a.coaching_report?.input_status === "legacy_unverified" || a.ai_feedback)) return "Earlier Check";
  return stateName(v);
}

/** Transcription problems only, next to the transcript. A normal recording says nothing */
function recordingNote(a: PracticeAnswer, hasTranscript: boolean, retryable: boolean): string | null {
  const failed = a.stt_status === "failed" || a.stt_status === "unavailable";
  const what = a.stt_status === "failed" ? "Couldn't transcribe this recording" : "This recording wasn't transcribed";
  if (failed && a.audio_available) return retryable ? `${what}. Retry, or type the transcript below.` : `${what}. Type the transcript below.`;
  if (failed && !hasTranscript) return `${what}${a.audio_deleted_at ? ", and the recording was deleted" : ""}. Type the transcript below.`;
  if (!failed && a.audio_deleted_at && !a.audio_available && !hasTranscript) return "The recording was deleted, and there's no transcript.";
  return null;
}

function AnswerCard({ a, verdict, context, rubric, onChange, onReload, sessionId, onReportsChanged, onTranscriptDirty, staleForDraft, hasEarlierDraft, retryable }: {
  retryable:boolean;
  onTranscriptDirty:(id:string,dirty:boolean)=>void;
  staleForDraft:boolean;
  hasEarlierDraft:boolean;
  sessionId:string;
  onReportsChanged:()=>void;
  a: PracticeAnswer;
  verdict: string;
  context: Context | null;
  rubric: CoachingRubric | null;
  onChange: (a: PracticeAnswer) => void;
  /** 실패했을 때 서버 상태로 다시 맞춘다(중간 단계가 이미 저장됐을 수 있다) */
  onReload: () => void;
}) {
  const ids = useId();
  const [audio, setAudio] = useState<string | null>(null);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(a.transcript ?? "");
  const [note, setNote] = useState(a.reflection_note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 음성 인식 다시 시도가 403(녹음 동의 없음)이면 지금 설정으로 동의 패널을 띄운다
  const [needConsent, setNeedConsent] = useState<PracticeSettings | null>(null);
  // 서버 전사문이 바뀌면(다시 불러옴 등) 입력란을 고치지 않았을 때만 맞춘다. 실패한 다시 전사도 서버가 이미 얻은 전사문을
  // 남겼을 수 있다(전사 중 동의 철회): 맞추지 않으면 빈 입력란이 바뀐 것으로 보여 '저장'이 그 전사문을 지운다
  const shownTranscript = useRef(a.transcript ?? "");
  useEffect(() => {
    const prev = shownTranscript.current;
    const next = a.transcript ?? "";
    shownTranscript.current = next;
    setTranscript((t) => (t === prev ? next : t));
  }, [a.transcript]);

  useEffect(() => {
    setAudio(null);
    setAudioErr(null);
    if (!a.audio_available) return;
    let url: string | null = null;
    let alive = true;
    api.audioUrl(a.id)
      .then((u) => (alive ? setAudio((url = u)) : URL.revokeObjectURL(u)))
      .catch((e) => alive && setAudioErr(e.message));
    return () => {
      alive = false;
      url && URL.revokeObjectURL(url);
    };
  }, [a.id, a.audio_available, a.recorded_at]);

  /** syncText: 서버가 전사문을 새로 만든 경우에만 입력란을 덮어쓴다(작성 중인 내용 보호). */
  // 저장·점검 중에 다른 동작(별점 연속 클릭 등)이 끼어들지 않게 한 번에 하나만 보낸다
  const acting = useRef(false);
  const act = async (fn: () => Promise<PracticeAnswer>, syncText = false) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setErr(null);
    setNeedConsent(null);
    try {
      const next = await fn();
      onChange(next);
      if (syncText) setTranscript(next.transcript ?? "");
    } catch (e) {
      // 녹음을 다시 전사하려면 녹음 동의가 필요하다(다른 곳에서 철회한 경우)
      if (e instanceof ApiError && e.status === 403)
        setNeedConsent(await api.settings().catch(() => ({ consented_at: null, keep_audio: false, retention_days: 30 })));
      else setErr((e as Error).message);
      onReload();
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };

  const transcriptDirty = transcript !== (a.transcript ?? "");
  const noteDirty = note !== (a.reflection_note ?? "");
  const dirty = transcriptDirty || noteDirty;
  useEffect(() => {onTranscriptDirty(a.id, transcriptDirty);}, [a.id, transcriptDirty, onTranscriptDirty]);
  const reflectionPatch = { ...(transcriptDirty ? {transcript: transcript || null} : {}), ...(noteDirty ? {reflection_note: note || null} : {}) };
  const hasTranscript = !!a.transcript?.trim();
  // 한국어 발화 속도 참고용: 전사 글자 수 / 분
  const cpm = !transcriptDirty && a.recording_transcript_current === true && a.transcript && a.duration_sec ? Math.round((a.transcript.replace(/\s/g, "").length / a.duration_sec) * 60) : null;
  const facts = localDeliveryFacts({ id: sessionId, answers: [a] } as PracticeSession);
  const sttNote = recordingNote(a, hasTranscript, retryable);

  const retranscribe = () => act(async () => {
    if (dirty) onChange(await api.reflect(a.id, reflectionPatch));
    return api.retryTranscribe(a.id);
  }, true);

  const removeAudio = () => {
    const ask = hasTranscript ? "Delete the original recording? The transcript stays." : "There's no transcript, so nothing from this answer will be left. Delete the original recording?";
    if (confirm(ask)) act(async () => {
      const clear = () => {clearVoiceSegment(sessionId,a.id);clearVideoSegment(sessionId,a.id);onReportsChanged();};
      try { const next=await api.deleteAudio(a.id); if(!next.audio_available) clear(); return next; }
      catch(error) {
        const current=await api.session(sessionId).then(s=>s.answers.find(x=>x.id===a.id)).catch(()=>null);
        if(current&&!current.audio_available) clear();
        throw error;
      }
    });
  };

  const rating = a.self_rating;
  const checks = !staleForDraft && a.coaching_report
    ? <CoachingPanel report={a.coaching_report} context={context} rubric={rubric} showNextAction={a.coaching_report.input_status === 'legacy_unverified'} />
    : null;
  return (
    <details className="card answer-card" id={`answer-${a.id}`}>
      <summary>
        <span className="answer-q"><b>Q{a.order_no}</b> <span className="answer-q-text" lang="ko">{a.question.text}</span></span>
        <span className="answer-meta">
          {verdict}
          {rating != null && <> · <span className="answer-stars" role="img" aria-label={`Self-rating ${rating} of 5`}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span></>}
        </span>
      </summary>
      <div className="answer-body">
        <div className="row small answer-tags">
          <span className="chip">{label("category", a.question.category)}</span>
          {a.parent_answer_id && a.question_classification?.question_role !== "followup" && <span className="chip accent">Follow-up</span>}
        </div>
        <FrozenClassification snapshot={a.question_classification}/>

        <section className="answer-section">
          <h3 id={`${ids}-transcript`}>Transcript</h3>
          {a.audio_available && (
            <div className="answer-audio">
              {audio ? <audio controls src={audio} /> : audioErr ? <p className="small warn-text" data-testid="audio-error">{audioErr}</p> : <p className="muted small">Loading the recording…</p>}
              <div className="row small muted">
                {a.audio_expires_at && (
                  <span className="grow">{daysLeft(a.audio_expires_at) >= 1 ? `Deleted automatically in ${plural(daysLeft(a.audio_expires_at), "day")}` : "Deleted automatically soon"}</span>
                )}
                <button className="small danger" disabled={busy} onClick={removeAudio}>Delete Recording</button>
              </div>
            </div>
          )}
          {sttNote && (
            <div className="row small warn-text">
              <span className="grow">{sttNote}</span>
              {retryable && a.audio_available && (a.stt_status === "failed" || a.stt_status === "unavailable") && <button disabled={busy} onClick={retranscribe}>Retry Transcription</button>}
            </div>
          )}
          {/* 다시 불러온 답변에 원본이 없으면(그 사이 지움) 동의해도 다시 전사할 수 없으니 동의를 묻지 않는다 */}
          {needConsent && a.audio_available && (
            <ConsentPanel
              retentionDays={needConsent.retention_days}
              initialKeepAudio={needConsent.keep_audio}
              notice="Agree first to transcribe this answer again."
              buttonLabel="Agree & Retry Transcription"
              onConsented={retranscribe}
            />
          )}
          <textarea aria-labelledby={`${ids}-transcript`} lang="ko" disabled={busy} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Type what you said." />
          {transcriptDirty && <p role="status" data-testid="unsaved-transcript" className="small warn-text">Unsaved changes. Save, or undo them, to see this answer's checks again.</p>}
        </section>

        <section className="answer-section answer-checks">
          <h3>Checks</h3>
          {staleForDraft && <p className="small muted">{transcriptDirty ? "Paused while the transcript has unsaved changes." : "Paused while an earlier answer has unsaved changes."}</p>}
          {!staleForDraft && <AnswerGuidance a={a}>{checks}</AnswerGuidance>}
          {!staleForDraft && a.ai_feedback && !a.coaching_report && (
            <div className="ai-feedback">
              <span className="chip accent">Earlier AI Feedback</span>
              <p lang={langOf(a.ai_feedback)}>{a.ai_feedback}</p>
            </div>
          )}
          {!staleForDraft && !a.coaching_report && !a.ai_feedback && <p className="small muted">{hasTranscript ? "Not checked yet." : "Add a transcript to check this answer."}</p>}
        </section>

        {(a.recorded_at || a.duration_sec != null) && (
          <section className="answer-section">
            <h3>Delivery</h3>
            {a.duration_sec != null && <p className="small">Length {length(a.duration_sec)}{cpm != null && ` · about ${cpm} characters per minute`}</p>}
            <VoiceDelivery sessionId={sessionId} a={a} transcriptDirty={transcriptDirty} action={facts.find((f) => f.kind === "voice")?.action} onCleared={onReportsChanged} />
            <CameraDelivery sessionId={sessionId} a={a} action={facts.find((f) => f.kind === "camera")?.action} onCleared={onReportsChanged} />
          </section>
        )}

        <section className="answer-section">
          <h3>Self Rating & Note</h3>
          <Stars value={rating} disabled={busy} onChange={(v) => act(() => api.reflect(a.id, { self_rating: v }))} />
          <label htmlFor={`${ids}-note`} className="note-label">Note</label>
          <textarea id={`${ids}-note`} lang="ko" className="note" value={note} onChange={(e) => setNote(e.target.value)} />
          {noteDirty && !transcriptDirty && <p className="small muted">Your note isn't saved yet.</p>}
        </section>

        <div className="row answer-actions">
          <button disabled={busy || !dirty} onClick={() => act(() => api.reflect(a.id, reflectionPatch))}>Save</button>
          <button disabled={busy || !transcript.trim() || hasEarlierDraft} onClick={() => act(async () => {
            if (dirty) await api.reflect(a.id, reflectionPatch);
            return api.coach(a.id);
          })}>Check Answer</button>
          {busy && <span className="small muted" role="status">One moment…</span>}
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
    </details>
  );
}

export default function SessionReview() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const summaryTitle = useId();
  const [,refreshDelivery]=useState(0);
  const [s, setS] = useState<PracticeSession | null>(null);
  // Hide Retry Transcription once /health says the server can't transcribe (unknown keeps it)
  const [sttOff, setSttOff] = useState(false);
  useEffect(() => { let alive = true; api.health().then((h) => { if (alive) setSttOff(!h.stt.available); }).catch(() => {}); return () => { alive = false; }; }, []);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [dirtyTranscripts, setDirtyTranscripts] = useState<Record<string, boolean>>({});
  const onTranscriptDirty = useCallback((answerId:string,dirty:boolean) => setDirtyTranscripts(current => current[answerId]===dirty ? current : {...current,[answerId]:dirty}), []);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [redrillErr, setRedrillErr] = useState<string | null>(null);
  const [rubric, setRubric] = useState<CoachingRubric | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);

  // 늦게 온 이전 응답이 새 결과를 덮지 않도록 요청 순번을 센다
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    setRefreshBusy(true);
    try {
      const next = await api.session(id);
      if (n === seq.current) {
        setS(next);
        setRefreshPending(false);
        setRefreshError(null);
      }
    } catch (error) {
      if (n === seq.current) setRefreshError((error as Error).message);
      throw error;
    } finally {
      if (n === seq.current) setRefreshBusy(false);
    }
  }, [id]);
  const apply = (next: PracticeSession) => {
    seq.current++;
    setS(next);
    setRefreshPending(false);
    setRefreshBusy(false);
    setRefreshError(null);
  };

  useEffect(() => {
    setS(null);
    setDirtyTranscripts({});
    setRefreshPending(false);
    setRefreshError(null);
    setErr(null);
    setRedrillErr(null);
    setGaveUp(false);
    setCardErr(null);
    load().catch((e) => setErr(e.message));
    return () => {
      seq.current++;
    };
  }, [load]);

  useEffect(() => {
    api.rubric().then(setRubric).catch(() => {});
  }, []);

  // A link to #answer-… (from the Summary, the charts or a reload with that address) opens the folded card first
  const loaded = !!s;
  useEffect(() => {
    if (!loaded) return;
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return; // an undecodable hash such as "#%" points nowhere: ignore it
    }
    const target = document.getElementById(id);
    if (target instanceof HTMLDetailsElement && target.classList.contains("answer-card")) {
      target.open = true;
      target.scrollIntoView();
    }
  }, [loaded]);
  const openLinkedAnswer = (e: MouseEvent) => {
    const href = (e.target as Element).closest?.('a[href^="#answer-"]')?.getAttribute("href");
    const target = href ? document.getElementById(href.slice(1)) : null;
    if (target instanceof HTMLDetailsElement) target.open = true;
  };

  // 답변 점검·디브리프 작업이 도는 동안 2.5초마다 확인하고, 2분이 지나면 멈춘다.
  // 'pending'이어도 서버가 도는 작업이 없다고 하면(작업이 사라짐) 기다리지 않는다: 요약이 바로 'Try Again'을 보인다
  const waiting = !!s?.debrief_running;
  useEffect(() => {
    if (!waiting || gaveUp) return;
    const until = Date.now() + POLL_GIVE_UP_MS;
    let alive = true;
    let t = 0;
    const tick = async () => {
      if (Date.now() > until) return setGaveUp(true);
      try {
        await load();
      } catch {
        /* 다음 차례에 다시 확인 */
      }
      if (alive) t = window.setTimeout(tick, POLL_MS);
    };
    t = window.setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [waiting, gaveUp, load]);

  const cardAct = async (fn: () => Promise<void>) => {
    setCardBusy(true);
    setCardErr(null);
    try {
      await fn();
    } catch (e) {
      setCardErr((e as Error).message);
    } finally {
      setCardBusy(false);
    }
  };
  // 'Try Again'(작업이 사라졌거나 확인을 멈춘 뒤): 먼저 지금 상태를 다시 확인한다. 작업이 아직 돌고 있으면(마지막 진행 신호가 5분 안)
  // 재생성을 요청하지 않고 확인만 이어 가고, 'pending'인데 작업이 사라졌을 때(서버 재시작 등)만 다시 만들기를 요청한다.
  const retryDebrief = () =>
    cardAct(async () => {
      const cur = await api.session(id);
      apply(cur.debrief_status === "pending" && !cur.debrief_running ? await api.debrief(id) : cur);
      setGaveUp(false);
    });

  /** 답변이 바뀌면 바로 반영하고, 다시 연습할 답변 목록이 맞도록 세션을 다시 불러온다. */
  const onAnswer = (next: PracticeAnswer) => {
    setRefreshPending(true);
    setRefreshError(null);
    setS((cur) => {
      if (!cur) return cur;
      const previous = cur.answers.find(answer => answer.id === next.id);
      const transcriptChanged = previous?.transcript !== next.transcript;
      // Invalidate locally before the PATCH response makes the editor clean.
      // A failed or delayed authoritative GET must never revive old interpretation.
      return {...cur, debrief:null, debrief_status:"none", redrill:[], answers:cur.answers.map(answer =>
        answer.id === next.id ? next : transcriptChanged && previous && answer.order_no > previous.order_no
          ? {...answer,coaching_report:null,ai_feedback:null} : answer)};
    });
    load().catch(() => {});
  };
  const reload = () => {
    load().catch(() => {});
  };

  const removeSession = async () => {
    if (!confirm("Delete this practice? Its transcripts and recordings are deleted too.")) return;
    setErr(null);
    try {
      await api.deleteSession(id);
      clearSessionVideo(id);
      clearSessionVoice(id);
      nav("/practice/history");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (err && !s) return <p className="err" role="alert">Couldn't load this practice. {err}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  // 원본 녹음은 전사가 끝나면 지워질 수 있으니 녹음 여부는 recorded_at으로 본다
  const remaining = s.answers.filter((a) => !a.recorded_at && !a.transcript?.trim()).length;
  const firstDirtyOrder = Math.min(...s.answers.filter(a=>dirtyTranscripts[a.id]).map(a=>a.order_no));
  const hasDirtyTranscript = Number.isFinite(firstDirtyOrder);
  const view = hasDirtyTranscript ? {...s, debrief:null, debrief_status:'none' as const, redrill:[], answers:s.answers.map(a=>a.order_no>=firstDirtyOrder ? {...a, coaching_report:null, ai_feedback:null, recording_transcript_current:false} : a)} : s;
  const paused = hasDirtyTranscript || refreshPending;
  const ins = sessionInsights(view);
  const coaching = integratedCoaching(view, localDeliveryFacts(view));
  const metrics = new Map(ins.answers.map((m) => [m.id, m]));
  const answered = ins.answers.filter((m) => m.recorded || m.hasTranscript).length;
  const needsWork = ins.answers.filter((m) => Object.values(m.statuses).includes("보완")).length;
  const ratings = ins.answers.flatMap((m) => (m.rating != null ? [m.rating] : []));
  const avgRating = ratings.length ? ratings.reduce((t, r) => t + r, 0) / ratings.length : null;
  const weak = view.redrill.length;
  const next = coaching.actions[0];
  const d = view.debrief_status === "done" ? view.debrief : null;
  const lesson = d?.lesson;
  const status = view.debrief_status;
  // 'pending'인데 서버가 도는 작업이 없다고 하면 작업이 사라진 것(서버 재시작 등)이다
  const lost = status === "pending" && !view.debrief_running;
  const debriefBusy = cardBusy || paused;
  // Only sessions from before OpenAI was removed say 'failed' (their AI summary failed; the checks were kept). Say it
  // only while a saved transcript still has no checks, i.e. a card shows "Not checked yet."
  const unchecked = status === "failed" && !view.debrief_running
    && s.answers.some((a) => !!a.transcript?.trim() && !a.coaching_report && !a.ai_feedback);

  return (
    <div className="review" onClickCapture={openLinkedAnswer}>
      <div className="review-head">
        <h1>Practice · {when(s.created_at)}</h1>
        {!s.finished_at && <Link className="btn" to={`/practice/sessions/${s.id}/run`}>{remaining > 0 ? `Continue Practice (${remaining} Left)` : "Finish Practice"}</Link>}
        <button className="danger" onClick={removeSession}>Delete</button>
      </div>
      {s.mode === "mock" && <p className="small muted review-mode">Mock interview · {s.prep_sec}s to prepare · {s.answer_sec}s per answer</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {refreshError && <div data-testid="review-refresh-error" className="err row" role="alert"><span className="grow">Couldn't reload the review. {refreshError}</span><button disabled={refreshBusy} onClick={reload}>Reload Review</button></div>}

      <section className="card review-summary" aria-labelledby={summaryTitle}>
        <h2 id={summaryTitle}>Summary</h2>
        <p className="summary-counts" data-testid="summary-counts">
          {answered === 0 ? "No answers yet." : `${plural(answered, "answer")} · ${needsWork} ${needsWork === 1 ? "needs" : "need"} work${avgRating != null ? ` · Avg. self-rating ${avgRating.toFixed(1)}` : ""}`}
        </p>
        {status === "pending" && (lost || gaveUp
          ? <div className="row small warn-text"><span className="grow">{lost ? "Checking your answers stopped before it finished." : "Checking your answers is taking longer than usual."}</span><button disabled={debriefBusy} onClick={retryDebrief}>Try Again</button></div>
          : <p className="small muted" role="status">Checking your answers…</p>)}
        {unchecked && <p className="err">Couldn't check every answer. Use Check Answer on the answers without checks.</p>}
        {status !== "pending" && view.debrief_running && !gaveUp && <p className="small muted" role="status">Checking your answers…</p>}
        {cardErr && <p className="err" role="alert">{cardErr}</p>}
        {paused
          ? <p className="small muted" role="status" data-testid="integrated-content-paused">{hasDirtyTranscript ? "Save or undo your transcript changes to update the summary." : refreshError ? "The summary updates after the review reloads." : "Updating the summary…"}</p>
          : answered > 0 && next && <p className="summary-next" data-testid="summary-next">Next: <a href={`#answer-${next.answerId}`}>Q{next.order}</a> · <span lang={langOf(next.text)}>{next.text}</span></p>}
        <div className="row summary-actions">
          <button className="primary" disabled={busy || !weak} onClick={async () => {
            setBusy(true); setRedrillErr(null);
            try { const drill = await api.redrill(s.id); nav(`/practice/sessions/${drill.id}/run`); }
            catch (e) { setRedrillErr((e as Error).message); }
            finally { setBusy(false); }
          }}>Practice Weak Answers Again</button>
          {!weak && answered > 0 && !paused && <span className="small muted">Nothing to practice again yet.</span>}
        </div>
        {redrillErr && <p className="err" role="alert">{redrillErr}</p>}
        <p className="small muted summary-limit">{LIMIT_LINE}</p>
        {lesson && (
          <p className="summary-lesson" data-testid="summary-lesson">
            Earlier AI review: <span lang={langOf(lesson)}>“{lesson}”</span>
            {d?.input_status === "legacy_unverified" && <span className="small muted"> (saved by an earlier version, so it may not match your current answers)</span>}
          </p>
        )}
        {(answered > 0 || d) && (
          <details className="fold summary-details">
            <summary>Details</summary>
            {weak > 0 && (
              <div className="weak-answers">
                <h3>Answers to Practice Again</h3>
                <ul className="plain weak-list">
                  {view.redrill.map((w) => (
                    <li key={w.answer_id}>
                      <div className="small"><a href={`#answer-${w.answer_id}`}>Q{w.order_no}</a> <span lang="ko">{w.question_text}</span></div>
                      <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                        {/* Reasons stay "{criterion} 보완" / "자기평가 N점" on the server; only the screen name is English */}
                        {w.reasons.map((r) => <span key={r} className={`chip ${needsWorkReason(r) ? "needs-work" : ""}`}>{reasonLabel(r)}</span>)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!paused && answered > 0 && <IntegratedCoaching result={coaching} />}
            <ReviewInsights s={view} ins={ins} />
            <CompetencyPanel s={view} />
            {d && (d.next_action || d.moments.length > 0) && (
              <div className="earlier-review">
                <h3>Earlier AI Review</h3>
                {d.next_action && <p><b>Next:</b> <span lang={langOf(d.next_action)}>{d.next_action}</span></p>}
                {d.moments.length > 0 && (
                  <ul className="plain">
                    {d.moments.map((m, i) => (
                      <li key={i}>
                        <a href={`#answer-${m.answer_id}`} className="small">Q{m.order_no}</a>
                        <blockquote className="quote" lang={langOf(m.quote)}>“{m.quote}”</blockquote>
                        {m.why && <div className="small" lang={langOf(m.why)}>{m.why}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </details>
        )}
        <InterviewContext context={s.context_snapshot} />
      </section>

      <section aria-label="Answers" className="answer-list">
        {s.answers.map((a) => (
          <AnswerCard key={a.id} retryable={!sttOff} verdict={verdictName(a, metrics.get(a.id))} onTranscriptDirty={onTranscriptDirty} staleForDraft={a.order_no>=firstDirtyOrder} hasEarlierDraft={a.order_no>firstDirtyOrder} sessionId={s.id} onReportsChanged={()=>refreshDelivery(v=>v+1)} a={a} context={s.context_snapshot} rubric={rubric} onChange={onAnswer} onReload={reload} />
        ))}
      </section>
    </div>
  );
}
