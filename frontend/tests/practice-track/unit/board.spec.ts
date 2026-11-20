import { expect, test } from "@playwright/test";
import { groupByStage, moveTarget } from "../../../src/features/practice-track/components/track/board";
import type { Application } from "../../../src/features/practice-track/types";

const app = (id: string, stage: Application["stage"], status: Application["status"] = "진행중"): Application => ({
  id, company: id, position: "직무", job_category: "개발", url: null, applied_at: null, stage, status, notes: null,
  source: "web", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
  deadline: null, next_step_on: null, next_step: null,
});

test("applications go to their stage's column in the given order", () => {
  const { columns, closed } = groupByStage([app("a", "서류"), app("b", "최종"), app("c", "서류")], false);
  expect(Object.keys(columns)).toEqual(["서류", "인적성", "1차면접", "2차면접", "최종"]);
  expect(columns["서류"].map((a) => a.id)).toEqual(["a", "c"]);
  expect(columns["최종"].map((a) => a.id)).toEqual(["b"]);
  expect(columns["인적성"]).toEqual([]);
  expect(closed).toBe(0);
});

test("decided applications are hidden unless asked for, and counted", () => {
  const apps = [app("open", "서류"), app("held", "서류", "보류"), app("won", "최종", "합격"), app("lost", "인적성", "불합격")];
  const hidden = groupByStage(apps, false);
  expect(Object.values(hidden.columns).flat().map((a) => a.id)).toEqual(["open", "held"]);
  expect(hidden.closed).toBe(2);
  const shown = groupByStage(apps, true);
  expect(Object.values(shown.columns).flat().map((a) => a.id)).toEqual(["open", "held", "lost", "won"]);
  expect(shown.closed).toBe(2);
});

test("moving stops at the first and last stage", () => {
  expect(moveTarget("서류", -1)).toBeNull();
  expect(moveTarget("서류", 1)).toBe("인적성");
  expect(moveTarget("2차면접", 1)).toBe("최종");
  expect(moveTarget("최종", 1)).toBeNull();
});
