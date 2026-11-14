import { CAMERA_DEBUG, type CameraDiag } from "../video/debug";
import { edgeLabel } from "../video/metrics";

const n3 = (v: number) => v.toFixed(3);

/** Dev-only camera diagnostics for checking the numbers with a real webcam (manual check in docs/progress.md).
 *  Renders nothing unless the dev flag is on. Nothing here is saved or sent */
export default function CameraDiagnostics({ diag }: { diag: CameraDiag }) {
  if (!CAMERA_DEBUG) return null;
  const { sample: s, width, height, counts: c } = diag;
  const o = s?.overshoot;
  return (
    <div className="small muted camera-diagnostics" aria-label="Camera diagnostics">
      <b>Camera Diagnostics (Dev)</b>
      <div>Resolution {width}×{height} · state {s?.state ?? "–"}</div>
      {o && <>
        <div>Overshoot (raw frame): top {n3(o.top)} · bottom {n3(o.bottom)} · raw left {n3(o.left)} · raw right {n3(o.right)}</div>
        <div>In the preview: {edgeLabel(o)} · eyes, nose, and mouth in frame: {s?.coreInside ? "yes" : "no"}</div>
      </>}
      <div>Samples in {c.in} · edge {c.edge} (core inside {c.edgeCore}) · none {c.none}</div>
    </div>
  );
}
