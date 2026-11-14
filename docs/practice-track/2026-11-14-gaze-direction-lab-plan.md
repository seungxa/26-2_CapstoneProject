# 시선 방향 판정·실험실 (C1·C5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개발 전용 실험실(`/practice/dev/gaze-direction`)을 만든다. 10초 기준 잡기 뒤 시선 방향(정면·위·아래·왼쪽·오른쪽)을 판정하고, 방향별 정답률과 통과 여부를 보인다. 사용자가 이 화면으로 실제 웹캠 실측을 3회 할 수 있어야 한다.

**Architecture:**
- 순수 계산 모듈 두 개를 만든다.
  - `video/gaze/direction.ts`: 보정, 판정, 평활.
  - `video/gaze/directionLab.ts`: 실험 순서, 채점, 집계.
- 기준 잡기 hook과 점 오버레이는 컴포넌트로 따로 둔다. 다음 계획(C2, 면접 화면)에서 그대로 다시 쓴다.
- 기존 카메라 hook(`useFaceAnalysis().subscribeFrames`)과 특징 추출(`features.ts`의 `gazeFeatures`)을 재사용한다.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Playwright test runner(unit과 e2e), 기존 MediaPipe 검출기와 e2e 가짜 검출기.

**Spec:** `docs/practice-track/2026-11-14-local-ai-gaze-direction-design.md`의 4.3절 C1·C5·C6.

## Global Constraints

- **코드 위치:** 기능 코드는 `frontend/src/features/practice-track/` 아래에만 둔다. 팀 소유 파일(`App.tsx`, `Profile.tsx`, `lib/*`, 공용 CSS)은 수정하지 않는다.
- **의존성:** 새 npm·pip 의존성을 추가하지 않는다.
- **데이터 보관:**
  - 프레임, 특징점, 좌표, 표본은 탭 메모리에서만 쓴다. 서버나 외부로 보내지 않는다.
  - 내보내기는 숫자와 판정 문자열로 된 집계만 허용한다.
- **실험실 노출:** Vite 개발 서버이면서 `VITE_GAZE_LAB=true`일 때만 경로와 화면을 불러온다(`GAZE_LAB` 플래그). 프로덕션 번들에는 들어가지 않는다.
- **이 계획에서 바꾸지 않는 것:**
  - 면접 진행 화면(`SessionRunner`)과 회고 화면(`VideoReportCard`). C2~C4는 다음 계획이다.
  - 기존 G1·G2 실험실(`/dev/gaze-lab`, `GazeLab.tsx`)과 그 테스트.
- **기준 잡기:**
  - 순서: 가운데 → 위 → 아래 → 왼쪽 → 오른쪽.
  - 점 하나에 안정 700ms + 수집 1300ms.
  - 점 위치(뷰포트 비율): 가운데 (0.5, 0.5), 위 (0.5, 0.06), 아래 (0.5, 0.94), 왼쪽 (0.06, 0.5), 오른쪽 (0.94, 0.5).
  - 점 하나당 유효 표본이 8개 이상이어야 한다(`MIN_VALID`).
- **판정 못 함 사유:**
  - `FeatureInvalid` 사유 그대로.
  - `blink`: `open` < 0.5 × 기준값(`OPEN_MIN_RATIO`).
  - `pose_changed`: `SCALE_TOL` 0.15 또는 `POS_TOL` 0.1을 넘음.
- **평활 창:** 750ms.
- **표본 주기:**
  - 실제 웹캠: 기준 잡기 초당 10회, 방향 시험 초당 4회.
  - e2e: 둘 다 초당 60회이고 시간 배율은 `localStorage["e2e-gaze-scale"]`.
- **통과 기준 (한 번의 실행):**
  - 정면 ≥ 0.85
  - 아래 ≥ 0.80
  - 위·왼쪽·오른쪽 각각 ≥ 0.70
  - 정면을 아래로 오판 ≤ 0.10
  - 판정 못 함 ≤ 0.15
  - 전체 판정은 새 보정 3회 중 2회 통과다.
- **화면 문구:**
  - 평가, 점수, 집중도, 자신감 같은 표현을 쓰지 않는다.
  - 결과 화면에 "통과해도 정확도를 보장하지 않아요" 안내를 둔다.
- **커밋 메시지:** 영어 Conventional Commits 형식으로 쓰고, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 줄을 붙인다.

## Review Focus

1. **눈꺼풀이 내려간 아래 응시:** 대본을 보느라 눈꺼풀이 내려가면 '판정 못 함(blink)'이 아니라 '아래'여야 한다. → Task 1 테스트 `notes below the screen with lowered eyelids are down`.
2. **고개를 같이 움직인 보정:** 기준 잡기 때 고개도 같이 돌린 사용자의 눈만 움직인 응시가 맞게 판정돼야 한다. → Task 1 테스트 `calibration made with head movement still labels eyes-only looks`.
3. **눈 추적 무효가 많은 실행:** 조명이나 안경 때문에 무효가 많아도 정답률이 부풀면 안 되고, 판정 못 함 비율로 실패해야 한다. → Task 2 테스트 `unknown labels count against accuracy and fail the run above 15%`.
4. **실행 중 환경 변경:** 창 크기, 위치, 배율, 카메라 해상도가 바뀌면 그 실행은 무효이고 결과에 섞이지 않아야 한다. → Task 3 e2e `resizing the window during the run invalidates it`.
5. **실행 중 중단:** 시험 중단, 카메라 끄기, 화면 이탈 시 진행이 멈추고 결과가 남지 않아야 한다. → Task 3 e2e `stopping the run returns to the start with no results`.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| Modify `frontend/src/features/practice-track/video/gaze/constants.ts` | `DIRECTION`·`DIRECTION_PASS` 상수 (실측 뒤 조정할 값을 한곳에 둠) |
| Create `frontend/src/features/practice-track/video/gaze/direction.ts` | 기준 잡기 결과 계산, 방향 판정, 평활 (순수) |
| Create `frontend/src/features/practice-track/video/gaze/directionLab.ts` | 실험 순서, 채점, 집계, 3회 판정 (순수) |
| Create `frontend/src/features/practice-track/components/useDirectionCalibration.ts` | 기준 잡기 진행 hook (C2에서 재사용) |
| Create `frontend/src/features/practice-track/components/DirectionTargetOverlay.tsx`, `.css` | 화면 전체 점·안내 오버레이 (C2에서 재사용) |
| Create `frontend/src/features/practice-track/pages/GazeDirectionLab.tsx` | 실험실 화면 |
| Modify `frontend/src/features/practice-track/routes.tsx` | `dev/gaze-direction` 경로 (GAZE_LAB일 때만) |
| Modify `frontend/src/features/practice-track/video/fakeDetector.ts` | e2e 가짜 사용자 `"gaze-still"` 모드 |
| Create `frontend/tests/practice-track/unit/gaze-direction.spec.ts` | Task 1·2 계산 테스트 |
| Create `frontend/e2e/practice-track/gaze-direction.spec.ts` | Task 3 화면 흐름 테스트 (desktop만) |
| Create `docs/practice-track/gaze-direction-protocol.md` | 사람이 직접 하는 3회 실측 절차와 기록표 |

---

### Task 1: 방향 보정·판정 모듈

**Files:**
- Modify: `frontend/src/features/practice-track/video/gaze/constants.ts` (파일 끝에 추가)
- Create: `frontend/src/features/practice-track/video/gaze/direction.ts`
- Test: `frontend/tests/practice-track/unit/gaze-direction.spec.ts`

**Interfaces:**
- Consumes:
  - `gazeFeatures(points, width, height): GazeFeatures | FeatureInvalid`, `isFeatures` (`./features`).
  - `Frame` (`./sampler`).
  - `median` (`../stats`).
  - `MIN_VALID`, `OPEN_MIN_RATIO`, `SCALE_TOL`, `POS_TOL` (`./constants`).
- Produces:

```ts
// constants.ts
export const DIRECTION = { alphaX: 0.8, alphaY: 1.7, enter: 0.5, minSeparation: 3, smoothMs: 750,
  settleMs: 700, collectMs: 1300, calibrateHz: 10, trialHz: 4 } as const;
export const DIRECTION_PASS = { center: 0.85, down: 0.8, side: 0.7, centerAsDownMax: 0.1, unknownMax: 0.15, runsTotal: 3, runsNeeded: 2 } as const;

// direction.ts
export type Direction = "center" | "up" | "down" | "left" | "right";
export const DIRECTIONS: readonly Direction[];            // ["center","up","down","left","right"]
export type Edge = Exclude<Direction, "center">;
export type UnknownReason = FeatureInvalid["invalid"] | "blink" | "pose_changed";
export type DirectionLabel = { label: Direction } | { label: "unknown"; reason: UnknownReason };
export type CalibrationTarget = { direction: Direction; x: number; y: number };   // 뷰포트 비율
export const CALIBRATION_TARGETS: readonly CalibrationTarget[];                  // Global Constraints의 순서·위치
export type Vec2 = { gx: number; gy: number };
export type CalibrationFailure = "insufficient_samples" | "not_separated" | "axes_inconsistent";
export type DirectionCalibration = {
  center: Vec2;
  axes: Record<Edge, Vec2>;               // 각 가장자리 점의 (중앙값 − 가운데) 결합 시선
  base: { open: number; scale: number; faceX: number; faceY: number };   // 가운데 점의 중앙값
  noise: number;                          // 점 안 흩어짐(gx·gy 분산 평균의 제곱근, 점 5개 평균)
  quality: { ok: true } | { ok: false; reason: CalibrationFailure; direction?: Direction };
};
export function gazeProxy(f: GazeFeatures): Vec2;   // { gx: ex + alphaX·hx, gy: ey + alphaY·hy }
export function featuresFromFrames(frames: Frame[]): (GazeFeatures | FeatureInvalid)[];
export function calibrateDirections(samples: Record<Direction, GazeFeatures[]>): DirectionCalibration;
export function classifyDirection(f: GazeFeatures | FeatureInvalid, cal: DirectionCalibration): DirectionLabel;
export function smoothLabels(seq: { t: number; label: DirectionLabel }[], windowMs?: number): DirectionLabel[];
```

- [ ] **Step 0: 작업 환경 준비 (처음 한 번)**

```bash
cd frontend && npm ci
cd ../backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cd ../frontend && npx playwright test -c playwright.unit.config.ts tests/practice-track/unit/gaze-math.spec.ts
```
Expected: `gaze-math.spec.ts` 전부 PASS (기준선 확인).

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/practice-track/unit/gaze-direction.spec.ts`)

테스트 도우미:
- `look([x, y], o?)`: `syntheticFace({ ...screenToGaze(x*VIEW.w, y*VIEW.h, VIEW), yaw, pitch, eyeOpen, scale, noise: 0.0001, seed })`를 `gazeFeatures(…, 640, 480)`에 넣은 결과(`GazeFeatures`로 단언). `o`는 `{ yaw?, pitch?, eyeOpen?, scale?, seed? }`.
- `calib(o?)`: `CALIBRATION_TARGETS`마다 seed 1~12의 `look`을 모은 `Record<Direction, GazeFeatures[]>`. `o.head`가 참이면 가장자리 점에서 `POSE_GEOMETRY`의 같은 이름 자세(yaw·pitch)를 함께 준다.
- `VIEW`, `screenToGaze`, `syntheticFace`, `POSE_GEOMETRY`는 `video/gaze/synthetic`에서 가져온다.

```ts
test("eyes-only calibration is ok and labels the five targets", () => {
  const cal = calibrateDirections(calib());
  expect(cal.quality).toEqual({ ok: true });
  for (const t of CALIBRATION_TARGETS) expect(classifyDirection(look([t.x, t.y], { seed: 99 }), cal)).toEqual({ label: t.direction });
  expect(classifyDirection(look([0.5, 0.38]), cal)).toEqual({ label: "center" });   // 위쪽 가장자리까지 절반이 안 됨
  expect(classifyDirection(look([0.2, 0.5]), cal)).toEqual({ label: "left" });      // 절반을 넘음
});
test("head-only turn toward the left is left and head-only tilt down is down", () => {
  const cal = calibrateDirections(calib());
  expect(classifyDirection(look([0.5, 0.5], { yaw: -0.25 }), cal).label).toBe("center"); // 고개만 돌리고 눈은 화면 가운데(눈이 반대로 돎)
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
  const seq = [0, 1, 2, 3, 4].map((i) => ({ t: i * 250, label: i === 2 ? { label: "unknown", reason: "blink" } as const : { label: "center" } as const }));
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
  const s = calib(); s.up = s.up.slice(0, 7);
  expect(calibrateDirections(s).quality).toEqual({ ok: false, reason: "insufficient_samples", direction: "up" });
});
test("smoothing keeps a sustained change", () => {
  const seq = Array.from({ length: 8 }, (_, i) => ({ t: i * 250, label: { label: i < 4 ? "center" : "down" } as DirectionLabel }));
  expect(smoothLabels(seq).slice(-3).map((l) => l.label)).toEqual(["down", "down", "down"]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx playwright test -c playwright.unit.config.ts tests/practice-track/unit/gaze-direction.spec.ts`
Expected: FAIL. `direction` 모듈이 없어 import에서 실패한다.

- [ ] **Step 3: 상수와 `direction.ts` 구현**

- `featuresFromFrames`: 프레임마다 `gazeFeatures(f.points, f.width, f.height)`.
- `calibrateDirections`:
  1. 점마다 유효 표본이 `MIN_VALID`보다 적으면 `insufficient_samples`와 해당 `direction`을 낸다. 확인 순서는 `DIRECTIONS` 순서다.
  2. 각 점의 `gazeProxy` 중앙값을 구한다. `axes[d]`는 (점 d 중앙값 − 가운데 중앙값)이다. `base`는 가운데 점의 `open`·`scale`·`faceX`·`faceY` 중앙값이다.
  3. `noise`를 계산한다. `axes`의 길이가 하나라도 `DIRECTION.minSeparation × max(noise, 1e-4)`보다 짧으면 `not_separated`와 해당 방향을 낸다.
  4. `dot(axes.left, axes.right) >= 0` 또는 `dot(axes.up, axes.down) >= 0`이면 `axes_inconsistent`.
- `classifyDirection`: 아래 순서로 판정한다.

```
invalid면 → unknown(그 사유)
|scale/base.scale−1| > SCALE_TOL 또는 |faceX−base.faceX| > POS_TOL 또는 |faceY−base.faceY| > POS_TOL → unknown(pose_changed)
o = gazeProxy(f) − center
가장자리 d마다 t_d = dot(o, axes[d]) / |axes[d]|²
best = argmax t_d
open/base.open < OPEN_MIN_RATIO 이면 → (best가 down이고 t_down ≥ enter) ? down : unknown(blink)
t_best ≥ enter ? best : center
```

- `smoothLabels`: 각 i에 대해 (t_i − windowMs, t_i] 안의 라벨을 센다. 키는 방향 이름 또는 `"unknown"`이다. 가장 많은 것을 고르고, 동점이면 i의 원래 라벨을 쓴다. 결과가 unknown이면 i 자신의 사유를 쓰고, i가 unknown이 아니었으면 창 안에서 가장 많은 사유를 쓴다. `windowMs`의 기본값은 `DIRECTION.smoothMs`다.

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx playwright test -c playwright.unit.config.ts tests/practice-track/unit/gaze-direction.spec.ts && npm run typecheck:practice-track`
Expected: 9 passed. 타입 오류가 없어야 한다.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/practice-track/video/gaze/constants.ts frontend/src/features/practice-track/video/gaze/direction.ts frontend/tests/practice-track/unit/gaze-direction.spec.ts
git commit -m "feat(gaze): calibrate and classify coarse gaze direction from head and iris features"
```

---

### Task 2: 방향 실험 순서·채점

**Files:**
- Create: `frontend/src/features/practice-track/video/gaze/directionLab.ts`
- Test: `frontend/tests/practice-track/unit/gaze-direction.spec.ts` (같은 파일에 `test.describe("direction lab")` 추가)

**Interfaces:**
- Consumes: `Direction`, `DIRECTIONS`, `DirectionLabel`, `UnknownReason` (Task 1); `DIRECTION`, `DIRECTION_PASS`; `Pose` (`./calibration`).
- Produces:

```ts
export type TrialCondition = "eyes" | "natural" | "script";
export type Trial = { id: string; expected: Direction; condition: TrialCondition; x: number; y: number; pose: Pose;
  settleMs: number; collectMs: number; prompt: string };
export function directionTrials(seed: number): Trial[];
export type TrialData = { trial: Trial; labels: DirectionLabel[] };          // 평활한 라벨
export type DirectionRunReport = {
  accuracy: Record<Direction, number | null>;
  byCondition: Record<"eyes" | "natural", Record<Direction, number | null>>;
  confusion: Record<Direction, Record<Direction | "unknown", number>>;    // 기대 방향 → 라벨 개수
  centerAsDown: number | null; unknownRate: number | null;
  unknownReasons: Partial<Record<UnknownReason, number>>;
  script: { down: number | null; unknown: number | null };
  samples: number; verdict: "pass" | "fail"; failed: string[];
};
export function evaluateDirectionRun(data: TrialData[]): DirectionRunReport;
export function directionAggregate(r: DirectionRunReport): Record<string, number | string | null>;
export function runsVerdict(verdicts: ("pass" | "fail")[]): "pass" | "fail" | "pending";
```

- [ ] **Step 1: 실패하는 테스트 작성**

테스트 도우미:
- `labelsFor(trials, pick)`: 시행마다 라벨 6개를 담은 `TrialData[]`. 라벨 하나마다 `pick(trial)`을 새로 부른다(시행 순서대로 186번).
- 기본 `pick`은 `{ label: trial.expected }`(완벽한 사용자)다.

```ts
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
  expect(r.verdict).toBe("pass"); expect(r.failed).toEqual([]); expect(r.accuracy.down).toBe(1);
});
test("looking at the center during down trials fails on down", () => {
  const r = evaluateDirectionRun(labelsFor(directionTrials(1), (t) => ({ label: t.expected === "down" ? "center" : t.expected })));
  expect(r.accuracy.down).toBe(0); expect(r.verdict).toBe("fail"); expect(r.failed).toContain("down");
});
test("unknown labels count against accuracy and fail the run above 15%", () => {
  let n = 0;
  const r = evaluateDirectionRun(labelsFor(directionTrials(1), (t) => (n++ % 5 === 0 ? { label: "unknown", reason: "eyes_unreliable" } : { label: t.expected })));
  expect(r.unknownRate).toBeCloseTo(0.2, 1); expect(r.accuracy.center!).toBeLessThan(0.85);
  expect(r.failed).toContain("unknown"); expect(r.unknownReasons.eyes_unreliable).toBeGreaterThan(0);
});
test("center looks labeled down are reported as centerAsDown", () => {
  const r = evaluateDirectionRun(labelsFor(directionTrials(1), (t) => ({ label: t.expected === "center" ? "down" : t.expected })));
  expect(r.centerAsDown).toBe(1); expect(r.failed).toEqual(expect.arrayContaining(["center", "centerAsDown"]));
});
test("aggregate has only numbers and strings and no feature names", () => {
  const out = directionAggregate(evaluateDirectionRun(labelsFor(directionTrials(1))));
  for (const [k, v] of Object.entries(out)) {
    expect(["number", "string"].includes(typeof v) || v === null).toBe(true);
    expect(k).not.toMatch(/\b(ex|ey|hx|hy|points|landmark)\b/);
  }
  expect(out["verdict"]).toBe("pass"); expect(out["acc.down"]).toBe(1);
});
test("runsVerdict needs two passes out of three", () => {
  expect(runsVerdict(["pass"])).toBe("pending");
  expect(runsVerdict(["pass", "fail", "pass"])).toBe("pass");
  expect(runsVerdict(["fail", "pass", "fail"])).toBe("fail");
  expect(runsVerdict(["pass", "pass"])).toBe("pass");
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx playwright test -c playwright.unit.config.ts tests/practice-track/unit/gaze-direction.spec.ts`
Expected: Task 2 테스트가 FAIL한다(`directionLab` 없음). Task 1 테스트는 PASS를 유지한다.

- [ ] **Step 3: `directionLab.ts` 구현**

**시행 위치** (뷰포트 비율, 반복 r = 0, 1, 2)

| 방향 | r = 0 | r = 1 | r = 2 |
|---|---|---|---|
| 정면 | (0.45, 0.45) | (0.55, 0.5) | (0.5, 0.55) |
| 위 | (0.35, 0.05) | (0.5, 0.04) | (0.65, 0.05) |
| 아래 | (0.35, 0.95) | (0.5, 0.96) | (0.65, 0.95) |
| 왼쪽 | (0.05, 0.35) | (0.04, 0.5) | (0.05, 0.65) |
| 오른쪽 | (0.95, 0.35) | (0.96, 0.5) | (0.95, 0.65) |

**조건과 순서**
- `eyes` 블록 15개(pose `forward`) → `natural` 블록 15개 → `script` 1개 순서다.
- `natural`의 pose: 정면은 `forward`, 위·아래·왼쪽·오른쪽은 같은 이름의 pose.
- 블록 안 순서는 seed로 섞는다. 파일 안에 mulberry32 난수와 Fisher–Yates 섞기를 둔다.
- `id` 형식: `` `${condition}-${direction}-${r}` ``, 대본 시행은 `"script"`.

**시간**
- 일반 시행: settle `DIRECTION.settleMs`, collect `DIRECTION.collectMs`.
- 대본 시행: x 0.5, y 1.3(뷰포트 아래 바깥), settle 1000, collect 5000.

**안내 문구 (정확히 이 글자)**
- eyes: `"고개는 그대로, 눈으로만 점을 보세요"`
- natural: `"고개와 눈을 편하게 움직여 점을 보세요"`
- script: `"종이 대본이 키보드 앞에 있다고 생각하고, 화면 아래 너머(책상)를 5초 동안 읽듯이 보세요"`

**채점**
- 분모는 해당 시행들의 라벨 전체다. unknown도 분모에 들어간다. 대본 시행은 `script`에만 넣고 다른 지표에서는 뺀다.
- `centerAsDown` = 정면 시행 라벨 중 `down`의 비율.
- `unknownRate` = eyes·natural 라벨 중 unknown의 비율.
- `failed`의 코드와 기준(`DIRECTION_PASS`): `center` ≥ 0.85, `down` ≥ 0.8, `up`·`left`·`right` ≥ 0.7, `centerAsDown` ≤ 0.1, `unknown` ≤ 0.15. 값이 null이면 실패로 센다.
- `verdict`는 `failed`가 비어 있으면 `"pass"`다.

**집계 키**
- `acc.<d>`, `acc.<cond>.<d>`, `confusion.<expected>.<label>`, `centerAsDown`, `unknownRate`, `unknown.<reason>`, `script.down`, `script.unknown`, `samples`, `verdict`, `failed`(쉼표로 이음).
- 숫자는 소수 셋째 자리에서 반올림한다.

**`runsVerdict`**
- 앞 `runsTotal`(3)개만 본다.
- 통과가 `runsNeeded`(2) 이상이면 pass, 실패가 2 이상이면 fail, 그 밖에는 pending.

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx playwright test -c playwright.unit.config.ts tests/practice-track/unit/gaze-direction.spec.ts && npm run typecheck:practice-track`
Expected: 16 passed. 타입 오류가 없어야 한다.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/practice-track/video/gaze/directionLab.ts frontend/tests/practice-track/unit/gaze-direction.spec.ts
git commit -m "feat(gaze): score direction lab trials against the provisional pass criteria"
```

---

### Task 3: 기준 잡기 hook, 오버레이, 실험실 화면

**Files:**
- Create: `frontend/src/features/practice-track/components/useDirectionCalibration.ts`
- Create: `frontend/src/features/practice-track/components/DirectionTargetOverlay.tsx`, `DirectionTargetOverlay.css`
- Create: `frontend/src/features/practice-track/pages/GazeDirectionLab.tsx`
- Modify: `frontend/src/features/practice-track/routes.tsx` (GazeLab lazy 선언 옆)
- Modify: `frontend/src/features/practice-track/video/fakeDetector.ts` (`loadFakeDetector`의 모드 분기, `gazeUser`)
- Create: `docs/practice-track/gaze-direction-protocol.md`
- Test: `frontend/e2e/practice-track/gaze-direction.spec.ts`

**Interfaces:**
- Consumes:
  - Task 1의 `CALIBRATION_TARGETS`, `calibrateDirections`, `classifyDirection`, `featuresFromFrames`, `smoothLabels`, `DIRECTION`. 기존 `isFeatures` (`video/gaze/features`).
  - Task 2의 `directionTrials`, `evaluateDirectionRun`, `directionAggregate`, `runsVerdict`.
  - `useFaceAnalysis()`의 `subscribeFrames`·`setTargetHz`·`status`.
  - `createCalibrationGuard`, `CalibrationInvalid` (`video/gaze/quality`).
- Produces (C2가 재사용):

```ts
// useDirectionCalibration.ts
export type CalibrationRunState =
  | { phase: "idle" }
  | { phase: "running"; target: CalibrationTarget; step: number; total: number }
  | { phase: "done"; calibration: DirectionCalibration }
  | { phase: "failed"; reason: CalibrationFailure | CalibrationInvalid | "aborted"; direction?: Direction };
export function useDirectionCalibration(cam: { subscribeFrames: (cb: (f: Frame) => void) => () => void; setTargetHz: (hz: number) => void },
  opts?: { timeScale?: number; hz?: number }): { state: CalibrationRunState; start: () => Promise<DirectionCalibration | null>; cancel: () => void };

// DirectionTargetOverlay.tsx  (x, y는 뷰포트 px. 뷰포트 밖이어도 그 자리에 그린다)
export default function DirectionTargetOverlay(p: { x: number; y: number; prompt: string; pose: Pose; step?: number; total?: number }): JSX.Element;
```

- [ ] **Step 1: 실패하는 e2e 작성** (`e2e/practice-track/gaze-direction.spec.ts`, desktop만)

`startLab(page, mode)`는 기존 `gaze-lab.spec.ts`와 같은 방식이다.
- 순서: `e2e-face-detector`=mode, `e2e-gaze-scale`="0.2" 설정 → `/practice/dev/gaze-direction` 이동 → heading `"시선 방향 실험실(개발 전용)"` 확인 → `"동의하고 카메라 켜기"` 클릭 → `"얼굴이 화면 안에 있어요"` 확인 → `"시험 시작"` 클릭.

```ts
test("following fake user: calibration succeeds, the run passes, nothing is sent", async ({ page }) => {
  const sent: string[] = []; page.on("request", (r) => { const b = r.postData(); if (b) sent.push(b); });
  await startLab(page, "gaze");
  await expect(page.getByRole("heading", { name: "시험 결과" })).toBeVisible({ timeout: 120_000 });
  const rows = page.getByTestId("direction-results");
  for (const name of ["정면", "위", "아래", "왼쪽", "오른쪽"]) await expect(rows).toContainText(name);
  await expect(page.getByTestId("direction-verdict")).toContainText("통과");
  await expect(page.getByTestId("direction-runs")).toContainText("1번 중 통과 1");
  await expect(page.getByText("통과해도 정확도를 보장하지 않아요")).toBeVisible();
  expect(sent.filter((b) => /landmark|gaze|points|"ex"|"ey"/i.test(b))).toEqual([]);
});
test("a user who does not follow the dots fails calibration and can retry", async ({ page }) => {
  await startLab(page, "gaze-still");
  await expect(page.getByRole("alert")).toContainText("기준을 잡지 못했어요", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "다시 하기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});
test("resizing the window during the run invalidates it", async ({ page }) => {
  await startLab(page, "gaze");
  await expect(page.getByTestId("direction-prompt")).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.getByRole("alert")).toContainText("무효", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});
test("stopping the run returns to the start with no results", async ({ page }) => {
  await startLab(page, "gaze");
  await expect(page.getByTestId("direction-prompt")).toBeVisible();
  await page.getByRole("button", { name: "시험 중단" }).click();
  await expect(page.getByRole("button", { name: "시험 시작" })).toBeEnabled();
  await expect(page.getByTestId("direction-prompt")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && PATH="$PWD/../backend/.venv/bin:$PATH" npx playwright test -c playwright.practice-track.config.ts e2e/practice-track/gaze-direction.spec.ts --project=desktop`
Expected: FAIL. 경로가 없어서 heading을 찾지 못한다.
- Chromium이 시스템 라이브러리 부족으로 뜨지 않으면 이 단계를 멈추고 사용자에게 `npx playwright install-deps chromium`(sudo 필요) 실행을 요청한다.

- [ ] **Step 3: 가짜 검출기 `"gaze-still"` 모드**

- `loadFakeDetector`의 시선 모드 목록에 `"gaze-still"`을 더한다.
- `gazeUser`는 이 모드에서 항상 `screenToGaze(innerWidth/2, innerHeight/2)`를 `forward` 자세로 본다.

- [ ] **Step 4: `useDirectionCalibration`과 `DirectionTargetOverlay`**

**hook (`useDirectionCalibration`)**
- `CALIBRATION_TARGETS`를 차례로 돈다.
  - 점마다 `setTargetHz(opts.hz ?? DIRECTION.calibrateHz)`를 부른다.
  - `settleMs × timeScale`만큼 기다린다.
  - `collectMs × timeScale` 동안 `subscribeFrames`로 프레임을 모은다. 한 점당 최대 600개까지만 담는다.
  - 모은 프레임을 `featuresFromFrames`에 넣고, `isFeatures`인 것만 남긴다.
- 시작할 때 `createCalibrationGuard(뷰포트 문자열)`를 만들고, 프레임마다 검사한다. 뷰포트 문자열은 `GazeLab.tsx`의 `geometry()`와 같은 형식이다.
  - 무효가 되면 `failed`로 바꾸고, 사유는 `viewport_changed` 같은 무효 사유를 그대로 쓴다.
- 결과 처리:
  - `quality.ok`가 false면 `failed`로 바꾸고 `reason`과 `direction`을 담는다.
  - 성공하면 `done`이다.
- 정리:
  - `cancel()`이나 unmount 때 진행 중인 구독을 해제하고 `aborted`로 끝낸다.
  - 끝나면 항상 `setTargetHz(4)`로 되돌린다.

**오버레이 (`DirectionTargetOverlay`)**
- 화면 전체를 덮는 레이어다.
  - 안내문: `data-testid="direction-prompt"`. `step`·`total`이 있으면 "(n/m)"을 붙인다.
  - 점: `data-gaze-target`, `data-gaze-pose={pose}`, `style={{ left: x, top: y }}`.
- CSS는 `DirectionTargetOverlay.css`에 `.practice-track.practice-track .direction-overlay*` 범위로 둔다. 모양은 `GazeLab.css`의 overlay·prompt·dot과 같다.

- [ ] **Step 5: `GazeDirectionLab.tsx`와 경로**

**경로**
- `routes.tsx`의 GAZE_LAB 블록에 `dev/gaze-direction`을 추가한다(lazy, `Suspense`).

**화면 구성**
- 제목 `"시선 방향 실험실(개발 전용)"`.
- 소개 카드:
  - 약 1분 30초 걸린다.
  - 영상·특징점·좌표는 저장하거나 보내지 않는다.
  - 창 크기·위치·배율을 바꾸면 무효가 된다.
  - 결과는 회고 화면에 시선 방향을 넣을지 정하는 실험 기준이다.
- `CameraPanel` (GazeLab과 같은 props 배선).
- `"시험 시작"` 버튼: 카메라가 `on`이고 진행 중이 아닐 때만 누를 수 있다.

**진행 순서**
1. 기준 잡기. hook을 쓰고, e2e에서는 `hz: 60`, `timeScale = Number(localStorage["e2e-gaze-scale"]) || 1`이다.
2. 실패하면 `role="alert"`에 문구를 보이고 `"다시 하기"` 버튼을 둔다.
   - `"기준을 잡지 못했어요: "` + 사유 문장.
   - `not_separated`: "점을 따라 볼 때 시선 변화가 충분히 잡히지 않았어요"
   - `insufficient_samples`: "얼굴이나 눈이 충분히 잡히지 않았어요"
   - `axes_inconsistent`: "방향이 서로 맞지 않게 잡혔어요"
   - 무효 사유는 GazeLab의 `INVALID` 문구를 그대로 쓴다.
3. `directionTrials(실행 번호)`를 차례로 진행한다.
   - 각 시행에서 오버레이를 표시한다. 좌표는 `x·clientWidth`, `y·clientHeight`(px)다.
   - `setTargetHz(E2E ? 60 : DIRECTION.trialHz)`.
   - settle만큼 기다린 뒤 collect 동안 프레임을 모은다.
   - 모은 프레임에 `classifyDirection`과 `smoothLabels`를 차례로 적용해 `TrialData`를 만든다.
   - guard로 무효를 검사한다. 무효면 `role="alert"`에 GazeLab과 같은 "…이번 시험은 무효예요." 문구를 보이고 결과를 남기지 않는다.
4. 진행 중에는 `"시험 중단"` 버튼을 보인다. 누르면 intro로 돌아간다.
   - 카메라 `status`가 `on`이 아니게 되거나 unmount되면 같은 방식으로 멈춘다.

**결과 화면**
- 제목 `"시험 결과"`.
- `data-testid="direction-results"` 표: 방향(정면·위·아래·왼쪽·오른쪽)마다 전체·눈만·자연스럽게 정답률.
- `data-testid="direction-confusion"` 혼동표.
- 정면→아래 오판, 판정 못 함 비율과 사유별 개수, 대본 시행의 아래 비율.
- `data-testid="direction-verdict"`: "이번 실행: 통과/실패" + 실패 항목.
- `data-testid="direction-runs"`: `` `실행 ${n}번 중 통과 ${k}` `` + `runsVerdict` 문구("3번 중 2번 기준: 통과 / 실패 / 진행 중").
- 안내문: "이 판정은 회고 화면에 시선 방향을 넣을지 정하는 실험 기준이에요. 통과해도 정확도를 보장하지 않아요."
- 버튼:
  - `"집계 복사(JSON)"`: 실행별 `directionAggregate` 배열에 카메라 해상도, 뷰포트, `devicePixelRatio`를 더해 복사한다.
  - `"결과 지우기"`.

- [ ] **Step 6: 사람용 실측 절차 문서** (`docs/practice-track/gaze-direction-protocol.md`)

담을 내용:
- **실행:** `scripts/practice-track/start-validation-pilot.sh`로 연 뒤, 브라우저에서 `http://127.0.0.1:5181/practice/dev/gaze-direction`에 접속한다. 로그인은 로컬 계정 `practice@example.invalid` / `local-test-only`.
- **환경:** 화면에서 50~60cm, 평소 조명, 노트북 내장 카메라. 창을 고정하고 배율을 바꾸지 않는다.
- **기록할 것:** 카메라, 브라우저·OS, 해상도, 뷰포트, 배율, 안경 여부, Git SHA.
- **실행 횟수:** 새 기준 잡기로 3회 연속 실행한다. 회차마다 "집계 복사(JSON)"를 붙인다.
- **기록표:** 회차별 정면·위·아래·왼쪽·오른쪽 정답률, 정면→아래, 판정 못 함, 대본 아래, 통과 여부.
- **판정 규칙:** 3회 중 2회 통과. 통과해도 정확도 보장은 아니다.
- **추가 실행 (선택):** 안경이나 저조도 중 하나만 바꿔서 1회 더 한다.

- [ ] **Step 7: 전체 확인**

Run:
```bash
cd frontend && npx playwright test -c playwright.unit.config.ts \
 && PATH="$PWD/../backend/.venv/bin:$PATH" npx playwright test -c playwright.practice-track.config.ts e2e/practice-track/gaze-direction.spec.ts e2e/practice-track/gaze-lab.spec.ts e2e/practice-track/camera.spec.ts --project=desktop \
 && npm run build
```
Expected:
- unit 전체 PASS.
- 새 e2e 4개와 기존 `gaze-lab`·`camera` e2e가 PASS.
- `npm run build` 통과. 프로덕션 번들에 실험실이 없어야 하므로 `grep -r "시선 방향 실험실" dist` 결과가 비어 있어야 한다.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/practice-track/components/useDirectionCalibration.ts frontend/src/features/practice-track/components/DirectionTargetOverlay.tsx frontend/src/features/practice-track/components/DirectionTargetOverlay.css frontend/src/features/practice-track/pages/GazeDirectionLab.tsx frontend/src/features/practice-track/routes.tsx frontend/src/features/practice-track/video/fakeDetector.ts frontend/e2e/practice-track/gaze-direction.spec.ts docs/practice-track/gaze-direction-protocol.md
git commit -m "feat(gaze): add the dev-only direction lab with a 10-second calibration and run scoring"
```
