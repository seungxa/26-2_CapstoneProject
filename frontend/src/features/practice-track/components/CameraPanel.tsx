import { Suspense, lazy } from "react";
import { CAMERA_DEBUG, gazeDirectionEnabled, type CameraDiag } from "../video/debug";
import type { CameraStatus } from "./useFaceAnalysis";
import { edgeLabel, type FaceState, type Overshoot } from "../video/metrics";

const FACE_LABEL: Record<FaceState, string> = {
  in: "Face in view",
  edge: "Part of your face is out of view",
  none: "Face not found",
};

// Dev-only diagnostics. CAMERA_DEBUG is false in production builds, so this module is never loaded there
const Diagnostics = CAMERA_DEBUG ? lazy(() => import("./CameraDiagnostics")) : null;

/** Optional camera feedback in the interview: turn on or off, preview, and the live face state.
 *  compact: the runner's small toggle (title, one line and the button on one row), not a card */
export default function CameraPanel({ status, error, face, edge, diag, onEnable, onDisable, attachVideo, liveHints=true, onLiveHintsChange, compact=false }: {
  compact?: boolean;
  liveHints?: boolean;
  onLiveHintsChange?: (enabled:boolean)=>void;
  status: CameraStatus;
  error: string | null;
  face: FaceState | null;
  /** The crossed side when edge (raw frame). The label names it as seen in the mirrored preview */
  edge: Overshoot | null;
  diag: CameraDiag | null;
  onEnable: () => void;
  onDisable: () => void;
  attachVideo: (el: HTMLVideoElement | null) => void;
}) {
  const on = status === "on";
  const turnOn = <button disabled={status === "starting"} onClick={onEnable}>{status === "starting" ? "Starting Camera…" : "Turn On Camera"}</button>;
  return (
    <section className={compact ? `camera-panel compact${on ? " on" : ""}` : "card camera-panel"}>
      <div className="camera-head">
        <h2>Camera Feedback</h2>
        <p className="small muted">Optional. Video stays on this device.</p>
        {compact && !on && turnOn}
      </div>
      {on ? (
        <div className="row camera-live">
          <video ref={attachVideo} className="camera-preview" autoPlay muted playsInline aria-label="Camera preview" />
          <div className="grow">
            {onLiveHintsChange&&<label className="check-label"><input type="checkbox" checked={liveHints} onChange={e=>onLiveHintsChange(e.target.checked)}/>Show live hints</label>}
            {liveHints&&<p role="status" className={face === "in" ? "small" : "small warn-text"}>{face === "edge" && edge ? edgeLabel(edge) : face ? FACE_LABEL[face] : "Waiting for camera…"}</p>}
            <button onClick={onDisable}>Turn Off Camera</button>
            {Diagnostics && diag && <Suspense fallback={null}><Diagnostics diag={diag} /></Suspense>}
          </div>
        </div>
      ) : <>
        {error && <p className="warn-text" role="alert">{error}</p>}
        {!compact && turnOn}
      </>}
      <details className="fold">
        <summary>Details</summary>
        <ul className="bullets small">
          <li>It measures only while you record an answer: how often your face is found, time with your face not found or partly out of view, and changes in head turn and tilt. You see the results in your review.</li>
          <li>{gazeDirectionEnabled() ? "Gaze direction is a rough estimate of where you looked, after a 10-second calibration. It" : "It's not eye tracking, and it"} doesn't judge confidence or emotion.</li>
          <li>Nothing is saved. Results are cleared when you reload or close the page.</li>
          <li>Turning it on downloads a face-tracking file from Google. Google's library may send usage statistics, but never your video.</li>
        </ul>
      </details>
    </section>
  );
}
