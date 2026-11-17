import type { Application } from "../../types";

/** YYYY-MM-DD of the user's own calendar day (not UTC: just after midnight is still "today" locally) */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Whole days from today to date: dates are compared as calendar days, never as times */
export const daysUntil = (date: string, today: string) => Math.round(dayNumber(date) - dayNumber(today));

/** "D-day", "D-3", or "Closed" for a date already gone (only a deadline is shown once it has passed) */
export function ddayText(date: string, today: string): string {
  const days = daysUntil(date, today);
  return days < 0 ? "Closed" : days === 0 ? "D-day" : `D-${days}`;
}

export type Due = { date: string; kind: "deadline" | "next_step" };

/** The date an application is waiting for. Before applying: the earlier upcoming of deadline and next step, or the
 *  passed deadline (Closed). After applying: only an upcoming next step. Decided applications have none. */
export function dueOf(app: Pick<Application, "applied_at" | "deadline" | "next_step_on" | "status">, today: string): Due | null {
  if (app.status === "합격" || app.status === "불합격") return null;
  const before = !app.applied_at;
  const upcoming: Due[] = [];
  if (before && app.deadline && app.deadline >= today) upcoming.push({ date: app.deadline, kind: "deadline" });
  if (app.next_step_on && app.next_step_on >= today) upcoming.push({ date: app.next_step_on, kind: "next_step" });
  if (upcoming.length) return upcoming.sort((a, b) => a.date.localeCompare(b.date))[0];
  if (before && app.deadline) return { date: app.deadline, kind: "deadline" };
  return null;
}
