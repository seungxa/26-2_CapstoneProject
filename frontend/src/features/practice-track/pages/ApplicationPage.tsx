import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api";
import Diff from "../components/Diff";
import { dayLabel, updatedLabel } from "../components/track/format";
import { StageTrack } from "../components/track/StageTrack";
import { DueChip } from "../components/track/DueChip";
import { StatusChip } from "../components/track/StatusChip";
import { mergeApplicationDetail, mergeEssayItem } from "../components/track/state";
import { label, langOf } from "../labels";
import { JOB_CATEGORIES, STAGES, STATUSES, type ApplicationDetail, type ApplicationPatch, type EssayItem, type StageEvent } from "../types";

// Option values stay the stored (Korean) values the API and the extension use; only the text is English
const RESULTS: StageEvent["result"][] = ["합격", "불합격", "대기"];
const stageOptions = STAGES.map((s) => <option key={s} value={s}>{label("stage", s)}</option>);
const statusOptions = STATUSES.map((s) => <option key={s} value={s}>{label("status", s)}</option>);
const resultOptions = RESULTS.map((r) => <option key={r} value={r}>{label("result", r)}</option>);

/** 한 번에 하나만 보내는 비동기 동작. 실패하면 서버 메시지를 돌려준다(화면 전체를 오류로 바꾸지 않는다) */
function useAction() {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, onFail?: () => void) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      onFail?.();
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return { run, pending, error };
}

function EssayCard({ item, onChange, onDelete }: { item: EssayItem; onChange: (i: EssayItem) => void; onDelete: () => void }) {
  const latest = item.versions[item.versions.length - 1];
  const [draft, setDraft] = useState(latest?.content ?? "");
  const [sel, setSel] = useState<number>(latest?.version_no ?? 0);
  const [compare, setCompare] = useState(false);
  const { run, pending, error: err } = useAction();
  // 입력란에 마지막으로 채운 서버 내용. 입력란이 이 값 그대로일 때만(사용자가 고치지 않았을 때만) 새 최신 버전으로 바꾼다:
  // 저장하는 동안 이어서 쓴 글이 저장 응답에 덮이지 않는다
  const synced = useRef(latest?.content ?? "");

  useEffect(() => {
    const l = item.versions[item.versions.length - 1];
    const next = l?.content ?? "";
    const prevSynced = synced.current;
    synced.current = next;
    setDraft((d) => (d === prevSynced ? next : d));
    setSel(l?.version_no ?? 0);
  }, [item.versions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = item.versions.find((v) => v.version_no === sel);
  const prev = item.versions.find((v) => v.version_no === sel - 1);
  const over = item.char_limit != null && draft.length > item.char_limit;
  const submitted = item.versions.find((v) => v.id === item.submitted_version_id);

  // 저장 응답이 오면 위 effect가 입력란을 맞춘다: 그사이 더 쓴 글은 synced와 달라 그대로 남는다
  const save = (asSubmitted: boolean) => run(async () => onChange(await api.addVersion(item.id, { content: draft, is_submitted: asSubmitted })));
  /** 되돌리기는 사용자가 고른 내용으로 입력란을 바꾸는 동작이다 */
  const restore = (versionId: string, content: string) => run(async () => {
    const next = await api.restoreVersion(versionId);
    setDraft(content);
    synced.current = content;
    onChange(next);
  });

  return (
    <section className="card essay-card" aria-label={item.question_text}>
      <div className="row">
        <h3 className="grow" lang={langOf(item.question_text)}>{item.question_text}</h3>
        <button className="small danger" disabled={pending} onClick={onDelete}>Delete Question</button>
      </div>
      {item.submission_confirmation === "confirmed"
        ? <p className="small muted">Submitted: v{submitted?.version_no ?? "–"}</p>
        : item.submission_confirmation === "legacy_unverified"
          ? <p className="small warn-text">Marked as submitted earlier. Open the version you sent and choose Mark as Submitted.</p>
          : null}
      <div className="essay-body">
        <div className="version-list">
          {[...item.versions].reverse().map((v) => (
            <button key={v.id} className={v.version_no === sel ? "sel" : ""} aria-pressed={v.version_no === sel} onClick={() => setSel(v.version_no)}>
              <div>v{v.version_no} {v.is_submitted && <span className="chip good">Submitted</span>}</div>
              <div className="small muted">{updatedLabel(v.created_at)} · {v.char_count} chars{v.source === "extension" ? " · Extension" : ""}</div>
            </button>
          ))}
          {item.versions.length === 0 && <p className="small muted">No versions yet.</p>}
        </div>
        <div className="essay-edit">
          {selected && selected.version_no !== latest?.version_no ? (
            <>
              <div className="row small">
                <span className="grow muted">Viewing v{selected.version_no}</span>
                {prev && <label className="check-label"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />Compare with v{prev.version_no}</label>}
                <button disabled={pending} onClick={() => run(async () => onChange(await api.submitVersion(selected.id)))}>Mark as Submitted</button>
                <button disabled={pending} onClick={() => restore(selected.id, selected.content)}>Restore</button>
              </div>
              <div className="spacer" />
              {compare && prev
                ? <div lang={langOf(prev.content + selected.content)}><Diff before={prev.content} after={selected.content} /></div>
                : <div className="diff" lang={langOf(selected.content)}>{selected.content}</div>}
            </>
          ) : (
            <>
              {latest && prev && (
                <details className="fold">
                  <summary className="small">Changes from v{prev.version_no}</summary>
                  <div lang={langOf(prev.content + latest.content)}><Diff before={prev.content} after={latest.content} /></div>
                </details>
              )}
              <textarea aria-label={`Answer to ${item.question_text}`} lang={langOf(draft)} style={{ minHeight: 180 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write your answer" />
              <div className="row small">
                <span className={`grow ${over ? "err" : "muted"}`}>
                  {draft.length}{item.char_limit ? ` / ${item.char_limit}` : ""} characters ({draft.replace(/\s/g, "").length} without spaces)
                </span>
                <button disabled={pending || !draft || draft === latest?.content} onClick={() => save(false)}>Save Version</button>
                <button disabled={pending || !draft} onClick={() => save(true)}>Save as Submitted</button>
              </div>
            </>
          )}
        </div>
      </div>
      {err && <p className="err">{err}</p>}
    </section>
  );
}

function DetailsForm({ a, save, cancel, pending }: { a: ApplicationDetail; save: (body: ApplicationPatch) => Promise<unknown>; cancel: () => void; pending: boolean }) {
  const values = () => ({ company: a.company, position: a.position, job_category: a.job_category, applied_at: a.applied_at ?? "", stage: a.stage, status: a.status, url: a.url ?? "", notes: a.notes ?? "",
    deadline: a.deadline ?? "", next_step: a.next_step ?? "", next_step_on: a.next_step_on ?? "" });
  const [draft, setDraft] = useState(values);
  const synced = useRef(draft);
  useEffect(() => {
    const next = values();
    const previous = synced.current;
    synced.current = next;
    // Update untouched controls after event calculations while preserving unsaved edits.
    setDraft((current) => Object.fromEntries(Object.keys(next).map((key) => {
      const field = key as keyof typeof next;
      return [field, current[field] === previous[field] ? next[field] : current[field]];
    })) as typeof next);
  }, [a]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="details-form">
    <div className="row">
      <label className="grow">Company<input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></label>
      <label className="grow">Role<input value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} /></label>
    </div>
    <div className="row">
      <label>Job<select value={draft.job_category} onChange={(e) => setDraft({ ...draft, job_category: e.target.value })}>{[...new Set([...JOB_CATEGORIES, draft.job_category])].map((job) => <option key={job} value={job}>{label("job", job)}</option>)}</select></label>
      <label>Date applied<input type="date" value={draft.applied_at} onChange={(e) => setDraft({ ...draft, applied_at: e.target.value })} /></label>
      <label>Stage<select value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value as ApplicationDetail["stage"] })}>{stageOptions}</select></label>
      <label>Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ApplicationDetail["status"] })}>{statusOptions}</select></label>
    </div>
    <div className="row">
      <label>Deadline<input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} /></label>
      <label className="grow">Next step<input maxLength={40} placeholder="e.g. 1st interview" lang={langOf(draft.next_step)} value={draft.next_step} onChange={(e) => setDraft({ ...draft, next_step: e.target.value })} /></label>
      <label>Next step date<input type="date" value={draft.next_step_on} onChange={(e) => setDraft({ ...draft, next_step_on: e.target.value })} /></label>
    </div>
    <label>Job posting URL<input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></label>
    <label>Notes<textarea lang={langOf(draft.notes)} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
    <p className="small muted">A stage or status you set here stays until you choose Follow Results.</p>
    <div className="row">
      <button className="primary" disabled={pending || !draft.company.trim() || !draft.position.trim()} onClick={() => {
        const body: ApplicationPatch = { company: draft.company, position: draft.position, job_category: draft.job_category, applied_at: draft.applied_at || null, url: draft.url || null, notes: draft.notes || null,
          deadline: draft.deadline || null, next_step: draft.next_step.trim() || null, next_step_on: draft.next_step_on || null };
        if (draft.stage !== a.stage) body.stage = draft.stage;
        if (draft.status !== a.status) body.status = draft.status;
        void save(body);
      }}>Save</button>
      <button disabled={pending} onClick={cancel}>Cancel</button>
    </div>
  </div>;
}

type Area = "details" | "stages" | "essays";

export default function ApplicationPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const ids = useId();
  const [a, setA] = useState<ApplicationDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const route = useRef({ id, generation: 0 });
  const deletedEssays = useRef(new Set<string>());
  if (route.current.id !== id) {
    route.current = { id, generation: route.current.generation + 1 };
    deletedEssays.current = new Set();
  }
  const generation = route.current.generation;
  const currentId = useRef(id);
  currentId.current = id;
  const latestRequest = useRef(0);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editing, setEditing] = useState<StageEvent | null>(null);
  const [baseline, setBaseline] = useState({ stage: "서류", status: "진행중" });
  const [ev, setEv] = useState({ stage: "서류", result: "합격", event_date: "", memo: "" });
  const [newEssay, setNewEssay] = useState({ question_text: "", char_limit: "" });

  // Full-detail actions and individual cards can complete independently.
  const applyDetail = (next: ApplicationDetail) => {
    setA((current) => route.current.generation === generation && next.id === route.current.id
      ? mergeApplicationDetail(current, next, deletedEssays.current)
      : current);
  };
  const applyEssay = (next: EssayItem, allowAdd = false) => {
    setA((current) => {
      if (current?.id !== id || route.current.generation !== generation || deletedEssays.current.has(next.id)) return current;
      const exists = current.essay_items.some((item) => item.id === next.id);
      return { ...current, essay_items: exists
        ? current.essay_items.map((item) => item.id === next.id ? mergeEssayItem(item, next) : item)
        : allowAdd ? [...current.essay_items, next] : current.essay_items };
    });
  };
  const reload = () => {
    const request = ++latestRequest.current;
    return api.application(id).then((next) => { if (route.current.generation === generation && request === latestRequest.current) { applyDetail(next); setErr(null); } }).catch((e) => { if (route.current.generation === generation && request === latestRequest.current) setErr(e.message); });
  };
  // 수정·기록·삭제는 한 번에 하나씩 보내고, 실패하면 메시지를 보여 준 뒤 서버 상태로 다시 맞춘다.
  // 오류는 그 동작을 누른 구역 옆에 보인다
  const { run, pending, error: actionErr } = useAction();
  const [errorAt, setErrorAt] = useState<Area>("details");
  const act = (at: Area, fn: () => Promise<unknown>, onFail?: () => void) => {
    if (pending) return Promise.resolve();
    setErrorAt(at);
    return run(fn, onFail);
  };
  const errorIn = (at: Area) => actionErr && errorAt === at ? <p className="err" role="alert">{actionErr}</p> : null;
  useEffect(() => {
    setA(null);
    setErr(null);
    setEditing(null);
    setEditingDetails(false);
    reload();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (a) setEv((e) => ({ ...e, stage: a.stage }));
  }, [a?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="err">{err}</p>;
  if (!a) return <p className="muted">Loading…</p>;

  const requiresBaseline = a.state_requires_baseline ?? a.state_source === "legacy";
  const sameRoute = (appId: string) => currentId.current === appId && route.current.generation === generation;
  const patch = async (b: ApplicationPatch) => { const next = await api.updateApplication(a.id, b); if (sameRoute(next.id)) applyDetail(next); };

  return (
    <>
      <div className="app-head">
        <h1 lang={langOf(a.company + a.position)}>{a.company} · {a.position}</h1>
        <span className="chip" data-testid="application-stage">{label("stage", a.stage)}</span>
        <StatusChip status={a.status} testId="application-status" />
        <DueChip app={a} />
        <button className="primary app-practice" onClick={() => nav(`/practice?application=${a.id}`)}>Practice for This Application</button>
      </div>
      <StageTrack a={a} />

      <div className="grid2">
        <section className="card" aria-labelledby={`${ids}-details`}>
          <div className="row card-head">
            <h2 id={`${ids}-details`} className="grow">Details</h2>
            {!editingDetails && <button onClick={() => setEditingDetails(true)}>Edit</button>}
          </div>
          {editingDetails ? (
            <DetailsForm key={a.id} a={a} pending={pending} cancel={() => setEditingDetails(false)}
              save={(body) => act("details", async () => { await patch(body); if (sameRoute(a.id)) setEditingDetails(false); })} />
          ) : (
            <>
              <dl className="facts">
                <dt>Job</dt><dd>{label("job", a.job_category)}</dd>
                {a.applied_at && <><dt>Date applied</dt><dd>{dayLabel(a.applied_at)}</dd></>}
                {a.deadline && <><dt>Deadline</dt><dd>{dayLabel(a.deadline)}</dd></>}
                {(a.next_step || a.next_step_on) && <><dt>Next step</dt><dd lang={langOf(a.next_step ?? "")}>{[a.next_step, a.next_step_on && dayLabel(a.next_step_on)].filter(Boolean).join(" · ")}</dd></>}
                {a.url && <><dt>Job posting</dt><dd>
                  <a href={a.url} target="_blank" rel="noreferrer" aria-describedby={`${ids}-new-tab`}>Open Posting<span aria-hidden="true"> ↗</span></a>
                  <span id={`${ids}-new-tab`} hidden>Opens in a new tab</span>
                </dd></>}
                {a.notes && <><dt>Notes</dt><dd lang={langOf(a.notes)}>{a.notes}</dd></>}
              </dl>
              <button className="small danger" disabled={pending} onClick={() => { if (confirm("Delete this application and all its essays?")) act("details", async () => { await api.deleteApplication(a.id); if (sameRoute(a.id)) nav("/track"); }); }}>Delete Application</button>
            </>
          )}
          {errorIn("details")}
        </section>

        <section className="card" aria-labelledby={`${ids}-stages`}>
          <h2 id={`${ids}-stages`}>Stages</h2>
          {a.events.length === 0 ? <p className="muted">No results yet.</p> : (
            <div className="table-scroll"><table>
              <tbody>
                {a.events.map((e) => {
                  const name = `${label("stage", e.stage)} ${dayLabel(e.event_date)}`;
                  return (
                    <tr key={e.id}>
                      <td className="muted small event-date">{dayLabel(e.event_date)}</td>
                      <td className="event-main">
                        <span className="nowrap">{label("stage", e.stage)}</span> <StatusChip status={e.result} kind="result" />
                        {e.memo && <div className="small event-note" lang={langOf(e.memo)}>{e.memo}</div>}
                      </td>
                      <td className="row-actions">
                        <button className="small" aria-label={`Edit result: ${name}`} disabled={pending} onClick={() => setEditing(e)}>Edit</button>
                        <button aria-label={`Delete result: ${name}`} className="small danger" disabled={pending} onClick={() => act("stages", async () => { await api.deleteEvent(e.id); await reload(); }, reload)}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
          {editing && <fieldset className="event-edit">
            <legend>Edit Result</legend>
            <div className="row">
              <label>Stage<select value={editing.stage} onChange={(e) => setEditing({ ...editing, stage: e.target.value as StageEvent["stage"] })}>{stageOptions}</select></label>
              <label>Result<select value={editing.result} onChange={(e) => setEditing({ ...editing, result: e.target.value as StageEvent["result"] })}>{resultOptions}</select></label>
              <label>Date<input type="date" value={editing.event_date} onChange={(e) => setEditing({ ...editing, event_date: e.target.value })} /></label>
              <label className="grow">Note<input lang={langOf(editing.memo)} value={editing.memo ?? ""} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} /></label>
            </div>
            <div className="spacer" />
            <div className="row">
              <button className="primary" disabled={pending || !editing.event_date} onClick={() => act("stages", async () => { await api.updateEvent(editing.id, { stage: editing.stage, result: editing.result, event_date: editing.event_date, memo: editing.memo }); setEditing(null); await reload(); })}>Save</button>
              <button disabled={pending} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </fieldset>}
          <div className="row event-add">
            <select aria-label="New result stage" value={ev.stage} onChange={(e) => setEv({ ...ev, stage: e.target.value })}>{stageOptions}</select>
            <select aria-label="New result" value={ev.result} onChange={(e) => setEv({ ...ev, result: e.target.value })}>{resultOptions}</select>
            <input aria-label="New result date" type="date" value={ev.event_date} onChange={(e) => setEv({ ...ev, event_date: e.target.value })} />
            <input aria-label="New result note" className="grow" lang={langOf(ev.memo)} placeholder="Note, e.g. questions asked" value={ev.memo} onChange={(e) => setEv({ ...ev, memo: e.target.value })} />
            <button disabled={pending} onClick={() => act("stages", async () => {
              const next = await api.addEvent(a.id, { stage: ev.stage, result: ev.result, event_date: ev.event_date || undefined, memo: ev.memo || undefined });
              if (sameRoute(a.id)) applyDetail(next);
              setEv({ ...ev, memo: "" });
            })}>Add Result</button>
          </div>
          {a.state_source !== "events" && <div className="state-mode">
            <p className="small muted">{a.state_source === "manual" ? "Set by hand." : "Kept from older data."} New results won't change the stage or status.</p>
            {requiresBaseline && <div className="row">
              <label>Stage before these results<select value={baseline.stage} onChange={(e) => setBaseline({ ...baseline, stage: e.target.value })}>{stageOptions}</select></label>
              <label>Status before these results<select value={baseline.status} onChange={(e) => setBaseline({ ...baseline, status: e.target.value })}>{statusOptions}</select></label>
            </div>}
            <button disabled={pending} onClick={() => act("stages", async () => { await api.useEventState(a.id, requiresBaseline ? { baseline_stage: baseline.stage as ApplicationDetail["stage"], baseline_status: baseline.status as ApplicationDetail["status"] } : {}); await reload(); })}>Follow Results</button>
          </div>}
          {errorIn("stages")}
        </section>
      </div>

      <section className="essays" aria-labelledby={`${ids}-essays`}>
        <h2 id={`${ids}-essays`}>Essays</h2>
        {a.essay_items.map((item) => (
          <EssayCard key={item.id} item={item}
            onChange={(next) => applyEssay(next)}
            onDelete={() => { if (confirm("Delete this question and all its versions?")) act("essays", async () => {
              await api.deleteEssay(item.id);
              if (route.current.generation !== generation) return;
              deletedEssays.current.add(item.id);
              setA((current) => current?.id === id ? { ...current, essay_items: current.essay_items.filter((essay) => essay.id !== item.id) } : current);
              await reload();
            }, reload); }} />
        ))}
        <div className="card">
          <div className="row">
            <input aria-label="New question" className="grow" lang={langOf(newEssay.question_text)} placeholder="Add a question from the application" value={newEssay.question_text} onChange={(e) => setNewEssay({ ...newEssay, question_text: e.target.value })} />
            <input aria-label="Character limit" className="char-limit" type="number" placeholder="Char limit" value={newEssay.char_limit} onChange={(e) => setNewEssay({ ...newEssay, char_limit: e.target.value })} />
            <button disabled={pending || !newEssay.question_text.trim()} onClick={() => act("essays", async () => {
              const next = await api.addEssay(a.id, { question_text: newEssay.question_text.trim(), char_limit: newEssay.char_limit ? +newEssay.char_limit : null });
              applyEssay(next, true);
              if (route.current.generation === generation) setNewEssay({ question_text: "", char_limit: "" });
              await reload();
            })}>Add Question</button>
          </div>
          {errorIn("essays")}
        </div>
      </section>
    </>
  );
}
