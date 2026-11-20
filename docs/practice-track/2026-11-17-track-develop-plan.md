# Track 디벨롭 (계획 X) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지원 관리에 마감일·다음 일정과 D-day, 단계별 보드, 달력, 강화된 통계를 더한다.

**Architecture:**
- **서버:** `applications`에 일정 컬럼 셋을 더하고, 목록의 `sort=due`, 달력용 `GET /track/calendar`, 통계의 `upcoming`·`days_to_first_result`를 더한다.
- **화면:** 기능 폴더 안에 Board·Calendar 페이지와 D-day 칩을 더하고, Stats 화면을 넓힌다.
- **DB 변경:** migration 하나. SQLite는 ORM 컬럼 자동 추가로 따라온다.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL migration, React 19 + react-router 8, Playwright(unit·e2e).

**Spec:** `docs/practice-track/2026-11-17-final-round-design.md` 2절(T1~T4).

## Global Constraints

- **DB:** SQLite와 Supabase(Postgres) 양쪽에서 동작한다. 새 migration은 `add column if not exists`로 다시 실행해도 안전하다. `schema.sql`에도 같은 문장을 붙여 새 DB와 업그레이드 DB의 카탈로그가 같다(기존 `test_historical_upgrade…` 시험).
- **컬럼:** `deadline date`, `next_step_on date`, `next_step text`. API에서 `next_step`은 최대 40자, 앞뒤 공백 제거, 빈 문자열은 null.
- **D-day 표시 규칙:** 기준은 브라우저의 오늘(로컬 날짜).
  - 대상 날짜: 지원 전(`applied_at` 없음)이면 마감일과 다음 일정 중 오늘 이후의 이른 것. 지원 후에는 다음 일정만.
  - 표기: 오늘 `D-day`, 미래 `D-n`, 지난 마감 `Closed`. 다음 일정이 지났으면 칩을 숨긴다.
- **결과가 난 건**(`status`가 합격·불합격)에는 D-day를 보이지 않는다.
- **화면:** 영어, 문구 최소, 팀 토큰. 색만으로 구분하지 않는다(글자 병기). 단계·상태 값은 저장값(한국어) 그대로 보내고 표시만 `label()`로 영어.
- **팀 공용 파일은 바꾸지 않는다.** 바꾸는 프런트 파일은 `frontend/src/features/practice-track/` 아래와 `frontend/e2e/practice-track/`, `frontend/tests/practice-track/`뿐이다.
- **A2 연동:** `supabase-apply.md`의 migration 목록과 표, 통합 시험이 새 파일을 포함한다.

## Review Focus

1. **팀 Supabase에 새 migration을 적용하지 않고 새 앱을 띄운다.** 조용히 500이 나는 대신 시작 검사가 migration 이름을 말하고 멈춰야 한다. → X1 `test_track_schema_requires_schedule_columns`.
2. **자정 근처나 다른 시간대에서 D-day를 본다.** 날짜만 비교하고 시각이나 UTC로 하루가 밀리지 않아야 한다. → X2 단위 시험(로컬 날짜 문자열 비교).
3. **보드에서 카드를 옮기다 실패한다**(서버 오류, 다른 탭에서 바뀜). 카드가 원래 열로 돌아오고 오류가 보여야 한다. → X3 e2e `board move failure restores the card`.
4. **달력 달 경계:** 31일·윤년·월말 이벤트가 맞는 칸에 들어가고 다른 사람의 지원 건은 보이지 않는다. → X4 서버 시험과 단위 시험.
5. **지원 건이 하나도 없다.** 보드·달력·통계가 빈 상태를 깨지지 않게 보인다. → 각 e2e의 빈 상태 시험.

---

### Task 1 (X1): 일정 컬럼, 정렬, 달력·통계 API

**Files:**
- Modify: `backend/app/models.py`(Application), `backend/app/schemas.py`(ApplicationIn·Patch·Out·SyncIn), `backend/app/routers/track.py`, `backend/app/db.py`(`validate_track_schema`), `supabase/schema.sql`(끝에 inclusion), `docs/practice-track/supabase-apply.md`(목록 7개·표)
- Create: `supabase/migrations/20261117_track_schedule.sql`
- Test: `backend/tests/test_track_schedule.py`, `backend/integration/test_postgres.py`(기존 시험이 새 파일을 자동 포함하는지 확인만)

**Interfaces (Produces):**
- `ApplicationOut`에 `deadline: date|None`, `next_step_on: date|None`, `next_step: str|None`. `ApplicationIn`·`ApplicationPatch`도 같은 세 필드(선택). `SyncIn`에 `deadline: date|None = None`. 이미 있는 지원 건에서는 값이 있을 때만 덮는다.
- `GET /track/applications?sort=due`:
  - 오늘(서버 날짜) 이후의 대상 날짜가 있는 건이 앞, 이른 순.
  - 대상 날짜가 같으면 `updated_at` 내림차순, 없으면 뒤.
  - 결과가 난 건은 맨 뒤.
  - 정렬은 파이썬에서 한다(양쪽 DB 같은 결과).
- `GET /track/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`:
  - 응답 `[{date, kind, application_id, company, position, label}]`.
  - `kind`는 `applied`·`deadline`·`next_step`·`result`.
  - `label`: `result`면 `"{단계} {결과}"`(저장값), `next_step`이면 `next_step` 또는 `"Next step"`, 나머지는 빈 문자열.
  - 범위는 양끝 포함, 최대 62일. 넘으면 422, 영어 오류.
  - 날짜·kind·회사 순으로 정렬.
- `/track/stats`에 두 필드를 더한다.
  - `upcoming: [{date, kind, application_id, company, position, label}]`: 오늘부터 14일 안, 결과 난 건 제외.
  - `days_to_first_result: {median: float|None, count: int}`: 지원일이 있고 결과 이벤트(`stage_events`)가 있는 건의 첫 이벤트까지 일수.

- [ ] **Step 1: 실패하는 시험을 쓴다** (`tests/test_track_schedule.py`, 기존 track 시험의 클라이언트·헤더 방식)
  - `test_schedule_fields_round_trip`: 생성 → 상세·목록에 세 필드. PATCH로 바꾸고 null로 비움. `next_step` 41자는 422, `"  "`는 null.
  - `test_sort_due_orders_by_the_nearest_upcoming_date`: 오늘+3 마감(미지원), 오늘+1 다음 일정(지원함), 날짜 없음, 지난 마감, 합격 건 → 순서가 +1, +3, (없음·지난 마감은 updated_at 순), 합격 맨 뒤.
  - `test_calendar_returns_only_mine_within_the_range`: 두 사용자. 범위 밖 제외, 양끝 포함, 결과 이벤트 label `"서류 합격"`. 63일 범위는 422.
  - `test_calendar_month_edges`: 1월 31일 마감, 2월 29일(2028) 다음 일정이 정확한 날짜로 나온다.
  - `test_stats_upcoming_and_days_to_first_result`: 14일 안 2건(1건은 15일 뒤라 제외), 첫 결과까지 3일·5일 → 중앙값 4.0, count 2.
  - `test_sync_saves_deadline`: `/track/sync`에 `deadline` → 새 건과 기존 건 모두 반영. 없으면 기존 값 유지.
  - `test_track_schema_requires_schedule_columns`: 세 컬럼 중 하나가 없는 엔진(SQLite에서 컬럼을 뺀 표)에 `validate_track_schema` → `RuntimeError`에 `20261117_track_schedule.sql`.
- [ ] **Step 2: 실패 확인** Run: `cd backend && .venv/bin/python -m pytest -q tests/test_track_schedule.py` Expected: FAIL
- [ ] **Step 3: 구현** (migration은 `alter table applications add column if not exists …` 세 줄과 맨 위 주석 "Additive. Safe to run again." `schema.sql` 끝에 `-- Full-schema inclusion: 20261117_track_schedule.sql`과 같은 세 줄)
- [ ] **Step 4: 통과 확인** Run: `cd backend && .venv/bin/python -m pytest -q && .venv/bin/python -m pytest -q integration` Expected: 전부 PASS(통합 시험이 새 migration을 포함해 반복 적용·카탈로그 동일을 확인)
- [ ] **Step 5: 커밋** `feat(track): add deadlines and next steps, due-date sorting, calendar and upcoming stats`

### Task 2 (X2): D-day 칩과 일정 편집

**Files:**
- Create: `frontend/src/features/practice-track/components/track/dday.ts`, `components/track/DueChip.tsx`
- Modify: `types.ts`(Application 세 필드, Stats 두 필드, CalendarItem), `api.ts`(`applications`에 `sort`, `calendar(start,end)`), `pages/TrackList.tsx`(D-day 칩, "Sort: Recent / Due soon" 선택), `pages/ApplicationPage.tsx`(Deadline·Next step·Next step date 편집)
- Test: `frontend/tests/practice-track/unit/dday.spec.ts`, `frontend/e2e/practice-track/track-schedule.spec.ts`

**Interfaces:** `dueOf(app: Application, today: string): { date: string; kind: "deadline" | "next_step" } | null`, `ddayText(date: string, today: string): string` (`"D-day"`, `"D-3"`, `"Closed"`), `todayLocal(now?: Date): string` (YYYY-MM-DD, 로컬).

- [ ] **Step 1: 단위 시험** `dday.spec.ts`
  - Global Constraints의 규칙 표 전부(지원 전·후, 결과 난 건, 지난 다음 일정 숨김, 같은 날).
  - `todayLocal(new Date(2026, 0, 1, 0, 5))`는 `"2026-01-01"`(UTC로 밀리지 않음).
- [ ] **Step 2: e2e** `track-schedule.spec.ts`
  - 상세에서 마감일·다음 일정을 넣고 저장 → 목록 칩 `D-n`.
  - "Due soon" 정렬이 순서를 바꾼다.
  - 지운 값은 칩이 없어진다.
- [ ] **Step 3: 실패 확인 → 구현 → 통과** Run: `cd frontend && npm run test:unit && npm run test:e2e -- track-schedule` (e2e는 `PATH=../backend/.venv/bin:$PATH`)
- [ ] **Step 4: 커밋** `feat(track): show D-day chips and edit deadlines and next steps`

### Task 3 (X3): 단계별 보드 `/track/board`

**Files:**
- Create: `pages/TrackBoard.tsx`, `components/track/board.ts`(순수: `groupByStage(apps, showClosed)`, `moveTarget(stage, dir)`)
- Modify: `routes.tsx`(TrackFeature에 `board`, `calendar` 경로), `FeatureBoundary.tsx`(track 메뉴 `Applications · Board · Calendar · Stats`), `styles.css`(보드 스타일, 기능 범위 안)
- Test: `tests/practice-track/unit/board.spec.ts`, `e2e/practice-track/track-board.spec.ts`

**Behavior:**
- 열 5개(단계). 카드: 회사(굵게)·직무·상태 칩·D-day 칩, 카드 제목은 상세 링크.
- **옮기기:**
  - 끌어 놓기(HTML5 drag events).
  - 카드의 `Move to previous stage`·`Move to next stage` 버튼(aria-label, 첫·끝 열에서는 없음).
  - 상태 선택 상자(`Status`).
- **바꾸는 방식:**
  - 먼저 화면을 바꾸고 `PATCH`. 실패하면 원래 자리로 되돌리고 `role=alert`로 서버 문장을 보인다.
  - 같은 카드에 요청이 진행 중이면 버튼을 잠근다.
- 합격·불합격 카드는 기본으로 숨기고 `Show closed (n)` 토글.
- 빈 열에는 "No applications", 전체가 비면 "Add an application first"와 목록 링크.
- 좁은 화면(≤720px)은 열을 세로로 쌓는다.

- [ ] **Step 1: 단위 시험** `board.spec.ts`: 묶기, 닫힌 건 숨김·보임, 첫·끝 열에서 이동 없음.
- [ ] **Step 2: e2e** `track-board.spec.ts`
  - 버튼으로 다음 단계 → 새로고침 뒤에도 그 열.
  - 끌어 놓기(`dragTo`)로 옮김.
  - 상태를 합격으로 → 숨겨짐, 토글로 보임.
  - `board move failure restores the card`: `page.route`로 PATCH 500 → 원래 열, alert.
  - 빈 상태.
  - mobile 프로젝트에서 세로 쌓임(열 순서대로 보임).
- [ ] **Step 3: 실패 확인 → 구현 → 통과**
- [ ] **Step 4: 커밋** `feat(track): add a stage board with drag, buttons and status changes`

### Task 4 (X4): 달력 `/track/calendar`

**Files:**
- Create: `pages/TrackCalendar.tsx`, `components/track/calendar.ts`(순수: `monthGrid(year, month)` → 6주×7일 날짜 문자열, 일요일 시작; `byDate(items)`)
- Test: `tests/practice-track/unit/calendar.spec.ts`, `e2e/practice-track/track-calendar.spec.ts`

**Behavior:**
- 머리글: `‹ Previous`·`Today`·`Next ›`와 "November 2026"(영어 월 이름).
- **칸:** 날짜 숫자와 항목 칩(종류 글자 `Applied`·`Deadline`·`Next`·`Result`와 회사 이름). 칩은 상세 링크.
- 오늘 칸에 테두리와 `aria-current="date"`. 이번 달이 아닌 칸은 흐리게.
- 한 칸에 셋 넘게 있으면 `+n more`가 펼친다.
- 좁은 화면은 항목이 있는 날만 날짜별 목록.
- 서버 `GET /track/calendar`를 그 달 격자의 첫날~끝날로 부른다(최대 42일).

- [ ] **Step 1: 단위 시험** `calendar.spec.ts`
  - 2026년 2월 격자의 첫 칸 `2026-02-01`(일요일)·끝 칸 `2026-03-14`.
  - 2028년 2월에 29일이 있다.
  - 12월에서 다음 달로 넘기면 해가 바뀐다.
  - `byDate`.
- [ ] **Step 2: e2e** `track-calendar.spec.ts`
  - 마감일을 넣은 건이 그 날짜 칸에 보이고, 누르면 상세.
  - Next·Previous·Today.
  - 빈 달.
  - mobile 목록 보기.
- [ ] **Step 3: 실패 확인 → 구현 → 통과**
- [ ] **Step 4: 커밋** `feat(track): add a month calendar of applications, deadlines and results`

### Task 5 (X5): 통계 강화

**Files:**
- Modify: `pages/StatsPage.tsx`, `styles.css`
- Test: `e2e/practice-track/track.spec.ts` 또는 새 `track-stats.spec.ts`

**Behavior** (기존 단계 막대는 유지):
- **Next 14 days:** `upcoming`을 날짜순으로 보이고, 없으면 "Nothing due in the next 14 days".
- **Applications per month:** 최근 12개월 세로 막대(SVG). 막대마다 숫자 글자, 빈 달은 0.
- **Final pass rate by job:** 직무별 가로 막대와 `n/total`.
- **Days to first result:** 중앙값과 건수. 건수 0이면 "–".

- [ ] **Step 1: e2e 시험 쓰기** 지원 건 몇 개와 결과 이벤트를 만든 뒤, 네 부분의 숫자 글자를 확인. 빈 상태(지원 0건)도 확인.
- [ ] **Step 2: 실패 확인 → 구현 → 통과** Run: `cd frontend && npm run test:e2e -- track-stats && npm run build:practice-track`
- [ ] **Step 3: 전체 확인** Run: `cd backend && .venv/bin/python -m pytest -q; cd ../frontend && npm run test:unit && npm run test:e2e && npm run test:auth && npm run build` Expected: 전부 PASS
- [ ] **Step 4: 커밋** `feat(track): chart monthly applications, pass rate by job, upcoming items and time to first result`
