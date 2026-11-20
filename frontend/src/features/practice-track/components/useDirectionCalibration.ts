import { useCallback, useEffect, useRef, useState } from "react";
import { DIRECTION } from "../video/gaze/constants";
import {
  CALIBRATION_TARGETS, calibrateDirections, featuresFromFrames,
  type CalibrationFailure, type CalibrationTarget, type Direction, type DirectionCalibration,
} from "../video/gaze/direction";
import { isFeatures, type GazeFeatures } from "../video/gaze/features";
import { createCalibrationGuard, type CalibrationInvalid } from "../video/gaze/quality";
import type { Frame } from "../video/gaze/sampler";

/** 시선 방향 기준 잡기(약 10초) 진행 상태. 실험실(C5)과 면접 화면(C2)이 같이 쓴다.
 *  프레임·특징은 이 탭 메모리에서만 쓰고, 끝나면 보정 결과(숫자)만 남긴다. */
export type CalibrationRunState =
  | { phase: "idle" }
  | { phase: "running"; target: CalibrationTarget; step: number; total: number }
  | { phase: "done"; calibration: DirectionCalibration }
  | { phase: "failed"; reason: CalibrationFailure | CalibrationInvalid | "aborted"; direction?: Direction };

type Cam = { subscribeFrames: (cb: (f: Frame) => void) => () => void; setTargetHz: (hz: number) => void };

/** 보정은 시작할 때의 뷰포트 기준이다. 크기·창 위치·배율이 바뀌면 무효 */
export const viewportGeometry = () =>
  [innerWidth, innerHeight, screenX, screenY, devicePixelRatio, window.visualViewport?.scale ?? 1].join(",");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** 한 점에서 담는 프레임 상한(타이머가 멈춰도 원시 프레임이 쌓이지 않게) */
const MAX_FRAMES = 600;

export function useDirectionCalibration(cam: Cam, opts: { timeScale?: number; hz?: number } = {}) {
  const [state, setState] = useState<CalibrationRunState>({ phase: "idle" });
  const camRef = useRef(cam);
  camRef.current = cam;
  /** 실행 세대. 취소·새 실행·unmount 때 올려서 늦게 깨어난 이전 실행이 상태를 바꾸지 못하게 한다 */
  const gen = useRef(0);
  const unsubscribe = useRef<(() => void) | null>(null);
  const { timeScale = 1, hz = DIRECTION.calibrateHz } = opts;

  const release = useCallback(() => {
    unsubscribe.current?.();
    unsubscribe.current = null;
  }, []);

  const cancel = useCallback(() => {
    gen.current++;
    release();
    camRef.current.setTargetHz(4);
    setState({ phase: "failed", reason: "aborted" });
  }, [release]);

  useEffect(() => () => { gen.current++; release(); }, [release]);

  const start = useCallback(async (): Promise<DirectionCalibration | null> => {
    const id = ++gen.current;
    release();
    const live = () => id === gen.current;
    const guard = createCalibrationGuard(viewportGeometry());
    const samples = {} as Record<Direction, GazeFeatures[]>;
    const fail = (reason: CalibrationFailure | CalibrationInvalid, direction?: Direction) => {
      setState(direction ? { phase: "failed", reason, direction } : { phase: "failed", reason });
      return null;
    };
    try {
      for (let i = 0; i < CALIBRATION_TARGETS.length; i++) {
        const target = CALIBRATION_TARGETS[i];
        setState({ phase: "running", target, step: i + 1, total: CALIBRATION_TARGETS.length });
        camRef.current.setTargetHz(hz);
        await sleep(DIRECTION.settleMs * timeScale);
        if (!live()) return null;
        const frames: Frame[] = [];
        const seen = { invalid: null as CalibrationInvalid | null };
        unsubscribe.current = camRef.current.subscribeFrames((f) => {
          seen.invalid ??= guard.check(viewportGeometry(), { width: f.width, height: f.height });
          if (frames.length < MAX_FRAMES) frames.push(f);
        });
        await sleep(DIRECTION.collectMs * timeScale);
        release();
        if (!live()) return null;
        const invalid = seen.invalid ?? guard.check(viewportGeometry());
        if (invalid) return fail(invalid);
        samples[target.direction] = featuresFromFrames(frames).filter(isFeatures);
      }
      const calibration = calibrateDirections(samples);
      if (!calibration.quality.ok) return fail(calibration.quality.reason, calibration.quality.direction);
      setState({ phase: "done", calibration });
      return calibration;
    } finally {
      if (live()) camRef.current.setTargetHz(4);
    }
  }, [hz, release, timeScale]);

  return { state, start, cancel };
}
