import { expect, test } from "@playwright/test";
import { ddayText, dueOf, todayLocal } from "../../../src/features/practice-track/components/track/dday";
import type { Application } from "../../../src/features/practice-track/types";

const TODAY = "2026-11-17";
const app = (fields: Partial<Application>): Application => ({
  id: "a", company: "회사", position: "직무", job_category: "개발", url: null, applied_at: null, stage: "서류",
  status: "진행중", notes: null, source: "web", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
  deadline: null, next_step_on: null, next_step: null, ...fields,
});

test("before applying, the earlier of deadline and next step counts", () => {
  expect(dueOf(app({ deadline: "2026-11-20", next_step_on: "2026-11-25" }), TODAY)).toEqual({ date: "2026-11-20", kind: "deadline" });
  expect(dueOf(app({ deadline: "2026-11-30", next_step_on: "2026-11-25" }), TODAY)).toEqual({ date: "2026-11-25", kind: "next_step" });
});

test("after applying, only the next step counts", () => {
  expect(dueOf(app({ applied_at: "2026-11-10", deadline: "2026-11-20" }), TODAY)).toBeNull();
  expect(dueOf(app({ applied_at: "2026-11-10", deadline: "2026-11-20", next_step_on: "2026-11-21" }), TODAY))
    .toEqual({ date: "2026-11-21", kind: "next_step" });
});

test("a past deadline before applying shows Closed; a past next step shows nothing", () => {
  expect(dueOf(app({ deadline: "2026-11-16" }), TODAY)).toEqual({ date: "2026-11-16", kind: "deadline" });
  expect(ddayText("2026-11-16", TODAY)).toBe("Closed");
  expect(dueOf(app({ applied_at: "2026-11-01", next_step_on: "2026-11-16" }), TODAY)).toBeNull();
});

test("a decided application has no D-day", () => {
  for (const status of ["합격", "불합격"] as const) {
    expect(dueOf(app({ status, deadline: "2026-11-20", next_step_on: "2026-11-21" }), TODAY)).toBeNull();
  }
  expect(dueOf(app({ status: "보류", deadline: "2026-11-20" }), TODAY)).toEqual({ date: "2026-11-20", kind: "deadline" });
});

test("D-day text counts whole local days", () => {
  expect(ddayText("2026-11-17", TODAY)).toBe("D-day");
  expect(ddayText("2026-11-18", TODAY)).toBe("D-1");
  expect(ddayText("2026-12-01", TODAY)).toBe("D-14");
  expect(ddayText("2027-03-01", "2027-02-28")).toBe("D-1");
  expect(ddayText("2028-03-01", "2028-02-28")).toBe("D-2"); // leap year
});

test("today is the local calendar date, not the UTC one", () => {
  expect(todayLocal(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  expect(todayLocal(new Date(2026, 11, 31, 23, 55))).toBe("2026-12-31");
});
