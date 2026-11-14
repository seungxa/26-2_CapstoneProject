/** 시선 방향 실험(C5, 개발 전용 /dev/gaze-direction)의 순서·채점·집계. 화면과 카메라는 다루지 않는 순수 계산이다.
 *  두 조건(눈만 / 고개와 함께)에서 방향마다 3번씩, 마지막에 대본 읽기 구간을 둔다. 판정 못 함도 분모에 넣는다(정답으로 세지 않음).
 *  통과는 회고 화면에 시선 방향을 넣을지 정하는 실험 기준일 뿐 정확도 보장이 아니다. */
import { DIRECTION, DIRECTION_PASS } from "./constants";
import { DIRECTIONS, type Direction, type DirectionLabel, type UnknownReason } from "./direction";
import type { Pose } from "./calibration";

export type TrialCondition = "eyes" | "natural" | "script";
export type Trial = { id: string; expected: Direction; condition: TrialCondition; x: number; y: number; pose: Pose;
  settleMs: number; collectMs: number; prompt: string };
export type TrialData = { trial: Trial; labels: DirectionLabel[] };

/** 반복 r(0·1·2)마다 방향별 시행 위치(뷰포트 비율) */
const POSITIONS: Record<Direction, [number, number][]> = {
  center: [[0.45, 0.45], [0.55, 0.5], [0.5, 0.55]],
  up: [[0.35, 0.05], [0.5, 0.04], [0.65, 0.05]],
  down: [[0.35, 0.95], [0.5, 0.96], [0.65, 0.95]],
  left: [[0.05, 0.35], [0.04, 0.5], [0.05, 0.65]],
  right: [[0.95, 0.35], [0.96, 0.5], [0.95, 0.65]],
};
const PROMPT: Record<TrialCondition, string> = {
  eyes: "고개는 그대로, 눈으로만 점을 보세요",
  natural: "고개와 눈을 편하게 움직여 점을 보세요",
  script: "종이 대본이 키보드 앞에 있다고 생각하고, 화면 아래 너머(책상)를 5초 동안 읽듯이 보세요",
};
const NATURAL_POSE: Record<Direction, Pose> = { center: "forward", up: "up", down: "down", left: "left", right: "right" };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: T[], next: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** eyes 블록 15개 → natural 블록 15개 → 대본 1개. 블록 안 순서만 seed로 섞는다 */
export function directionTrials(seed: number): Trial[] {
  const next = mulberry32(seed);
  const block = (condition: "eyes" | "natural") => shuffled(DIRECTIONS.flatMap((d) => POSITIONS[d].map(([x, y], r): Trial => ({
    id: `${condition}-${d}-${r}`, expected: d, condition, x, y, pose: condition === "eyes" ? "forward" : NATURAL_POSE[d],
    settleMs: DIRECTION.settleMs, collectMs: DIRECTION.collectMs, prompt: PROMPT[condition] }))), next);
  return [...block("eyes"), ...block("natural"),
    { id: "script", expected: "down", condition: "script", x: 0.5, y: 1.3, pose: "down", settleMs: 1000, collectMs: 5000, prompt: PROMPT.script }];
}

export type DirectionRunReport = {
  accuracy: Record<Direction, number | null>;
  byCondition: Record<"eyes" | "natural", Record<Direction, number | null>>;
  /** 기대한 방향 → 라벨별 개수 */
  confusion: Record<Direction, Record<Direction | "unknown", number>>;
  centerAsDown: number | null;
  unknownRate: number | null;
  unknownReasons: Partial<Record<UnknownReason, number>>;
  script: { down: number | null; unknown: number | null };
  samples: number;
  verdict: "pass" | "fail";
  failed: string[];
};

const share = (labels: DirectionLabel[], ok: (l: DirectionLabel) => boolean) =>
  labels.length ? labels.filter(ok).length / labels.length : null;

export function evaluateDirectionRun(data: TrialData[]): DirectionRunReport {
  const scored = data.filter((d) => d.trial.condition !== "script");
  const labelsOf = (pred: (t: Trial) => boolean) => scored.filter((d) => pred(d.trial)).flatMap((d) => d.labels);
  const acc = (pred: (t: Trial) => boolean) => Object.fromEntries(DIRECTIONS.map((dir) => [dir,
    share(labelsOf((t) => pred(t) && t.expected === dir), (l) => l.label === dir)])) as Record<Direction, number | null>;
  const accuracy = acc(() => true);
  const byCondition = { eyes: acc((t) => t.condition === "eyes"), natural: acc((t) => t.condition === "natural") };
  const confusion = Object.fromEntries(DIRECTIONS.map((exp) => {
    const row = Object.fromEntries([...DIRECTIONS, "unknown"].map((k) => [k, 0])) as Record<Direction | "unknown", number>;
    for (const l of labelsOf((t) => t.expected === exp)) row[l.label]++;
    return [exp, row];
  })) as DirectionRunReport["confusion"];
  const all = labelsOf(() => true);
  const unknownReasons: DirectionRunReport["unknownReasons"] = {};
  for (const l of all) if (l.label === "unknown") unknownReasons[l.reason] = (unknownReasons[l.reason] ?? 0) + 1;
  const centerAsDown = share(labelsOf((t) => t.expected === "center"), (l) => l.label === "down");
  const unknownRate = share(all, (l) => l.label === "unknown");
  const scriptLabels = data.filter((d) => d.trial.condition === "script").flatMap((d) => d.labels);
  const script = { down: share(scriptLabels, (l) => l.label === "down"), unknown: share(scriptLabels, (l) => l.label === "unknown") };

  const P = DIRECTION_PASS;
  const failed: string[] = [];
  const atLeast = (code: string, v: number | null, min: number) => { if (v === null || v < min) failed.push(code); };
  const atMost = (code: string, v: number | null, max: number) => { if (v === null || v > max) failed.push(code); };
  atLeast("center", accuracy.center, P.center);
  atLeast("down", accuracy.down, P.down);
  for (const d of ["up", "left", "right"] as const) atLeast(d, accuracy[d], P.side);
  atMost("centerAsDown", centerAsDown, P.centerAsDownMax);
  atMost("unknown", unknownRate, P.unknownMax);
  return { accuracy, byCondition, confusion, centerAsDown, unknownRate, unknownReasons, script, samples: all.length,
    verdict: failed.length ? "fail" : "pass", failed };
}

/** 복사해 기록할 집계: 숫자와 판정 문자열만(특징·좌표·라벨 순서 없음) */
export function directionAggregate(r: DirectionRunReport): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  const num = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
  for (const d of DIRECTIONS) out[`acc.${d}`] = num(r.accuracy[d]);
  for (const c of ["eyes", "natural"] as const) for (const d of DIRECTIONS) out[`acc.${c}.${d}`] = num(r.byCondition[c][d]);
  for (const exp of DIRECTIONS) for (const [label, n] of Object.entries(r.confusion[exp])) out[`confusion.${exp}.${label}`] = n;
  out.centerAsDown = num(r.centerAsDown);
  out.unknownRate = num(r.unknownRate);
  for (const [reason, n] of Object.entries(r.unknownReasons)) out[`unknown.${reason}`] = n ?? 0;
  out["script.down"] = num(r.script.down);
  out["script.unknown"] = num(r.script.unknown);
  out.samples = r.samples;
  out.verdict = r.verdict;
  out.failed = r.failed.join(",");
  return out;
}

/** 새 보정 3회 중 2회 통과면 pass, 2회 실패면 fail, 아직 모르면 pending(앞 3회만 본다) */
export function runsVerdict(verdicts: ("pass" | "fail")[]): "pass" | "fail" | "pending" {
  const first = verdicts.slice(0, DIRECTION_PASS.runsTotal);
  if (first.filter((v) => v === "pass").length >= DIRECTION_PASS.runsNeeded) return "pass";
  if (first.filter((v) => v === "fail").length >= DIRECTION_PASS.runsTotal - DIRECTION_PASS.runsNeeded + 1) return "fail";
  return "pending";
}
