import { STAGES, type Application } from "../../types";

/** Stage progress bar under the detail header. Decorative: the header already names the stage and status */
export function StageTrack({ a }: { a: Pick<Application, "stage" | "status"> }) {
  const cur = STAGES.indexOf(a.stage);
  return (
    <div className="stage-track" aria-hidden="true">
      {STAGES.map((s, i) => (
        <span key={s} className={i < cur || (i === cur && a.status === "합격") ? "on" : i === cur && a.status === "불합격" ? "fail" : i === cur ? "on" : ""}
          style={i === cur && a.status === "진행중" ? { opacity: 0.45 } : undefined} />
      ))}
    </div>
  );
}
