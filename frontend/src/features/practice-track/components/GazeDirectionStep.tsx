import { useCallback, useEffect, useRef, useState } from "react";
import DirectionTargetOverlay from "./DirectionTargetOverlay";
import { useDirectionCalibration, viewportGeometry } from "./useDirectionCalibration";
import { gazeDirectionEnabled } from "../video/debug";
import { classifyDirection, smoothLabels, type DirectionCalibration, type DirectionLabel } from "../video/gaze/direction";
import { gazeFeatures } from "../video/gaze/features";
import { summarizeDirections, type GazeSummary } from "../video/gaze/directionSummary";
import { createCalibrationGuard } from "../video/gaze/quality";
import type { Frame } from "../video/gaze/sampler";

type Cam = { status: string; subscribeFrames: (cb: (f: Frame) => void) => () => void; setTargetHz: (hz: number) => void };

const FAILED: Record<string, string> = {
  not_separated: "The dots couldn't be told apart. Try again a little closer to the screen.",
  insufficient_samples: "Your face or eyes weren't found well enough.",
  axes_inconsistent: "The directions came out mixed up.",
  aborted: "Calibration stopped.",
};
/** Labels kept per answer: about 80 minutes at 4 checks a second (each is a time and a label, not face points) */
const MAX_LABELS = 20000;
const E2E = import.meta.env.VITE_E2E_FAKE_FACE === "true";
const timeScale = () => (E2E ? Number(localStorage.getItem("e2e-gaze-scale")) || 1 : 1);

/** Gaze direction for the practice screen: a 10-second calibration before the first answer, then per-answer
 *  direction times. Frames stay in this tab; only the summary numbers are kept (with the camera summary) */
export function useGazeDirection(cam: Cam) {
  const enabled = gazeDirectionEnabled();
  const calib = useDirectionCalibration(cam, { timeScale: timeScale(), hz: E2E ? 60 : undefined });
  const [calibration, setCalibration] = useState<DirectionCalibration | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [reset, setReset] = useState(false); // a calibration was dropped because the window or camera changed
  const guard = useRef<ReturnType<typeof createCalibrationGuard> | null>(null);
  const frames = useRef<{ t: number; label: DirectionLabel }[] | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const calibrate = useCallback(async () => {
    // Remember the camera size during calibration: a later answer at another size must not use this calibration
    let size: { width: number; height: number } | undefined;
    const watch = cam.subscribeFrames((f) => { size = { width: f.width, height: f.height }; });
    try {
      const result = await calib.start();
      if (result) { setReset(false); setCalibration(result); guard.current = createCalibrationGuard(viewportGeometry(), size); }
    } finally { watch(); }
  }, [calib, cam]);

  /** Answer started: collect frames if calibrated and the view is unchanged since calibrating */
  const begin = useCallback(() => {
    stop.current?.();
    frames.current = null;
    if (!enabled || !calibration || cam.status !== "on") return;
    if (guard.current?.check(viewportGeometry())) { setCalibration(null); setReset(true); return; }
    const mine: { t: number; label: DirectionLabel }[] = [];
    frames.current = mine;
    const cal = calibration;
    stop.current = cam.subscribeFrames((f) => {
      if (guard.current?.check(viewportGeometry(), { width: f.width, height: f.height })) { frames.current = null; return; }
      // Classify at once and keep only the time and label: face points are not held for the whole answer
      if (mine.length < MAX_LABELS) mine.push({ t: f.t, label: classifyDirection(gazeFeatures(f.points, f.width, f.height), cal) });
    });
  }, [calibration, cam, enabled]);

  /** Answer finished: the direction summary, or undefined when nothing was measured */
  const end = useCallback((): GazeSummary | undefined => {
    stop.current?.();
    stop.current = null;
    const collected = frames.current;
    frames.current = null;
    if (!collected?.length || !calibration) {
      if (collected === null && calibration && guard.current?.check(viewportGeometry())) { setCalibration(null); setReset(true); }
      return undefined;
    }
    const smooth = smoothLabels(collected);
    return summarizeDirections(collected.map((c, i) => ({ t: c.t, label: smooth[i] })));
  }, [calibration]);

  const state = calib.state;
  const needed = enabled && cam.status === "on" && !calibration && !skipped;
  const step = needed ? (
    <div className="gaze-step card-inset" role="group" aria-labelledby="gaze-step-title">
      <p id="gaze-step-title"><b>Gaze direction (10 s)</b> Look at five dots so each answer can show where you looked.</p>
      {reset && state.phase !== "failed" && <p className="small warn-text">The window or camera changed, so gaze direction needs calibrating again.</p>}
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
    <DirectionTargetOverlay x={state.target.x * view.w} y={state.target.y * view.h} prompt="Look at the dot" pose="forward" step={state.step} total={state.total}
      onCancel={calib.cancel} label="Gaze calibration" />
  ) : null;
  return { enabled, calibration, step, overlay, begin, end, calibrating: state.phase === "running" };
}
