import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api } from "../api";
import { FrozenClassification } from "../components/ClassificationControls";
import { saveVoiceSegment, clearVoiceSegment, type DeliverySummary } from "../delivery/voice";
import CameraPanel from "../components/CameraPanel";
import ConsentPanel from "../components/ConsentPanel";
import { useFaceAnalysis } from "../components/useFaceAnalysis";
import { useRecorder } from "../components/useRecorder";
import { label } from "../labels";
import { transcriptionNotice } from "../sttText";
import type { PracticeAnswer, PracticeSession, PracticeSettings, SttStatus } from "../types";
import { saveVideoSegment, clearVideoSegment, type SegmentSummary } from "../video/metrics";

type Phase = "ready" | "prep" | "answer" | "uploading" | "reviewing";
const fmt = (s: number) => `${Math.floor(Math.max(0, Math.ceil(s)) / 60)}:${String(Math.max(0, Math.ceil(s)) % 60).padStart(2, "0")}`;

export default function SessionRunner() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [liveHints,setLiveHints]=useState(true);
  const [inputMode, setInputMode] = useState<"audio" | "text">("audio");
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [busy, setBusy] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  // 녹음 동의: 녹음으로 답할 때만 필요하다(글 답변에는 묻지 않는다)
  const [consent, setConsent] = useState<"checking" | "ok" | "needed">("checking");
  const [prefs, setPrefs] = useState<PracticeSettings | null>(null);
  // 서버가 403(동의 없음)을 돌려준 동작. 동의하면 이어서 다시 한다
  const [consentFor, setConsentFor] = useState<"upload" | "transcribe" | null>(null);
  // 전사 상태: 꺼져 있거나 고장이면 녹음 버튼 바로 아래에 한 줄로 알린다. 못 불러오면 아무것도 말하지 않고,
  // 동의 카드도 전사를 약속하지 않는다(확인된 경우에만 약속한다)
  const [stt, setStt] = useState<SttStatus | null>(null);
  // 답변 입력란과 그 이름. 이름은 for로 잇는다(입력란을 label로 감싸면 초기 값이 이름에 섞인다)
  const answerField = useId();
  const rec = useRecorder();
  const { start, stop, ensureStream } = rec;
  // 선택 기능. 꺼져 있거나 실패해도 아래 흐름은 그대로다(답변 시작·끝에서 기록 구간만 알린다)
  const cam = useFaceAnalysis();
  const { beginSegment, endSegment } = cam;
  const deadline = useRef(0);
  const processing = useRef(false);
  const pendingAudio = useRef<{ blob: Blob; durationSec: number; delivery?: DeliverySummary } | null>(null);
  const pendingVideo=useRef<SegmentSummary|null>(null);

  useEffect(() => {
    let alive = true;
    api.session(id).then((s) => {
      if (!alive) return;
      setSession(s);
      if (s.finished_at) { nav(`/practice/sessions/${id}`, { replace: true }); return; }
      // 원본 녹음은 전사가 끝나면 지워질 수 있으니 녹음 여부는 recorded_at으로 본다
      const next = s.answers.findIndex((a) => !a.recorded_at && !a.transcript?.trim());
      setIdx(next === -1 ? Math.max(0, s.answers.length - 1) : next);
      if (next === -1) {
        setDraft(s.answers[s.answers.length - 1]?.transcript ?? "");
        setPhase("reviewing");
      } else setPhase("ready");
    }).catch((e) => setErr(e.message));
    return () => { alive = false; };
  }, [id, nav]);

  useEffect(() => {
    let alive = true;
    api.health().then((h) => { if (alive) setStt(h.stt); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /** 설정을 불러온다. 못 불러와도 연습은 막지 않는다(업로드가 403이면 그때 동의를 받는다). */
  const loadPrefs = useCallback(() => api.settings().then((st) => { setPrefs(st); return st; }), []);
  useEffect(() => {
    loadPrefs().then((st) => setConsent(st.consented_at ? "ok" : "needed")).catch(() => setConsent("ok"));
  }, [loadPrefs]);
  /** 다른 곳에서 동의를 철회한 경우: 서버가 녹음을 받지 않았다. 동의하면 같은 동작을 다시 한다 */
  const askConsent = useCallback((action: "upload" | "transcribe") => {
    setConsent("needed");
    setConsentFor(action);
    loadPrefs().catch(() => {}); // 동의 패널의 보관 체크를 지금 설정으로
  }, [loadPrefs]);

  const mock = session?.mode === "mock";
  const answer = session?.answers[idx];
  const updateAnswer = useCallback((a: PracticeAnswer) => {
    setSession((s) => s ? { ...s, answers: s.answers.map((x) => x.id === a.id ? a : x) } : s);
  }, []);

  const finishAnswer = useCallback(async () => {
    if (!answer || processing.current) return;
    processing.current = true;
    setPhase("uploading");
    setErr(null);
    // 카메라 구간 요약은 첫 호출에서만 나온다(녹음 저장을 다시 시도할 때는 null이라 저장한 값을 덮지 않음)
    if (inputMode === "audio") pendingVideo.current ??= endSegment();
    else { endSegment(); pendingVideo.current=null; clearVideoSegment(id,answer.id); clearVoiceSegment(id,answer.id); }
    try {
      let saved: PracticeAnswer;
      if (inputMode === "audio") {
        pendingAudio.current ??= await stop();
        const recording = pendingAudio.current;
        if (!recording?.blob.size) throw new Error("No sound was recorded. Check your microphone, or choose Type Instead to write your answer.");
        saved = await api.uploadAudio(answer.id, recording.blob, recording.durationSec);
        // Only a successful saved recording revision may own browser-only reports.
        clearVideoSegment(id,answer.id); clearVoiceSegment(id,answer.id);
        if(saved.recorded_at) {
          if(pendingVideo.current) saveVideoSegment(id,answer.id,pendingVideo.current,saved.recorded_at);
          if(recording.delivery) saveVoiceSegment(id,answer.id,recording.delivery,saved.recorded_at,saved.transcript);
        }
        pendingAudio.current = null; pendingVideo.current=null;
      } else {
        saved = await api.reflect(answer.id, { transcript: draftRef.current.trim() || null, input_mode: "text" });
      }
      updateAnswer(saved);
      setDraft(saved.transcript ?? "");
      setUploadFailed(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) askConsent("upload");
      else setErr((e as Error).message);
      setUploadFailed(inputMode === "audio" && !!pendingAudio.current);
    } finally {
      processing.current = false;
      setPhase("reviewing");
    }
  }, [answer, askConsent, endSegment, id, inputMode, stop, updateAnswer]);

  const beginAnswer = useCallback(async () => {
    try {
      if (inputMode === "audio") { await start(); beginSegment(); }
      setPhase("answer");
      if (session) {
        deadline.current = performance.now() + session.answer_sec * 1000;
        setLeft(session.answer_sec);
      }
    } catch { setPhase("ready"); }
  }, [beginSegment, inputMode, start, session]);

  // 마이크 권한을 묻는 동안 '답변 시작'을 다시 눌러도 한 번만 시작한다(녹음기가 둘 생기지 않게)
  const starting = useRef(false);
  const [startingUi, setStartingUi] = useState(false);
  const beginQuestion = async () => {
    if (!session || starting.current) return;
    starting.current = true;
    setStartingUi(true);
    try {
      setErr(null);
      pendingAudio.current=null; pendingVideo.current=null;
      if(answer) {clearVideoSegment(id,answer.id);clearVoiceSegment(id,answer.id);}
      setDraft("");
      setUploadFailed(false);
      setConsentFor(null); // 앞 질문에서 띄운 동의 패널(다시 전사 등)은 이 질문과 상관없다
      try { if (inputMode === "audio") await ensureStream(); } catch { return; }
      if (mock && session.prep_sec > 0) {
        deadline.current = performance.now() + session.prep_sec * 1000;
        setLeft(session.prep_sec);
        setPhase("prep");
      } else await beginAnswer();
    } finally {
      starting.current = false;
      setStartingUi(false);
    }
  };

  useEffect(() => {
    if (phase !== "prep" && !(phase === "answer" && mock)) return;
    const t = setInterval(() => {
      const remain = (deadline.current - performance.now()) / 1000;
      setLeft(remain);
      if (remain <= 0) { clearInterval(t); void (phase === "prep" ? beginAnswer() : finishAnswer()); }
    }, 200);
    return () => clearInterval(t);
  }, [phase, mock, beginAnswer, finishAnswer]);

  useEffect(() => {
    if (phase !== "answer" || mock) return;
    const began = performance.now();
    const t = setInterval(() => setLeft((performance.now() - began) / 1000), 250);
    return () => clearInterval(t);
  }, [phase, mock]);

  const retranscribe = async () => {
    if (!answer || processing.current) return;
    processing.current = true; setBusy(true); setErr(null);
    // 입력란이 서버 전사문과 같은가(고친 내용은 아래에서 먼저 저장한다). 저장하지 못했으면 다시 맞출 때 입력란을 덮지 않는다
    let saved = draft === (answer.transcript ?? "");
    try {
      if (!saved) { updateAnswer(await api.reflect(answer.id, { transcript: draft.trim() || null, input_mode: inputMode === "text" ? "text" : "transcript" })); saved = true; }
      const recognized = await api.retryTranscribe(answer.id);
      updateAnswer(recognized); setDraft(recognized.transcript ?? draft);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) askConsent("transcribe");
      else setErr((e as Error).message);
      // 서버 상태로 다시 맞춘다: 그 사이 원본이 지워졌으면(404) '녹음은 보관되어 있어요'와 다시 시도 버튼을 내린다.
      // 실패해도 서버가 이미 얻은 전사문을 남겼을 수 있다(전사 중 동의 철회): 입력란도 맞춘다. 맞추지 않으면 '다음 질문'이
      // 입력란과 다르다고 보고 그 전사문을 빈 입력란으로 덮어쓴다. 다 맞출 때까지 입력란은 잠가 둔다(busy)
      const cur = await api.session(id).then((s) => s.answers.find((x) => x.id === answer.id)).catch(() => undefined);
      if (cur) {
        updateAnswer(cur);
        if (saved) setDraft(cur.transcript ?? "");
      }
    }
    finally { processing.current = false; setBusy(false); }
  };

  /** 다음으로 넘어가지 않고 이 답변만 저장한다 */
  const saveOnly = async () => {
    if (!answer || processing.current) return;
    processing.current = true;
    setBusy(true); setErr(null);
    try { updateAnswer(await api.reflect(answer.id, { transcript: draft.trim(), input_mode: inputMode === "text" ? "text" : "transcript" })); }
    catch (e) { setErr((e as Error).message); }
    finally { processing.current = false; setBusy(false); }
  };

  const consentPanel = (notice: string | null, buttonLabel: string, then: () => void) => (
    <ConsentPanel retentionDays={prefs?.retention_days} initialKeepAudio={prefs?.keep_audio} notice={notice} buttonLabel={buttonLabel}
      transcription={stt?.available === true}
      onConsented={(st) => { setPrefs(st); setConsent("ok"); setConsentFor(null); setErr(null); then(); }} />
  );

  const next = async (withFollowup = false, save = true) => {
    if (!answer || !session || processing.current) return;
    processing.current = true;
    setBusy(true);
    setErr(null);
    try {
      if (save && draft !== (answer.transcript ?? "")) {
        updateAnswer(await api.reflect(answer.id, { transcript: draft.trim() || null, input_mode: inputMode === "text" ? "text" : "transcript" }));
      }
      if (withFollowup) {
        const updated = await api.followup(answer.id);
        setSession(updated);
        setIdx(updated.answers.findIndex((a) => a.parent_answer_id === answer.id));
      } else if (idx + 1 < session.answers.length) setIdx(idx + 1);
      else {
        await api.finishSession(session.id);
        nav(`/practice/sessions/${session.id}`);
        return;
      }
      setDraft("");
      setConsentFor(null); // 앞 답변의 동의 패널을 다음 질문에 남기지 않는다
      setPhase("ready");
    } catch (e) { setErr((e as Error).message); }
    finally { processing.current = false; setBusy(false); }
  };

  /** End Practice finishes the practice (it can't be continued later), after a confirm when questions are left.
   * A changed answer in the box is saved first, as Next Question would (not while a recording is still unsaved: that
   * question counts as unanswered). Blocked while answering or saving */
  const endPractice = async () => {
    if (!session || processing.current || phase === "answer" || phase === "uploading") return;
    const edited = phase === "reviewing" && !uploadFailed && !!answer && draft !== (answer.transcript ?? "");
    const left = session.answers.filter((a) => !a.recorded_at && !(edited && a.id === answer?.id ? draft : a.transcript)?.trim()).length;
    if (left > 0 && !confirm(`End practice now? ${left} unanswered ${left === 1 ? "question" : "questions"} will be skipped. You can't continue this practice later.`)) return;
    processing.current = true;
    setBusy(true);
    setErr(null);
    try {
      if (edited && answer) updateAnswer(await api.reflect(answer.id, { transcript: draft.trim() || null, input_mode: inputMode === "text" ? "text" : "transcript" }));
      await api.finishSession(session.id);
      nav(`/practice/sessions/${session.id}`);
    } catch (e) { setErr((e as Error).message); }
    finally { processing.current = false; setBusy(false); }
  };

  if (err && !session) return <p className="err" role="alert">{err}</p>;
  if (!session || consent === "checking") return <p className="muted" role="status">Loading…</p>;
  if (!answer) return <div className="card"><Link to={`/practice/sessions/${id}`}>See Review</Link></div>;
  // 녹음으로 답하려면 먼저 동의해야 한다: 그동안 주 버튼은 기다리고, 동의 카드의 버튼이 주 동작이다
  const needsConsent = inputMode === "audio" && consent === "needed";
  /** Retrying only makes sense when the server can transcribe; hidden once /health says it can't (unknown keeps it) */
  const retryable = !stt || stt.available;
  const notice = inputMode === "audio" && stt ? transcriptionNotice(stt) : null;
  const ctx = session.context_snapshot;
  const application = ctx?.company ? [ctx.company, ctx.position].filter(Boolean).join(" · ") : null;
  // 다시 연습 세션: 이 질문을 고른 이유(지난번 다음 연습)를 한 줄로 보인다. 예전 기록은 한국어일 수 있다
  const focus = ctx?.drill_targets?.find((t) => t.question_id === answer.question.id)?.next_action?.trim() || null;
  // 시작 시점 분류(Tags)가 이미 Follow-up을 보이면 칩을 하나 더 달지 않는다
  const followupChip = !!answer.parent_answer_id && answer.question_classification?.question_role !== "followup";
  const phaseLine = [inputMode === "audio" && "Recording", mock && "Time left"].filter(Boolean).join(" · ");
  const answerLabel = inputMode === "audio" && answer.recorded_at ? "Transcript (editable)" : "Your answer";
  const retrySave = uploadFailed && consentFor !== "upload";
  const typeInstead = inputMode === "audio" && (uploadFailed || !answer.recorded_at);
  return <div className="runner">
    <header className="runner-head">
      <h1>Question {idx + 1} of {session.answers.length}</h1>
      <button disabled={busy || phase === "answer" || phase === "uploading"} onClick={() => void endPractice()}>End Practice</button>
    </header>
    {application && <p className="runner-app small muted" data-testid="runner-application" lang="ko">{application}</p>}
    {focus && <p className="runner-focus small muted" data-testid="runner-focus">Work on: <span lang={/[가-힣]/.test(focus) ? "ko" : undefined}>{focus}</span></p>}
    <section className="card runner-card">
      <div className="row small">
        <span className="chip">{label("category", answer.question.category)}</span>
        {mock && <span className="chip accent">Mock Interview</span>}
        {followupChip && <span className="chip accent">Follow-up</span>}
        <FrozenClassification snapshot={answer.question_classification}/>
      </div>
      {answer.followup_reason && <p className="followup-reason">{answer.followup_reason}</p>}
      <div className="runner-q" lang="ko">{answer.question.text}</div>
      {phase === "ready" && <div className="runner-main">
        <div className="timer">{fmt(mock ? session.answer_sec : 0)}</div>
        <div className="row">
          <button className={needsConsent ? undefined : "primary"} disabled={startingUi || needsConsent} onClick={beginQuestion}>Start Answer</button>
          <button disabled={busy} onClick={() => next(false, false)}>Skip</button>
        </div>
        {notice && <p className="small warn-text">{notice}</p>}
      </div>}
      {phase === "prep" && <div className="runner-main">
        <p className="phase">Prep time</p>
        <div className="timer">{fmt(left)}</div>
        <div className="row"><button className="primary" onClick={beginAnswer}>Start Now</button></div>
      </div>}
      {phase === "answer" && <div className="runner-main">
        {phaseLine && <p className="phase">{phaseLine}</p>}
        <div className="timer">{fmt(left)}</div>
        {inputMode === "audio" ? <div className="level" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rec.level * 100)}><div style={{ width: `${rec.level * 100}%` }} /></div> :
          <div className="field"><label htmlFor={answerField}>Your answer</label><textarea id={answerField} autoFocus lang="ko" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>}
        <div className="row"><button className="primary" onClick={finishAnswer}>Finish Answer</button></div>
      </div>}
      {phase === "uploading" && <p className="runner-main" role="status">Saving your answer…</p>}
      {phase === "reviewing" && <div className="runner-review">
        {answer.audio_available && answer.stt_status !== "done" && <div className="row small">
          <p className="warn-text grow">{answer.stt_status === "failed" && retryable ? "Couldn't transcribe this recording. Type your answer below, or retry." : answer.stt_status === "failed" ? "Couldn't transcribe this recording. Type your answer below." : "This recording wasn't transcribed. Type your answer below."}</p>
          {retryable && <button disabled={busy || uploadFailed} onClick={retranscribe}>Retry Transcription</button>}
        </div>}
        {answer.recorded_at && answer.audio_deleted_at && !answer.transcript?.trim() && <p className="small warn-text">The recording was deleted. Type your answer below.</p>}
        {consentFor === "upload" && uploadFailed && consentPanel("Agree first to save the answer you just recorded.", "Agree & Save Recording", () => void finishAnswer())}
        {/* 다시 전사할 원본이 있을 때만 묻는다(글 답변이거나 원본을 지웠으면 동의해도 할 일이 없다) */}
        {consentFor === "transcribe" && answer.audio_available && consentPanel("Agree first to transcribe this answer again.", "Agree & Retry Transcription", () => void retranscribe())}
        <div className="field"><label htmlFor={answerField}>{answerLabel}</label><textarea id={answerField} lang="ko" disabled={busy} value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
        <div className="row">
          <button className="primary" disabled={busy || uploadFailed} onClick={() => next()}>{idx + 1 < session.answers.length ? "Next Question" : "Finish & Review"}</button>
          {session.followups_enabled && !answer.parent_answer_id && <button disabled={busy || uploadFailed || !draft.trim()} onClick={() => next(true)}>Ask a Follow-up</button>}
          <button className="link" disabled={busy || uploadFailed || !draft.trim()} onClick={saveOnly}>Save Answer</button>
        </div>
        {(retrySave || typeInstead) && <div className="row">
          {retrySave && <button onClick={finishAnswer}>Retry Saving Recording</button>}
          {typeInstead && <button onClick={() => {
            pendingAudio.current = null; pendingVideo.current=null; clearVideoSegment(id,answer.id);clearVoiceSegment(id,answer.id); setUploadFailed(false); setInputMode("text"); setErr(null); setConsentFor(null);
          }}>Type Instead</button>}
        </div>}
        {busy && <p className="small muted" role="status">One moment…</p>}
      </div>}
      {(rec.error || err) && <p className="err runner-error" role="alert">{err || rec.error}</p>}
      <div className="runner-tools">
        {phase === "ready" && <div className="row input-choice" role="radiogroup" aria-label="Answer by">
          <label className="check-label"><input type="radio" name="input-mode" checked={inputMode === "audio"} onChange={() => setInputMode("audio")} />Record</label>
          <label className="check-label"><input type="radio" name="input-mode" checked={inputMode === "text"} onChange={() => setInputMode("text")} />Type</label>
        </div>}
        <CameraPanel compact liveHints={liveHints} onLiveHintsChange={setLiveHints} status={cam.status} error={cam.error} face={cam.face} edge={cam.edge} diag={cam.diag} onEnable={() => void cam.enable()} onDisable={cam.disable} attachVideo={cam.attachVideo} />
      </div>
      {phase === "ready" && needsConsent && consentPanel(null, "Agree & Start", () => void beginQuestion())}
    </section>
  </div>;
}
