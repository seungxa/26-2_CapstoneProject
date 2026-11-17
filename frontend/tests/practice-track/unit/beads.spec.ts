// Cyber prayer beads in the extension popup (extension/beads.js): counting, laps, the 108th press, midnight reset.
import { expect, test } from "@playwright/test";
import { BEADS, load, press } from "../../../../extension/beads.js";

test("each press lights the next of twelve beads and a full turn adds a lap", () => {
  let state = load(undefined, "2026-11-17");
  expect(state).toEqual({ date: "2026-11-17", today: 0, total: 0, open: true });
  let result;
  for (let i = 0; i < 12; i++) { result = press(state, "2026-11-17"); state = result.state; }
  expect(BEADS).toBe(12);
  expect(result!.bead).toBe(0);
  expect(result!.lap).toBe(1);
  expect(state.today).toBe(12);
  expect(press(state, "2026-11-17").bead).toBe(1);
});

test("every 108th press of the day is a milestone", () => {
  let state = load({ date: "2026-11-17", today: 107, total: 500, open: false }, "2026-11-17");
  const hit = press(state, "2026-11-17");
  expect(hit.milestone).toBe(true);
  expect(hit.state.today).toBe(108);
  state = hit.state;
  expect(press(state, "2026-11-17").milestone).toBe(false);
});

test("after midnight today starts again and the total stays", () => {
  const state = load({ date: "2026-11-17", today: 40, total: 300, open: false }, "2026-11-18");
  expect(state).toEqual({ date: "2026-11-18", today: 0, total: 300, open: false });
  const next = press({ date: "2026-11-17", today: 40, total: 300, open: true }, "2026-11-18");
  expect([next.state.today, next.state.total, next.state.date]).toEqual([1, 301, "2026-11-18"]);
});

test("broken saved values count from zero", () => {
  expect(load({ date: "2026-11-17", today: -3, total: "x", open: "yes" }, "2026-11-17")).toEqual({ date: "2026-11-17", today: 0, total: 0, open: true });
  expect(load("garbage", "2026-11-17").total).toBe(0);
});
