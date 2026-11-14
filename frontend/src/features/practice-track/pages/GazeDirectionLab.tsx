import { useCallback, useEffect, useRef, useState } from "react";
import CameraPanel from "../components/CameraPanel";
import DirectionTargetOverlay from "../components/DirectionTargetOverlay";
import { useDirectionCalibration, viewportGeometry } from "../components/useDirectionCalibration";
import { useFaceAnalysis } from "../components/useFaceAnalysis";
import { DIRECTION, DIRECTION_PASS } from "../video/gaze/constants";
import { DIRECTIONS, classifyDirection, featuresFromFrames, smoothLabels, type Direction, type UnknownReason } from "../video/gaze/direction";
import {
  directionAggregate, directionTrials, evaluateDirectionRun, runsVerdict,
  type DirectionRunReport, type Trial, type TrialData,
} from "../video/gaze/directionLab";
import { createCalibrationGuard, type CalibrationInvalid } from "../video/gaze/quality";
import type { Frame } from "../video/gaze/sampler";
import "./GazeLab.css";

/** 시선 방향 실험실(C5, 개발 전용 /dev/gaze-direction). 10초 기준 잡기 뒤 방향 시행을 돌려 방향별 정답률과 통과 여부를 보인다.
 *  기존 카메라 스트림·검출기를 그대로 쓰고, 프레임·특징점은 이 탭 메모리에서만 계산한 뒤 버린다. 화면을 떠나면 결과도 사라진다.
 *  판정은 회고 화면에 시선 방향을 넣을지 정하는 실험 기준이고 정확도 보장이 아니다. */

const E2E = import.meta.env.VITE_E2E_FAKE_FACE === "true";
/** e2e에서만 단계 시간을 줄이고, 빠른 가짜 검출기로 초당 60회 모은다 */
const timeScale = () => (E2E ? Number(localStorage.getItem("e2e-gaze-scale")) || 1 : 1);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LABEL: Record<Direction, string> = { center: "정면", up: "위", down: "아래", left: "왼쪽", right: "오른쪽" };
const INVALID: Record<CalibrationInvalid, string> = {
  viewport_changed: "창 크기·위치·배율이 바뀌어 이번 시험은 무효예요.",
  resolution_changed: "카메라 해상도가 바뀌어 이번 시험은 무효예요.",
  invalid_resolution: "유효한 카메라 해상도를 확인할 수 없어 이번 시험은 무효예요.",
};
const CAL_FAIL: Record<string, string> = {
  not_separated: "점을 따라 볼 때 시선 변화가 충분히 잡히지 않았어요",
  insufficient_samples: "얼굴이나 눈이 충분히 잡히지 않았어요",
  axes_inconsistent: "방향이 서로 맞지 않게 잡혔어요",
  ...INVALID,
};
const FAILED: Record<string, string> = { ...LABEL, centerAsDown: "정면→아래 오판", unknown: "판정 못 함" };
const REASON: Record<UnknownReason, string> = { no_face: "얼굴 없음", eyes_outside: "눈이 프레임 밖", eyes_unreliable: "눈 추적 불안정",
  invalid_resolution: "해상도 무효", nonfinite_geometry: "좌표·시각 비정상", blink: "눈 감김", pose_changed: "자세·거리 변화" };
const THRESHOLD: Record<Direction, number> = { center: DIRECTION_PASS.center, down: DIRECTION_PASS.down, up: DIRECTION_PASS.side,
  left: DIRECTION_PASS.side, right: DIRECTION_PASS.side };
const RUNS_TEXT = { pass: "통과", fail: "실패", pending: "진행 중" } as const;
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

type Phase = "intro" | "calibrating" | "running" | "calFailed" | "invalid" | "done";
type RunRecord = { report: DirectionRunReport; summary: Record<string, number | string | null> };

export default function GazeDirectionLab() {
  const cam = useFaceAnalysis();
  const { subscribeFrames, setTargetHz } = cam;
  const calib = useDirectionCalibration(cam, { timeScale: timeScale(), hz: E2E ? 60 : DIRECTION.calibrateHz });
  const { start: startCalibration, cancel: cancelCalibration } = calib;
  const [phase, setPhase] = useState<Phase>("intro");
  const [message, setMessage] = useState("");
  const [trial, setTrial] = useState<{ t: Trial; step: number; total: number } | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  /** 실행 세대. 중단·새 실행·unmount 때 올려서 늦게 깨어난 이전 실행이 화면을 바꾸지 못하게 한다 */
  const active = useRef(0);
  const attempts = useRef(0);
  const collecting = useRef<(() => void) | null>(null);
  const size = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => subscribeFrames((f) => { size.current = { w: f.width, h: f.height }; }), [subscribeFrames]);
  useEffect(() => () => { active.current++; collecting.current?.(); }, []);

  const stop = useCallback(() => {
    active.current++;
    collecting.current?.();
    collecting.current = null;
    cancelCalibration();
    setTargetHz(4);
    setTrial(null);
    setPhase("intro");
  }, [cancelCalibration, setTargetHz]);

  // 시험 중 카메라가 꺼지거나 오류가 나면 멈춘다
  useEffect(() => { if ((phase === "calibrating" || phase === "running") && cam.status !== "on") stop(); }, [cam.status, phase, stop]);

  const run = useCallback(async () => {
    const id = ++active.current;
    const live = () => id === active.current;
    const k = timeScale();
    // 기준 잡기부터 마지막 시행까지 한 기준: 뷰포트·카메라 해상도가 바뀌면 그 실행은 무효
    const guard = createCalibrationGuard(viewportGeometry());
    const seen = { invalid: null as CalibrationInvalid | null };
    const unwatch = subscribeFrames((f) => { seen.invalid ??= guard.check(viewportGeometry(), { width: f.width, height: f.height }); });
    setCopied(null);
    setMessage("");
    setPhase("calibrating");
    try {
      const cal = await startCalibration();
      if (!live()) return;
      if (!cal) { setPhase("calFailed"); return; }
      const trials = directionTrials(++attempts.current);
      const data: TrialData[] = [];
      setPhase("running");
      for (let i = 0; i < trials.length; i++) {
        const t = trials[i];
        setTrial({ t, step: i + 1, total: trials.length });
        setTargetHz(E2E ? 60 : DIRECTION.trialHz);
        await sleep(t.settleMs * k);
        if (!live()) return;
        const frames: Frame[] = [];
        collecting.current = subscribeFrames((f) => { if (frames.length < 2400) frames.push(f); });
        await sleep(t.collectMs * k);
        collecting.current?.();
        collecting.current = null;
        if (!live()) return;
        const invalid = seen.invalid ?? guard.check(viewportGeometry());
        if (invalid) {
          setMessage(INVALID[invalid]);
          setTrial(null);
          setPhase("invalid");
          return;
        }
        const labels = featuresFromFrames(frames).map((f, j) => ({ t: frames[j].t, label: classifyDirection(f, cal) }));
        data.push({ trial: t, labels: smoothLabels(labels) });
      }
      const report = evaluateDirectionRun(data);
      const view = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
      setRuns((prev) => [...prev, { report, summary: { run: prev.length + 1, ...directionAggregate(report),
        "camera.w": size.current?.w ?? null, "camera.h": size.current?.h ?? null, "view.w": view.w, "view.h": view.h, devicePixelRatio } }]);
      setTrial(null);
      setPhase("done");
    } finally {
      unwatch();
      if (live()) setTargetHz(4);
    }
  }, [setTargetHz, startCalibration, subscribeFrames]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(runs.map((r) => r.summary), null, 1));
      setCopied("복사했어요. docs/practice-track/gaze-direction-protocol.md의 기록표에 붙여 주세요.");
    } catch {
      setCopied("복사하지 못했어요. 아래 표의 숫자를 직접 옮겨 주세요.");
    }
  };
  const clear = () => { setRuns([]); setCopied(null); setPhase("intro"); };

  const busy = phase === "calibrating" || phase === "running";
  const view = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
  const calState = calib.state;
  const last = runs[runs.length - 1]?.report;
  return <>
    <h1>시선 방향 실험실(개발 전용)</h1>
    <section className="card small">
      <p>면접 회고에 넣을 시선 방향(정면·위·아래·왼쪽·오른쪽) 판정을 실제 웹캠으로 시험해요. 약 1분 30초 걸려요.</p>
      <ul className="bullets">
        <li>먼저 약 10초 동안 화면의 점 다섯 개를 보며 기준을 잡고, 이어서 안내에 따라 점을 봐요.</li>
        <li>영상·얼굴 특징점·시선 값은 저장하거나 서버·외부로 보내지 않아요. 집계 숫자만 보여 주고, 이 화면을 떠나면 사라져요.</li>
        <li>시험 중에 창 크기를 바꾸거나 창을 옮기거나 확대/축소하면 그 실행은 무효가 돼요.</li>
        <li>결과는 회고 화면에 시선 방향을 넣을지 정하는 실험 기준이에요. 평가나 점수가 아니에요.</li>
      </ul>
    </section>
    <CameraPanel status={cam.status} error={cam.error} face={cam.face} edge={cam.edge} diag={cam.diag}
      onEnable={() => void cam.enable()} onDisable={cam.disable} attachVideo={cam.attachVideo} />
    <section className="card">
      <div className="row">
        <button className="primary" disabled={cam.status !== "on" || busy} onClick={() => void run()}>시험 시작</button>
      </div>
      {phase === "calFailed" && calState.phase === "failed" && <div role="alert" className="warn-text">
        <p>기준을 잡지 못했어요: {CAL_FAIL[calState.reason] ?? calState.reason}
          {calState.direction ? ` (${LABEL[calState.direction]} 점)` : ""}</p>
        <button onClick={() => void run()}>다시 하기</button>
      </div>}
      {phase === "invalid" && <div role="alert" className="warn-text">
        <p>{message} 처음부터 다시 해 주세요.</p>
        <button onClick={() => void run()}>처음부터 다시</button>
      </div>}
    </section>
    {busy && <button className="gaze-lab-stop" onClick={stop}>시험 중단</button>}
    {phase === "done" && last && <Results report={last} runs={runs} onCopy={() => void copy()} onClear={clear} copied={copied} />}
    {phase === "calibrating" && calState.phase === "running" && <DirectionTargetOverlay x={calState.target.x * view.w}
      y={calState.target.y * view.h} prompt="점을 보세요(고개는 편하게)" pose="forward" step={calState.step} total={calState.total} />}
    {phase === "running" && trial && <DirectionTargetOverlay x={trial.t.x * view.w} y={trial.t.y * view.h} prompt={trial.t.prompt}
      pose={trial.t.pose} step={trial.step} total={trial.total} />}
  </>;
}

function Results({ report: r, runs, onCopy, onClear, copied }: { report: DirectionRunReport; runs: RunRecord[];
  onCopy: () => void; onClear: () => void; copied: string | null }) {
  const verdicts = runs.map((x) => x.report.verdict);
  const reasons = Object.entries(r.unknownReasons) as [UnknownReason, number][];
  return <section className="card">
    <h2>시험 결과</h2>
    <p className="small">이 판정은 회고 화면에 시선 방향을 넣을지 정하는 실험 기준이에요. 통과해도 정확도를 보장하지 않아요. 한 사람·한 기기·한 번의 결과예요.</p>
    <p data-testid="direction-verdict"><b>이번 실행: {r.verdict === "pass" ? "통과" : "실패"}</b>
      {r.failed.length ? ` (기준 미달: ${r.failed.map((c) => FAILED[c] ?? c).join(", ")})` : ""}</p>
    <table data-testid="direction-results"><thead><tr><th>방향</th><th>전체 정답률</th><th>눈만</th><th>고개와 함께</th><th>기준</th></tr></thead>
      <tbody>{DIRECTIONS.map((d) => <tr key={d}><td>{LABEL[d]}</td><td>{pct(r.accuracy[d])}</td><td>{pct(r.byCondition.eyes[d])}</td>
        <td>{pct(r.byCondition.natural[d])}</td><td>{pct(THRESHOLD[d])} 이상</td></tr>)}</tbody></table>
    <p className="small">정면을 아래로 오판 {pct(r.centerAsDown)} (기준 {pct(DIRECTION_PASS.centerAsDownMax)} 이하) ·
      판정 못 함 {pct(r.unknownRate)} (기준 {pct(DIRECTION_PASS.unknownMax)} 이하) · 대본 읽기 구간의 '아래' {pct(r.script.down)} (참고) · 표본 {r.samples}</p>
    {reasons.length > 0 && <p className="small muted">판정 못 함 사유: {reasons.map(([k, n]) => `${REASON[k] ?? k} ${n}`).join(" · ")}</p>}
    <h3>혼동표(기대한 방향 → 판정)</h3>
    <table data-testid="direction-confusion"><thead><tr><th>기대</th>{DIRECTIONS.map((d) => <th key={d}>{LABEL[d]}</th>)}<th>판정 못 함</th></tr></thead>
      <tbody>{DIRECTIONS.map((exp) => <tr key={exp}><td>{LABEL[exp]}</td>{DIRECTIONS.map((d) => <td key={d}>{r.confusion[exp][d]}</td>)}
        <td>{r.confusion[exp].unknown}</td></tr>)}</tbody></table>
    <p data-testid="direction-runs">실행 {runs.length}번 중 통과 {verdicts.filter((v) => v === "pass").length} ·
      새 기준 잡기 3번 중 2번 기준: {RUNS_TEXT[runsVerdict(verdicts)]}</p>
    <div className="row"><button onClick={onCopy}>집계 복사(JSON)</button><button onClick={onClear}>결과 지우기</button></div>
    {copied && <p className="small" role="status">{copied}</p>}
  </section>;
}
