import { label, langOf } from "../labels";
import type { CoachingReport, CoachingRubric, InterviewContext } from "../types";

const VERDICT_CLASS: Record<string, string> = { 보완: "needs-work", 충분: "good" };

/** Criteria and anchors (GET /practice/rubric). Only earlier AI checks were graded against them */
function RubricDetails({ rubric }: { rubric: CoachingRubric }) {
  return (
    <details className="rubric-details">
      <summary>Criteria</summary>
      {rubric.criteria.map((c) => (
        <div key={c.key} className="rubric-row">
          <strong>{label("criterion", c.key)}</strong> <span className="small muted">{c.checks}</span>
          <ul className="bullets small">
            <li><span className="chip good">{label("verdict", "충분")}</span> {c.anchors.충분}</li>
            <li><span className="chip needs-work">{label("verdict", "보완")}</span> {c.anchors.보완}</li>
          </ul>
          {c.star && <>
            <p className="small muted">{c.star.when}:</p>
            <ul className="bullets small">{c.star.anchors.map((a) => <li key={a}>{a}</li>)}</ul>
          </>}
        </div>
      ))}
      <p className="small muted">{rubric.statuses.판단유보}</p>
    </details>
  );
}

/** Checks for one answer: the three criteria, or one line when none could be judged. */
export default function CoachingPanel({ report, context, rubric, showNextAction = true }: { showNextAction?: boolean; report: CoachingReport; context: InterviewContext | null; rubric?: CoachingRubric | null }) {
  const ai = report.method === "ai";
  const criteria = (
    <div className="criteria-list">
      {report.criteria.map((c) => {
        const source = context?.essays?.find((e) => e.version_id === c.source_version_id);
        return <details key={c.key} className="criterion" open={c.status === "보완"}>
          <summary>{label("criterion", c.key)} <span className={`chip ${VERDICT_CLASS[c.status] ?? ""}`}>{label("verdict", c.status)}</span></summary>
          <p lang={langOf(c.reason)}>{c.reason}</p>
          {c.answer_quote && <blockquote><span className="small muted">Your answer</span><p lang="ko">{c.answer_quote}</p></blockquote>}
          {c.source_quote && <blockquote className="source-quote"><span className="small muted">Essay{source ? ` · v${source.version_no}` : ""}</span><p lang="ko">{c.source_quote}</p></blockquote>}
        </details>;
      })}
    </div>
  );
  return (
    <div className="coaching-panel">
      {ai && <span className="chip accent">Earlier AI Check</span>}
      {/* A basic check's summary is the same sentence on every answer, so only an earlier AI summary is shown */}
      {ai && <p lang={langOf(report.summary)}>{report.summary}</p>}
      {report.input_status === "legacy_unverified" && <p className="small muted">Saved by an earlier version. It may not match this transcript, so the summary leaves it out.</p>}
      {showNextAction && <p className="next-action"><b>Next:</b> <span lang={langOf(report.next_action)}>{report.next_action}</span></p>}
      {report.criteria.every((c) => c.status === "판단유보") ? <>
        <p className="not-judged">Not judged: add your role and a result you can check, such as a number.</p>
        <details className="fold"><summary>Details</summary>{criteria}</details>
      </> : criteria}
      {ai && rubric && <RubricDetails rubric={rubric} />}
    </div>
  );
}
