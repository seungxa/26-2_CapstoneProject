# 시선 방향 화면 (계획 Z, C2~C4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연습 화면에서 10초 기준 잡기 뒤 답변마다 시선 방향 비율을 모으고, 회고의 Camera 부분에 보인다. 기능 플래그 뒤에 두고 기본은 끈다.

**Architecture:**
- 실험실의 `useDirectionCalibration`·`DirectionTargetOverlay`·`classifyDirection`·`smoothLabels`를 그대로 쓴다.
- 새 순수 함수 `summarizeDirections`가 평활한 판정열을 시간 요약으로 바꾼다. 요약은 기존 카메라 요약(`SegmentSummary`)의 선택 필드 `gaze`로 같은 저장소(탭 메모리)에 들어간다.

**Spec:** `docs/practice-track/2026-11-17-final-round-design.md` 6절, 원 설계 `2026-11-14-local-ai-gaze-direction-design.md` C2~C4.

## Global Constraints

- **플래그:** `GAZE_DIRECTION = VITE_GAZE_DIRECTION === "true"`. 단, 가짜 검출기 e2e(`VITE_E2E_FAKE_FACE`)에서는 `localStorage["e2e-gaze-direction"] === "1"`로도 켠다. 플래그가 꺼져 있으면 화면·요청·문구가 지금과 하나도 다르지 않다.
- **데이터:** 프레임·특징·좌표는 서버로 보내지 않는다. 요약 숫자만 탭 메모리에 둔다.
- **판정 시간 계산:**
  - 프레임 사이 간격을 그 판정의 시간으로 친다.
  - 500ms보다 긴 간격은 500ms만 센다(탭이 가려져 멈춘 시간을 세지 않음).
  - 0.75초 다수결 평활(`smoothLabels` 기본값)을 거친 판정으로 센다.
- **기준이 무효가 되는 경우:** 창 크기·배율·카메라 해상도가 바뀌면 기준을 버리고 다음 답변부터 재지 않는다. "Calibrate again"으로 다시 잡는다.
- **문구:** 영어, 최소. 평가·점수 표현 금지. 한계 안내 한 줄: "Screen and camera aren't told apart. This isn't a score."

## Tasks

### Task 1: 요약 함수
- **Create:** `video/gaze/directionSummary.ts`
  - `GazeSummary`: `{ analyzedMs, byDirection: Record<Direction, number>, unknownMs, unknownByReason, switches, longestDownMs }`
  - `summarizeDirections(seq: {t, label}[]): GazeSummary`
- **Test:** `tests/practice-track/unit/gaze-summary.spec.ts`
  - 4Hz 정면 2초 → center 2000.
  - 간격 3초는 500만 센다.
  - 방향이 바뀐 횟수(unknown은 바꿈으로 세지 않음).
  - 가장 긴 down 구간.
  - unknown 사유별 시간.
  - 빈 배열은 0.

### Task 2: 기준 잡기 단계와 답변 기록(C2·C3)
- **Modify:** `pages/SessionRunner.tsx`, `video/debug.ts`(`GAZE_DIRECTION`), `video/metrics.ts`(`SegmentSummary.gaze?`)
- **기준 잡기 단계:** 카메라가 켜져 있고 기준이 없으면, 답변 시작 전에 "Gaze direction (10 s)" 카드에 `Calibrate`·`Skip` 버튼.
  - 진행 중에는 실험실과 같은 점 오버레이.
  - 실패하면 이유 한 줄과 `Try again`·`Skip`.
  - 건너뛰면 그 세션은 다시 묻지 않는다.
- **답변 기록:**
  - 답변 구간에 프레임을 모은다(최대 4,000개).
  - 끝나면 분류·평활·요약해 `endSegment()` 결과의 `gaze`에 넣는다.
- **Test:** e2e `gaze-direction-product.spec.ts`(desktop, 가짜 검출기)
  - 플래그를 켜면 Calibrate → 답변 → 회고에 Gaze direction.
  - 플래그를 끄면 카드·결과가 없다.
  - Skip이면 결과가 없다.

### Task 3: 회고 카드(C4)
- **Modify:** `components/VideoReportCard.tsx`
- **보이는 것:** `s.gaze`가 있으면 "Gaze direction" 정의 목록을 보인다.
  - 방향별 시간·비율(Center/Up/Down/Left/Right)
  - Not measured(이유가 가장 많은 것 하나)
  - 방향 바뀐 횟수
  - Down이 15% 이상이면 해석 한 줄: "Down N%: this may be time spent reading notes or the keyboard."
  - 한계 안내 한 줄
- 기존 "This isn't eye tracking" 줄은 gaze가 있을 때만 "Gaze direction is a rough estimate from your eyes and head, compared with the 10-second calibration."으로 바꾼다.
- **Test:** Task 2의 e2e에서 확인.
