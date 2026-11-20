import { createArtifact, downloadArtifacts, EXPORT_NOTICE_EN, faceMetrics } from "../validation/artifact";
import { useState } from "react";
import type { PracticeAnswer } from "../types";
import { CAMERA_DEBUG } from "../video/debug";
import type { GazeSummary } from "../video/gaze/directionSummary";
import { clearVideoSegment, getVideoSegments, getVideoRunId, getVideoSegmentMetadata, videoDiagnostics, type SegmentSummary } from "../video/metrics";

const sec = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

const DIRECTION_NAME = { center: "Center", up: "Up", down: "Down", left: "Left", right: "Right" } as const;
const UNKNOWN_NAME: Record<string, string> = { blink: "eyes closed", pose_changed: "moved from the calibrated position", no_face: "face not found",
  eyes_outside: "eyes out of view", eyes_unreliable: "eyes hard to track", invalid_resolution: "camera size unknown", nonfinite_geometry: "bad readings" };

/** Where the eyes and head pointed during the answer, against the 10-second calibration (C4) */
function GazeDirection({ g }: { g: GazeSummary }) {
  const measured = g.analyzedMs;
  const reason = Object.entries(g.unknownByReason).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  const down = measured ? g.byDirection.down / measured : 0;
  return (
    <div className="gaze-direction">
      <h4>Gaze direction</h4>
      <dl className="delivery-metrics">
        {(Object.keys(DIRECTION_NAME) as (keyof typeof DIRECTION_NAME)[]).map((d) => (
          <div key={d} className="gaze-row"><dt>{DIRECTION_NAME[d]}</dt>
            <dd data-metric={`gaze-${d}`}>{pct(g.byDirection[d], measured)}<span className="gaze-bar" style={{ width: `${measured ? (g.byDirection[d] / measured) * 100 : 0}%` }} aria-hidden="true" /></dd></div>
        ))}
        <dt>Not measured</dt><dd data-metric="gaze-unknown">{pct(g.unknownMs, measured)}{reason ? ` · mostly ${UNKNOWN_NAME[reason[0]] ?? reason[0]}` : ""}</dd>
        <dt>Direction changes</dt><dd data-metric="gaze-switches">{g.switches}</dd>
      </dl>
      {down >= 0.15 && <p className="small">Down {Math.round(down * 100)}%: this may be time spent reading notes or the keyboard.</p>}
      <p className="small muted">Screen and camera aren't told apart. This isn't a score.</p>
    </div>
  );
}

/** Dev-only (CAMERA_DEBUG): detector diagnostics, test condition and anonymous export for validation runs */
function CameraValidation({ sessionId, a, s }: { sessionId: string; a: PracticeAnswer; s: SegmentSummary }) {
  const [condition, setCondition] = useState("unspecified");
  const meta = getVideoSegmentMetadata(sessionId, a.id, a.recorded_at!);
  return (
    <div className="validation-tools">
      <ul className="small muted">{videoDiagnostics(s).comments.map((c, i) => <li key={i}>{c}</li>)}</ul>
      <label>Test condition <select value={condition} onChange={(e) => setCondition(e.target.value)}><option value="unspecified">Not recorded</option><option value="face-in-frame">Facing the camera, in frame</option><option value="face-edge">Face at the frame edge</option><option value="face-pose">Head turned or down</option><option value="low-light">Low light</option><option value="glasses">Glasses</option></select></label>
      <p className="small muted">{EXPORT_NOTICE_EN}</p>
      <button onClick={() => downloadArtifacts([createArtifact("face", faceMetrics(s), { attempts: 1, samples: s.samples, answerMs: s.answerMs, analyzedMs: s.analyzedMs }, { runId: getVideoRunId(sessionId, a.id, a.recorded_at!), condition, delegate: meta?.delegate, methodVersion: meta?.methodVersion, cameraWidth: meta?.cameraWidth, cameraHeight: meta?.cameraHeight, verdicts: { quality: s.analyzedMs > 0 ? "pass" : "fail" } })])}>Export Face Summary (JSON)</button>
    </div>
  );
}

/** One answer's camera numbers from this tab. Hidden when the camera was off or the page was reloaded */
export default function CameraDelivery({ sessionId, a, action, onCleared }: { sessionId: string; a: PracticeAnswer; action?: string; onCleared: () => void }) {
  const s = a.recorded_at ? getVideoSegments(sessionId, a.id, a.recorded_at) : undefined;
  if (!s) return null;
  const head = (ms: number) => (s.headMs ? pct(ms, s.headMs) : "Too short to measure");
  return (
    <div className="delivery-block camera-delivery">
      <h4>Camera</h4>
      <dl className="delivery-metrics">
        <dt>Analyzed</dt><dd data-metric="camera-analyzed">{sec(s.analyzedMs)} of {sec(s.answerMs)}</dd>
        <dt>Face found</dt><dd data-metric="face-found">{pct(s.detectedMs, s.analyzedMs)}</dd>
        <dt>Face not found</dt><dd data-metric="face-none">{sec(s.noneMs)} ({pct(s.noneMs, s.analyzedMs)}) · {s.noneEpisodes} over 1s, longest {sec(s.longestNoneMs)}</dd>
        <dt>Face partly out of view</dt><dd data-metric="face-edge">{sec(s.edgeMs)} ({pct(s.edgeMs, s.analyzedMs)})</dd>
        <dt>Head turned</dt><dd data-metric="head-turned">{head(s.turnedMs)}</dd>
        <dt>Head down</dt><dd data-metric="head-down">{head(s.downMs)}</dd>
      </dl>
      {s.gaze && <GazeDirection g={s.gaze} />}
      {action && <p className="small"><b>Try:</b> {action}</p>}
      <details className="fold">
        <summary>Details</summary>
        <ul className="bullets small muted">
          <li>About 4 checks per second. Time that wasn't analyzed (tab hidden, camera not ready or turned off) isn't counted.</li>
          <li>Face found includes time when part of your face was out of view. A face may not be found because of lighting, the angle or something in the way.</li>
          <li>Head direction is estimated from where your nose sits between your cheeks and between your forehead and chin, compared with your usual position in this answer. If you looked down from the start, it isn't counted as down. "Too short to measure" means your face wasn't fully in view long enough.</li>
          <li>{s.gaze ? "Gaze direction is a rough estimate from your eyes and head, compared with the 10-second calibration." : "This isn't eye tracking: it can't tell whether you looked at the screen or the camera."} Typed answers aren't measured.</li>
          <li>Lighting, camera position and glasses change the numbers. Video isn't saved, and these numbers are gone when you reload or close the tab.</li>
        </ul>
      </details>
      <button className="small" onClick={() => { clearVideoSegment(sessionId, a.id); onCleared(); }}>Clear Camera Results</button>
      {CAMERA_DEBUG && <CameraValidation sessionId={sessionId} a={a} s={s} />}
    </div>
  );
}
