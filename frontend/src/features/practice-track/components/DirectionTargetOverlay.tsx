import { useEffect, useRef } from "react";
import type { Pose } from "../video/gaze/calibration";
import "./DirectionTargetOverlay.css";

/** 시선 방향 기준 잡기·실험의 화면 전체 레이어: 볼 점 하나와 안내. x·y는 뷰포트 px이고, 뷰포트 밖이어도 그 자리에 그린다
 *  (대본 읽기처럼 화면 아래 너머를 보는 시행). e2e 가짜 검출기는 data-gaze-target 요소의 가운데를 data-gaze-pose 자세로 본다. */
export default function DirectionTargetOverlay({ x, y, prompt, pose, step, total, onCancel, label }: {
  x: number; y: number; prompt: string; pose: Pose; step?: number; total?: number;
  /** Practice screen: a Cancel button (focused) and Esc stop calibrating; the page behind can't be reached meanwhile */
  onCancel?: () => void; label?: string;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!onCancel) return;
    cancel.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onCancel]);
  return <div className="direction-overlay" {...(onCancel ? { role: "dialog", "aria-modal": true, "aria-label": label } : {})}>
    <p className="direction-overlay-prompt" data-testid="direction-prompt" aria-live="polite">
      {prompt}{step && total ? <span className="muted small"> ({step}/{total})</span> : null}
    </p>
    {onCancel && <button ref={cancel} className="direction-overlay-cancel" onClick={onCancel}>Cancel</button>}
    <div className="direction-overlay-dot" data-gaze-target="" data-gaze-pose={pose} style={{ left: x, top: y }} />
  </div>;
}
