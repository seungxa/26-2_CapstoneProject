import { useCallback, useEffect, useRef, useState } from "react";
import DirectionTargetOverlay from "./DirectionTargetOverlay";
import { useDirectionCalibration, viewportGeometry } from "./useDirectionCalibration";
import { gazeDirectionEnabled } from "../video/debug";
import { classifyDirection, featuresFromFrames, smoothLabels, type DirectionCalibration } from "../video/gaze/direction";
import { summarizeDirections, type GazeSummary } from "../video/gaze/directionSummary";
import { createCalibrationGuard } from "../video/gaze/quality";
import type { Frame } from "../video/gaze/sampler";

type Cam = { status: string; subscribeFrames: (cb: (f: Frame) => void) => () => void; setTargetHz: (hz: number) => void };

const FAILED: Record<string, string> = {
  not_separated: "Your gaze didn't move enough between the dots.",
  insufficient_samples: "Your face or eyes weren't found well enough.",
  axes_inconsistent: "The directions came out mixed up.",
  aborted: "Calibration stopped.",
};
const MAX_FRAMES = 4000;
const E2E = import.meta.env.VITE_E2E_FAKE_FACE === "true";
const timeScale = () => (E2E ? Number(localStorage.getItem("e2e-gaze-scale")) || 1 : 1);

/** Gaze direction for the practice screen: a 10-second calibration before the first answer, then per-answer
 *  direction times. Frames stay in this tab; only the summary numbers are kept (with the camera summary) */
export function useGazeDirection(cam: Cam) {
  const enabled = gazeDirectionEnabled();
  const calib = useDirectionCalibration(cam, { timeScale: timeScale(), hz: E2E ? 60 : undefined });
  const [calibration, setCalibration] = useState<DirectionCalibration | null>(null);
  const [skipped, setSkipped] = useState(false);
  const guard = useRef<ReturnType<typeof createCalibrationGuard> | null>(null);
  const frames = useRef<Frame[] | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const calibrate = useCallback(async () => {
    const result = await calib.start();
    if (result) { setCalibration(result); guard.current = createCalibrationGuard(viewportGeometry()); }
  }, [calib]);

  /** Answer started: collect frames if calibrated and the view is unchanged since calibrating */
  const begin = useCallback(() => {
    stop.current?.();
    frames.current = null;
    if (!enabled || !calibration || cam.status !== "on") return;
    if (guard.current?.check(viewportGeometry())) { setCalibration(null); return; }
    const mine: Frame[] = [];
    frames.current = mine;
    stop.current = cam.subscribeFrames((f) => {
      if (guard.current?.check(viewportGeometry(), { width: f.width, height: f.height })) { frames.current = null; return; }
      if (mine.length < MAX_FRAMES) mine.push(f);
    });
  }, [calibration, cam, enabled]);

  /** Answer finished: the direction summary, or undefined when nothing was measured */
  const end = useCallback((): GazeSummary | undefined => {
    stop.current?.();
    stop.current = null;
    const collected = frames.current;
    frames.current = null;
    if (!collected?.length || !calibration) {
      if (collected === null && calibration && guard.current?.check(viewportGeometry())) setCalibration(null);
      return undefined;
    }
    const labels = featuresFromFrames(collected).map((f) => classifyDirection(f, calibration));
    const smooth = smoothLabels(collected.map((f, i) => ({ t: f.t, label: labels[i] })));
    return summarizeDirections(collected.map((f, i) => ({ t: f.t, label: smooth[i] })));
  }, [calibration]);

  const state = calib.state;
  const needed = enabled && cam.status === "on" && !calibration && !skipped;
  const step = needed ? (
    <div className="gaze-step card-inset" aria-labelledby="gaze-step-title">
      <p id="gaze-step-title"><b>Gaze direction (10 s)</b> Look at five dots so each answer can show where you looked.</p>
      {state.phase === "failed" && <p className="small warn-text" role="alert">{FAILED[state.reason] ?? "The view changed while calibrating."}</p>}
      <div className="row">
        <button disabled={state.phase === "running"} onClick={() => void calibrate()}>{state.phase === "failed" ? "Try Again" : "Calibrate"}</button>
        <button className="link" disabled={state.phase === "running"} onClick={() => setSkipped(true)}>Skip Calibration</button>
      </div>
    </div>
  ) : calibration && enabled ? (
    <p className="small muted gaze-step-done">Gaze calibrated. <button className="link" onClick={() => { setCalibration(null); }}>Calibrate again</button></p>
  ) : null;
  const view = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
  const overlay = state.phase === "running" ? (
    <DirectionTargetOverlay x={state.target.x * view.w} y={state.target.y * view.h} prompt="Look at the dot" pose="forward" step={state.step} total={state.total} />
  ) : null;
  return { enabled, calibration, step, overlay, begin, end };
}
