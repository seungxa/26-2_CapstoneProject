import type { Application } from "../../types";
import { ddayText, dueOf, todayLocal } from "./dday";

const KIND = { deadline: "Deadline", next_step: "Next step" } as const;

/** D-day of the date an application is waiting for; nothing when there is none */
export function DueChip({ app, today = todayLocal() }: { app: Pick<Application, "applied_at" | "deadline" | "next_step_on" | "status">; today?: string }) {
  const due = dueOf(app, today);
  if (!due) return null;
  const text = ddayText(due.date, today);
  const tone = text === "Closed" ? "muted" : text === "D-day" || text === "D-1" ? "warn" : "";
  return <span className={`chip due ${tone}`.trim()} title={`${KIND[due.kind]} ${due.date}`}>{text}<span className="sr-only"> {KIND[due.kind]}</span></span>;
}
