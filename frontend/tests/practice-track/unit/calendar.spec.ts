import { expect, test } from "@playwright/test";
import { byDate, monthGrid, monthTitle, shiftMonth } from "../../../src/features/practice-track/components/track/calendar";
import type { CalendarItem } from "../../../src/features/practice-track/types";

test("a month grid is six Sunday-first weeks around the month", () => {
  const feb = monthGrid(2026, 2);
  expect(feb).toHaveLength(42);
  expect(feb[0]).toBe("2026-02-01"); // 1 Feb 2026 is a Sunday
  expect(feb[41]).toBe("2026-03-14");
  const nov = monthGrid(2026, 11);
  expect(nov[0]).toBe("2026-11-01"); // a Sunday too
  const dec = monthGrid(2026, 12);
  expect(dec[0]).toBe("2026-11-29");
  expect(dec).toContain("2026-12-31");
});

test("leap years have 29 February", () => {
  expect(monthGrid(2028, 2)).toContain("2028-02-29");
  expect(monthGrid(2027, 2)).not.toContain("2027-02-29");
});

test("months roll over the year in both directions", () => {
  expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  expect(monthTitle({ year: 2026, month: 11 })).toBe("November 2026");
});

test("items are grouped by date in their given order", () => {
  const item = (date: string, company: string): CalendarItem => ({ date, kind: "deadline", application_id: company, company, position: "p", label: "" });
  const grouped = byDate([item("2026-11-02", "a"), item("2026-11-01", "b"), item("2026-11-02", "c")]);
  expect(grouped.get("2026-11-02")!.map((i) => i.company)).toEqual(["a", "c"]);
  expect(grouped.get("2026-11-01")!.map((i) => i.company)).toEqual(["b"]);
  expect(grouped.get("2026-11-03")).toBeUndefined();
});
