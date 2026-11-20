/** 시선 방향(C1): 면접 전 10초 기준 잡기로 그 사람의 '정면'과 방향별 시선 변화를 재고, 이후 표본을
 *  정면·위·아래·왼쪽·오른쪽 중 하나로 판정한다. 정밀한 화면 좌표·렌즈 응시는 다루지 않는다(G1·G2와 다른 문제).
 *  홍채(ex·ey)와 고개(hx·hy)를 한 값으로 합쳐(gazeProxy) 고개만 돌리거나 눈만 돌려도 방향으로 잡는다.
 *  특징은 계산 후 버린다(저장·전송하지 않음). 기준값은 constants.ts의 DIRECTION 한곳에 둔다. */
import { DIRECTION, MIN_VALID, OPEN_MIN_RATIO, POS_TOL, SCALE_TOL } from "./constants";
import { gazeFeatures, isFeatures, type FeatureInvalid, type GazeFeatures } from "./features";
import type { Frame } from "./sampler";
import { median } from "../stats";

export type Direction = "center" | "up" | "down" | "left" | "right";
export const DIRECTIONS: readonly Direction[] = ["center", "up", "down", "left", "right"];
export type Edge = Exclude<Direction, "center">;
const EDGES: readonly Edge[] = ["up", "down", "left", "right"];
export type UnknownReason = FeatureInvalid["invalid"] | "blink" | "pose_changed";
export type DirectionLabel = { label: Direction } | { label: "unknown"; reason: UnknownReason };

/** 기준 잡기 점(뷰포트 비율). 이 순서로 보여 준다 */
export type CalibrationTarget = { direction: Direction; x: number; y: number };
export const CALIBRATION_TARGETS: readonly CalibrationTarget[] = [
  { direction: "center", x: 0.5, y: 0.5 },
  { direction: "up", x: 0.5, y: 0.06 },
  { direction: "down", x: 0.5, y: 0.94 },
  { direction: "left", x: 0.06, y: 0.5 },
  { direction: "right", x: 0.94, y: 0.5 },
];

export type Vec2 = { gx: number; gy: number };
export type CalibrationFailure = "insufficient_samples" | "not_separated" | "axes_inconsistent";
export type DirectionCalibration = {
  center: Vec2;
  /** 각 가장자리 점의 (중앙값 − 가운데) 결합 시선 */
  axes: Record<Edge, Vec2>;
  /** 가운데 점의 중앙값(눈 뜬 정도와 자세 기준) */
  base: { open: number; scale: number; faceX: number; faceY: number };
  /** 점 안 흩어짐: 점마다 gx·gy 분산의 평균을 제곱근한 값을 다섯 점에 대해 평균 */
  noise: number;
  quality: { ok: true } | { ok: false; reason: CalibrationFailure; direction?: Direction };
};

/** 홍채와 고개를 합친 시선 값(홍채 단위) */
export function gazeProxy(f: GazeFeatures): Vec2 {
  return { gx: f.ex + DIRECTION.alphaX * f.hx, gy: f.ey + DIRECTION.alphaY * f.hy };
}

export function featuresFromFrames(frames: Frame[]): (GazeFeatures | FeatureInvalid)[] {
  return frames.map((fr) => gazeFeatures(fr.points, fr.width, fr.height));
}

const dot = (a: Vec2, b: Vec2) => a.gx * b.gx + a.gy * b.gy;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ gx: a.gx - b.gx, gy: a.gy - b.gy });
const variance = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
};

export function calibrateDirections(samples: Record<Direction, GazeFeatures[]>): DirectionCalibration {
  const proxies = Object.fromEntries(DIRECTIONS.map((d) => [d, (samples[d] ?? []).map(gazeProxy)])) as Record<Direction, Vec2[]>;
  const mid = (d: Direction): Vec2 => proxies[d].length
    ? { gx: median(proxies[d].map((p) => p.gx)), gy: median(proxies[d].map((p) => p.gy)) } : { gx: NaN, gy: NaN };
  const center = mid("center");
  const axes = Object.fromEntries(EDGES.map((d) => [d, sub(mid(d), center)])) as Record<Edge, Vec2>;
  const c = samples.center ?? [];
  const base = { open: median(c.map((f) => f.open)), scale: median(c.map((f) => f.scale)),
    faceX: median(c.map((f) => f.faceX)), faceY: median(c.map((f) => f.faceY)) };
  const spreads = DIRECTIONS.filter((d) => proxies[d].length)
    .map((d) => Math.sqrt((variance(proxies[d].map((p) => p.gx)) + variance(proxies[d].map((p) => p.gy))) / 2));
  const noise = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : NaN;
  const result = (quality: DirectionCalibration["quality"]): DirectionCalibration => ({ center, axes, base, noise, quality });

  const short = DIRECTIONS.find((d) => proxies[d].length < MIN_VALID);
  if (short) return result({ ok: false, reason: "insufficient_samples", direction: short });
  const minLength = DIRECTION.minSeparation * Math.max(noise, 1e-4);
  const close = EDGES.find((d) => !(Math.hypot(axes[d].gx, axes[d].gy) >= minLength));
  if (close) return result({ ok: false, reason: "not_separated", direction: close });
  if (dot(axes.left, axes.right) >= 0 || dot(axes.up, axes.down) >= 0) return result({ ok: false, reason: "axes_inconsistent" });
  return result({ ok: true });
}

export function classifyDirection(f: GazeFeatures | FeatureInvalid, cal: DirectionCalibration): DirectionLabel {
  if (!isFeatures(f)) return { label: "unknown", reason: f.invalid };
  const { base } = cal;
  if (Math.abs(f.scale / base.scale - 1) > SCALE_TOL || Math.abs(f.faceX - base.faceX) > POS_TOL
    || Math.abs(f.faceY - base.faceY) > POS_TOL) return { label: "unknown", reason: "pose_changed" };
  const o = sub(gazeProxy(f), cal.center);
  // 가장자리 점까지의 진행 비율(1이면 그 점을 본 것과 같음)
  const progress = (d: Edge) => dot(o, cal.axes[d]) / dot(cal.axes[d], cal.axes[d]);
  const best = EDGES.reduce((a, d) => (progress(d) > progress(a) ? d : a));
  // 눈꺼풀이 많이 내려가면 홍채가 불안정하다: 아래를 보는 것으로 충분히 설명될 때만 '아래', 아니면 눈 감김
  if (f.open / base.open < OPEN_MIN_RATIO) {
    return best === "down" && progress("down") >= DIRECTION.enter ? { label: "down" } : { label: "unknown", reason: "blink" };
  }
  return { label: progress(best) >= DIRECTION.enter ? best : "center" };
}

const keyOf = (l: DirectionLabel) => l.label;

/** 최근 windowMs 안(현재 표본 포함)의 다수결. 동점이면 현재 표본의 라벨을 쓴다 */
export function smoothLabels(seq: { t: number; label: DirectionLabel }[], windowMs: number = DIRECTION.smoothMs): DirectionLabel[] {
  return seq.map((cur) => {
    const win = seq.filter((s) => s.t <= cur.t && s.t > cur.t - windowMs);
    const counts = new Map<string, number>();
    for (const s of win) counts.set(keyOf(s.label), (counts.get(keyOf(s.label)) ?? 0) + 1);
    const own = keyOf(cur.label), top = Math.max(...counts.values());
    const winner = counts.get(own) === top ? own : [...counts.entries()].find(([, n]) => n === top)![0];
    if (winner !== "unknown") return { label: winner as Direction };
    if (cur.label.label === "unknown") return cur.label;
    const reasons = new Map<UnknownReason, number>();
    for (const s of win) if (s.label.label === "unknown") reasons.set(s.label.reason, (reasons.get(s.label.reason) ?? 0) + 1);
    const reason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { label: "unknown", reason };
  });
}
