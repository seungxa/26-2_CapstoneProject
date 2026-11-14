import type { Pose } from "../video/gaze/calibration";
import "./DirectionTargetOverlay.css";

/** 시선 방향 기준 잡기·실험의 화면 전체 레이어: 볼 점 하나와 안내. x·y는 뷰포트 px이고, 뷰포트 밖이어도 그 자리에 그린다
 *  (대본 읽기처럼 화면 아래 너머를 보는 시행). e2e 가짜 검출기는 data-gaze-target 요소의 가운데를 data-gaze-pose 자세로 본다. */
export default function DirectionTargetOverlay({ x, y, prompt, pose, step, total }: {
  x: number; y: number; prompt: string; pose: Pose; step?: number; total?: number;
}) {
  return <div className="direction-overlay">
    <p className="direction-overlay-prompt" data-testid="direction-prompt">
      {prompt}{step && total ? <span className="muted small"> ({step}/{total})</span> : null}
    </p>
    <div className="direction-overlay-dot" data-gaze-target="" data-gaze-pose={pose} style={{ left: x, top: y }} />
  </div>;
}
