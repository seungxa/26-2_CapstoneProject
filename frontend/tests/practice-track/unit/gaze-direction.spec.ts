import { expect, test } from "@playwright/test";
import {
  CALIBRATION_TARGETS, DIRECTIONS, calibrateDirections, classifyDirection, smoothLabels,
  type Direction, type DirectionLabel,
} from "../../../src/features/practice-track/video/gaze/direction";
import { gazeFeatures, type GazeFeatures } from "../../../src/features/practice-track/video/gaze/features";
import { POSE_GEOMETRY, VIEW, screenToGaze, syntheticFace } from "../../../src/features/practice-track/video/gaze/synthetic";
import {
  directionAggregate, directionTrials, evaluateDirectionRun, runsVerdict, trialLabels, type Trial, type TrialData,
} from "../../../src/features/practice-track/video/gaze/directionLab";

// 시선 방향(C1) 계산 테스트. 합성 얼굴의 숨긴 기하로 화면 점을 보는 특징을 만든다(실제 웹캠 정확도는 실험실에서 사람이 잰다).

type LookOpts = { yaw?: number; pitch?: number; eyeOpen?: number; scale?: number; seed?: number };

/** 뷰포트 비율 (x, y)의 점을 보는 합성 얼굴의 특징 */
function look([x, y]: [number, number], o: LookOpts = {}): GazeFeatures {
  const face = syntheticFace({ ...screenToGaze(x * VIEW.w, y * VIEW.h, VIEW), yaw: o.yaw ?? 0, pitch: o.pitch ?? 0,
    eyeOpen: o.eyeOpen, scale: o.scale, noise: 0.0001, seed: o.seed ?? 1 });
  return gazeFeatures(face, 640, 480) as GazeFeatures;
}

/** 기준 잡기 다섯 점을 12번씩 본 특징. head면 가장자리 점에서 그쪽으로 고개도 함께 돌린다 */
function calib(o: { head?: boolean } = {}): Record<Direction, GazeFeatures[]> {
  const out = {} as Record<Direction, GazeFeatures[]>;
  for (const t of CALIBRATION_TARGETS) {
    const pose = o.head && t.direction !== "center" ? POSE_GEOMETRY[t.direction] : { yaw: 0, pitch: 0 };
    out[t.direction] = Array.from({ length: 12 }, (_, i) => look([t.x, t.y], { yaw: pose.yaw, pitch: pose.pitch, seed: i + 1 }));
  }
  return out;
}

test("eyes-only calibration is ok and labels the five targets", () => {
  const cal = calibrateDirections(calib());
  expect(cal.quality).toEqual({ ok: true });
  for (const t of CALIBRATION_TARGETS) expect(classifyDirection(look([t.x, t.y], { seed: 99 }), cal)).toEqual({ label: t.direction });
  expect(classifyDirection(look([0.5, 0.38]), cal)).toEqual({ label: "center" }); // 위쪽 가장자리까지 절반이 안 됨
  expect(classifyDirection(look([0.2, 0.5]), cal)).toEqual({ label: "left" }); // 절반을 넘음
});

test("head-only turn toward the left is left and head-only tilt down is down", () => {
  const cal = calibrateDirections(calib());
  // 고개만 왼쪽으로 돌리고 눈은 화면 가운데를 본다(눈이 반대로 돌아 시선은 그대로)
  expect(classifyDirection(look([0.5, 0.5], { yaw: -0.25 }), cal).label).toBe("center");
  const headLeft = gazeFeatures(syntheticFace({ gazeX: -0.25, gazeY: 0, yaw: -0.25, pitch: 0, noise: 0.0001, seed: 5 }), 640, 480) as GazeFeatures;
  expect(classifyDirection(headLeft, cal)).toEqual({ label: "left" });
  const headDown = gazeFeatures(syntheticFace({ gazeX: 0, gazeY: 0.2, yaw: 0, pitch: 0.2, noise: 0.0001, seed: 6 }), 640, 480) as GazeFeatures;
  expect(classifyDirection(headDown, cal)).toEqual({ label: "down" });
});

test("calibration made with head movement still labels eyes-only looks", () => {
  const cal = calibrateDirections(calib({ head: true }));
  expect(cal.quality.ok).toBe(true);
  for (const t of CALIBRATION_TARGETS) expect(classifyDirection(look([t.x, t.y], { seed: 77 }), cal).label).toBe(t.direction);
});

test("notes below the screen with lowered eyelids are down, not blink", () => {
  const cal = calibrateDirections(calib());
  const notes = gazeFeatures(syntheticFace({ gazeX: 0, gazeY: 0.6, yaw: 0, pitch: 0.25, eyeOpen: 0.6, noise: 0.0001, seed: 8 }), 640, 480) as GazeFeatures;
  expect(notes.open / cal.base.open).toBeLessThan(0.5);
  expect(classifyDirection(notes, cal)).toEqual({ label: "down" });
});

test("a closed-eye sample at center is unknown(blink) and a one-sample blink is smoothed away", () => {
  const cal = calibrateDirections(calib());
  expect(classifyDirection(look([0.5, 0.5], { eyeOpen: 0 }), cal)).toEqual({ label: "unknown", reason: "blink" });
  const seq = [0, 1, 2, 3, 4].map((i) => ({ t: i * 250,
    label: (i === 2 ? { label: "unknown", reason: "blink" } : { label: "center" }) as DirectionLabel }));
  expect(smoothLabels(seq).map((l) => l.label)).toEqual(["center", "center", "center", "center", "center"]);
});

test("pose change and missing face are unknown with their reasons", () => {
  const cal = calibrateDirections(calib());
  expect(classifyDirection(look([0.5, 0.5], { scale: 0.26 }), cal)).toEqual({ label: "unknown", reason: "pose_changed" });
  expect(classifyDirection(gazeFeatures(null, 640, 480), cal)).toEqual({ label: "unknown", reason: "no_face" });
});

test("a user who stared at the center during calibration fails with not_separated", () => {
  const still = Object.fromEntries(DIRECTIONS.map((d) => [d, Array.from({ length: 12 }, (_, i) => look([0.5, 0.5], { seed: i + 1 }))]));
  expect(calibrateDirections(still as Record<Direction, GazeFeatures[]>).quality).toMatchObject({ ok: false, reason: "not_separated" });
});

test("a target with fewer than 8 valid samples fails with insufficient_samples", () => {
  const s = calib();
  s.up = s.up.slice(0, 7);
  expect(calibrateDirections(s).quality).toEqual({ ok: false, reason: "insufficient_samples", direction: "up" });
});

test("smoothing keeps a sustained change", () => {
  const seq = Array.from({ length: 8 }, (_, i) => ({ t: i * 250, label: { label: i < 4 ? "center" : "down" } as DirectionLabel }));
  expect(smoothLabels(seq).slice(-3).map((l) => l.label)).toEqual(["down", "down", "down"]);
});

test.describe("direction lab", () => {
  /** 시행마다 라벨 6개. 라벨 하나마다 pick(trial)을 새로 부른다(기본은 기대한 방향만 내는 완벽한 사용자) */
  const labelsFor = (trials: Trial[], pick: (t: Trial) => DirectionLabel = (t) => ({ label: t.expected })): TrialData[] =>
    trials.map((trial) => ({ trial, labels: Array.from({ length: 6 }, () => pick(trial)) }));

  test("trials: 15 eyes + 15 natural + one script trial last; seed changes order only", () => {
    const a = directionTrials(1), b = directionTrials(2);
    expect(a).toHaveLength(31);
    for (const c of ["eyes", "natural"] as const) for (const d of DIRECTIONS)
      expect(a.filter((t) => t.condition === c && t.expected === d)).toHaveLength(3);
    expect(a[30]).toMatchObject({ condition: "script", expected: "down", pose: "down", collectMs: 5000 });
    expect(a.filter((t) => t.condition === "eyes").every((t) => t.pose === "forward")).toBe(true);
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id));
    expect([...a].sort((x, y) => x.id.localeCompare(y.id))).toEqual([...b].sort((x, y) => x.id.localeCompare(y.id)));
  });

  test("a perfect user passes", () => {
    const r = evaluateDirectionRun(labelsFor(directionTrials(1)));
    expect(r.verdict).toBe("pass");
    expect(r.failed).toEqual([]);
    expect(r.accuracy.down).toBe(1);
  });

  test("looking at the center during down trials fails on down", () => {
    const r = evaluateDirectionRun(labelsFor(directionTrials(1), (t) => ({ label: t.expected === "down" ? "center" : t.expected })));
    expect(r.accuracy.down).toBe(0);
    expect(r.verdict).toBe("fail");
    expect(r.failed).toContain("down");
  });

  test("unknown labels count against accuracy and fail the run above 15%", () => {
    let n = 0;
    const r = evaluateDirectionRun(labelsFor(directionTrials(1),
      (t) => (n++ % 5 === 0 ? { label: "unknown", reason: "eyes_unreliable" } : { label: t.expected })));
    expect(r.unknownRate).toBeCloseTo(0.2, 1);
    expect(r.accuracy.center!).toBeLessThan(0.85);
    expect(r.failed).toContain("unknown");
    expect(r.unknownReasons.eyes_unreliable).toBeGreaterThan(0);
  });

  test("center looks labeled down are reported as centerAsDown", () => {
    const r = evaluateDirectionRun(labelsFor(directionTrials(1), (t) => ({ label: t.expected === "center" ? "down" : t.expected })));
    expect(r.centerAsDown).toBe(1);
    expect(r.failed).toEqual(expect.arrayContaining(["center", "centerAsDown"]));
  });

  test("aggregate has only numbers and strings and no feature names", () => {
    const out = directionAggregate(evaluateDirectionRun(labelsFor(directionTrials(1))));
    for (const [k, v] of Object.entries(out)) {
      expect(["number", "string"].includes(typeof v) || v === null).toBe(true);
      expect(k).not.toMatch(/\b(ex|ey|hx|hy|points|landmark)\b/);
    }
    expect(out["verdict"]).toBe("pass");
    expect(out["acc.down"]).toBe(1);
  });

  test("tracking failures survive smoothing: scattered eyes_unreliable samples fail the run on unknown", () => {
    // 시행마다 가운데 표본 하나가 눈 추적 실패. 평활(다수결)만 하면 이웃 방향으로 덮여 정답처럼 세진다
    const data = directionTrials(1).map((trial) => ({ trial, labels: trialLabels(Array.from({ length: 5 }, (_, i) => ({ t: i * 250,
      label: (i === 2 ? { label: "unknown", reason: "eyes_unreliable" } : { label: trial.expected }) as DirectionLabel }))) }));
    const r = evaluateDirectionRun(data);
    expect(r.unknownRate).toBeCloseTo(0.2, 2);
    expect(r.failed).toContain("unknown");
  });

  test("trialLabels still smooths away a one-sample blink", () => {
    const seq = [0, 1, 2, 3, 4].map((i) => ({ t: i * 250,
      label: (i === 2 ? { label: "unknown", reason: "blink" } : { label: "down" }) as DirectionLabel }));
    expect(trialLabels(seq).map((l) => l.label)).toEqual(["down", "down", "down", "down", "down"]);
  });

  test("script trial unknown reasons are reported separately", () => {
    const r = evaluateDirectionRun(labelsFor(directionTrials(1),
      (t) => (t.condition === "script" ? { label: "unknown", reason: "pose_changed" } : { label: t.expected })));
    expect(r.script.reasons.pose_changed).toBe(6);
    expect(directionAggregate(r)["script.unknown.pose_changed"]).toBe(6);
    expect(r.unknownReasons.pose_changed).toBeUndefined(); // 대본 시행은 통과 판정 지표와 섞지 않는다
  });

  test("runsVerdict needs two passes out of three", () => {
    expect(runsVerdict(["pass"])).toBe("pending");
    expect(runsVerdict(["pass", "fail", "pass"])).toBe("pass");
    expect(runsVerdict(["fail", "pass", "fail"])).toBe("fail");
    expect(runsVerdict(["pass", "pass"])).toBe("pass");
  });
});
