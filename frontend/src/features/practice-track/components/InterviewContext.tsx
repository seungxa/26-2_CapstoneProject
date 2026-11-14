import { Link } from "react-router";
import { essaySourceLabel } from "../practice/essays";
import type { InterviewContext as Context } from "../types";

export default function InterviewContext({ context }: { context: Context | null }) {
  if (!context) return null;
  const essays = context.essays ?? [];
  return (
    <section className="card source-context">
      <div className="row"><h2 className="grow" style={{ margin: 0 }}>Practice Materials</h2>
        {context.company && <span className="chip" lang="ko">{context.company} · {context.position}</span>}
      </div>
      <p className="small muted">Saved when you started, so later essay edits don't change it.</p>
      {essays.length === 0 && <p className="small muted">No essays linked.</p>}
      {essays.map((e) => (
        <details key={e.version_id} className="source-detail">
          <summary><span lang="ko">{e.question_text}</span> <span className="chip">v{e.version_no} · {essaySourceLabel(e.selection, e.submission_confirmation)}</span></summary>
          {context.essay_basis === "submitted" && e.selection === "latest" && <p className="small muted">No submitted version, so the latest one is used.</p>}
          <p className="evidence-text" lang="ko">{e.content}</p>
        </details>
      ))}
      {context.job_description && <details className="source-detail"><summary>Job Posting</summary><p className="evidence-text" lang="ko">{context.job_description}</p></details>}
      {!!context.drill_targets?.length && <div className="drill-focus">
        <strong>Work On This Time</strong>
        {context.drill_targets.map((t) => <p key={t.answer_id}><span className="chip">{t.focus.join(" · ")}</span> {t.next_action}</p>)}
        {context.origin_session_id && <Link className="small" to={`/practice/sessions/${context.origin_session_id}`}>See the Previous Review</Link>}
      </div>}
    </section>
  );
}
