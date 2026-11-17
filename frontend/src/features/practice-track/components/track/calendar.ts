import type { CalendarItem } from "../../types";

export type YearMonth = { year: number; month: number }; // month 1..12

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 42 dates (six Sunday-first weeks) covering the month, as YYYY-MM-DD. Computed in UTC so no time zone shifts a day */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = Date.UTC(year, month - 1, 1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => iso(new Date(start + i * 86_400_000)));
}

export function shiftMonth({ year, month }: YearMonth, by: number): YearMonth {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const monthTitle = ({ year, month }: YearMonth) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Calendar items by date, keeping their order within a day */
export function byDate(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const days = new Map<string, CalendarItem[]>();
  for (const item of items) days.set(item.date, [...(days.get(item.date) ?? []), item]);
  return days;
}
