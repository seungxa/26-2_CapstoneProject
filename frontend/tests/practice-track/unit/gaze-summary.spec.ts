import { expect, test } from "@playwright/test";
import type { DirectionLabel } from "../../../src/features/practice-track/video/gaze/direction";
import { summarizeDirections } from "../../../src/features/practice-track/video/gaze/directionSummary";

const at = (t: number, label: DirectionLabel["label"], reason?: string) =>
  ({ t, label: (label === "unknown" ? { label, reason } : { label }) as DirectionLabel });

test("each label counts the time until the next frame", () => {
  const seq = Array.from({ length: 9 }, (_, i) => at(i * 250, "center"));
  const s = summarizeDirections(seq);
  expect(s.byDirection.center).toBe(2000);
  expect(s.analyzedMs).toBe(2000);
});

test("a long gap counts only 500 ms", () => {
  const s = summarizeDirections([at(0, "center"), at(3000, "down"), at(3250, "down")]);
  expect(s.byDirection.center).toBe(500);
  expect(s.byDirection.down).toBe(250);
  expect(s.analyzedMs).toBe(750);
});

test("switches, the longest down stretch and unknown reasons", () => {
  const seq = [at(0, "center"), at(250, "down"), at(500, "down"), at(750, "unknown", "blink"), at(1000, "down"),
    at(1250, "center"), at(1500, "down"), at(1750, "unknown", "no_face"), at(2000, "unknown", "no_face"), at(2250, "center")];
  const s = summarizeDirections(seq);
  expect(s.switches).toBe(4); // center→down, down→center, center→down, down→center (unknown does not count)
  expect(s.longestDownMs).toBe(500);
  expect(s.unknownMs).toBe(750);
  expect(s.unknownByReason).toEqual({ blink: 250, no_face: 500 });
  expect(s.byDirection).toEqual({ center: 500, up: 0, down: 1000, left: 0, right: 0 });
});

test("nothing to summarize", () => {
  expect(summarizeDirections([])).toEqual({ analyzedMs: 0, byDirection: { center: 0, up: 0, down: 0, left: 0, right: 0 },
    unknownMs: 0, unknownByReason: {}, switches: 0, longestDownMs: 0 });
});
