import { DIRECTIONS, type Direction, type DirectionLabel, type UnknownReason } from "./direction";

/** One answer's gaze directions in time. Kept in this tab only, like the rest of the camera summary */
export type GazeSummary = {
  analyzedMs: number;
  byDirection: Record<Direction, number>;
  unknownMs: number;
  unknownByReason: Partial<Record<UnknownReason, number>>;
  /** Changes from one direction to another (unknown stretches do not count as a change) */
  switches: number;
  longestDownMs: number;
};

/** A frame gap longer than this was a pause (hidden tab, camera hiccup): only this much is counted */
export const MAX_GAP_MS = 500;

/** Time per smoothed label: each label lasts until the next frame, at most MAX_GAP_MS */
export function summarizeDirections(seq: { t: number; label: DirectionLabel }[]): GazeSummary {
  const byDirection = Object.fromEntries(DIRECTIONS.map((d) => [d, 0])) as Record<Direction, number>;
  const unknownByReason: Partial<Record<UnknownReason, number>> = {};
  let analyzedMs = 0, unknownMs = 0, switches = 0, longestDownMs = 0, downRun = 0;
  let last: Direction | null = null;
  for (let i = 0; i < seq.length; i++) {
    const { label } = seq[i].label.label === "unknown" ? { label: "unknown" as const } : { label: seq[i].label.label as Direction };
    const ms = i + 1 < seq.length ? Math.min(Math.max(0, seq[i + 1].t - seq[i].t), MAX_GAP_MS) : 0;
    analyzedMs += ms;
    if (label === "unknown") {
      const reason = (seq[i].label as { reason: UnknownReason }).reason;
      unknownMs += ms;
      unknownByReason[reason] = (unknownByReason[reason] ?? 0) + ms;
      downRun = 0;
      continue;
    }
    byDirection[label] += ms;
    if (last !== null && last !== label) switches++;
    last = label;
    downRun = label === "down" ? downRun + ms : 0;
    longestDownMs = Math.max(longestDownMs, downRun);
  }
  return { analyzedMs, byDirection, unknownMs, unknownByReason, switches, longestDownMs };
}
