# 영어 화면 · 단순 구성 · 팀 디자인 · OpenAI 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Practice·Track 화면을 팀 셸과 같은 모양·영어로 바꾸고, 문구와 구성을 단순하게 하며, OpenAI 코드를 없앤다.

**Architecture:**
- 컴포넌트 문구를 제자리에서 영어로 바꾼다(i18n 없음).
- 한국어 저장 값은 프런트 `labels.ts` 하나로 영어 이름을 붙인다.
- 기능 CSS 변수를 팀 값으로 바꾼다.
- 백엔드에서 OpenAI 경로를 지우고, 사용자에게 보이는 문장을 영어로 바꾼다.
- 화면 구성은 설계 4.3a 스케치를 따른다.

**Tech Stack:** React 19, react-router 8, TypeScript 6, Vite 8, Playwright(unit·e2e), FastAPI·SQLAlchemy·pytest.

**Spec:** `docs/practice-track/2026-11-14-english-ui-cleanup-design.md`. 이 문서가 포함하는 `2026-11-14-local-ai-gaze-direction-design.md` 4.2절 B1·B2도 함께 본다.

## Global Constraints

**수정 범위**
- 팀 소유 파일은 수정하지 않는다: `frontend/src/App.tsx`, `App.css`, `index.css`, `pages/*`, `lib/*`, `components/ProtectedRoute.tsx`.
- 새 npm·pip 의존성을 추가하지 않는다.
- DB 스키마를 바꾸지 않는다. 저장 값(한국어 enum, 분류 스냅샷)도 그대로 둔다.
- 기능 CSS는 `.practice-track.practice-track` 범위 안에서만 바꾼다.

**언어**
- 화면 글자는 영어다.
- 한국어로 두는 면접 내용:
  - 질문은행·템플릿 질문
  - 기본 점검의 `followup.text`
  - 사용자가 쓴 전사·메모
- 한국어 면접 내용을 보이는 요소에는 `lang="ko"`를 붙인다. 기능 루트는 `lang="en"`이다.
- 개발 전용 `GazeLab`·`GazeDirectionLab`의 고유 문구는 한국어 그대로 둔다. 공용 컴포넌트 문구가 바뀌면 그 테스트와 `docs/practice-track/gaze-direction-protocol.md`의 버튼 이름만 맞춘다.

**디자인 값** (설계 4.1)

| 변수 | 값 |
|---|---|
| `--bg` | `#f8fafc` |
| `--surface` | `#ffffff` |
| `--border` | `#e2e8f0` |
| `--text` | `#0f172a` |
| `--text-2` | `#475569` |
| `--muted` | `#64748b` |
| `--accent` | `#2563eb` |
| `--accent-soft` | `#eff6ff` |
| `--radius` | `12px` |
| `--good-text` · `--warn-text` · `--bad-text` | 흰색과 `#f8fafc` 위에서 모두 4.5:1 이상 |

- 다크 모드 블록을 없앤다.
- 글꼴: `Arial, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`.
- 제목 크기: 페이지 h1 30px/700, 카드 h2 20px/700, h3 16px/700.

**문구 규칙** (설계 4.2)
- 화면은 제목, 주 동작, 안내 1줄 이내로 구성한다. 더 필요한 설명은 `<details>`의 "Details" 안에 둔다.
- 내부 구현 용어를 쓰지 않는다: 모델 이름, 탭 메모리, 서버 구조, 지문, 버전.
- 같은 안내는 한 곳에만 둔다.
- 상태 안내는 문제가 있을 때만, 관련 요소 옆에 둔다.
- 오류 문장은 무엇이 잘못됐고 어떻게 고치는지를 말한다.
- 대소문자: 제목·버튼·탭은 단어마다 첫 글자 대문자, 설명문은 문장 첫 글자만 대문자.
- 점수·합격·자신감 같은 표현은 쓰지 않는다. 판정 한계는 회고에서 한 번만 말한다.

**고정 화면 이름** (테스트와 구현이 같은 글자를 쓴다)

| 위치 | 이름 |
|---|---|
| 기능 메뉴 | Practice: `Start` · `History` · `Settings` / Track: `Applications` · `Stats` |
| Practice 시작 화면 | h1 `Practice`, 버튼 `Start Practice`(선택 수 `(n)` 붙음)·`Mock Interview`·`Add a Question`, `<summary>` `More Options`·`Generate Questions from an Essay`, select 라벨 `Application`, 검색 placeholder `Search questions` |
| 진행 화면 | `Start Answer`·`Start Now`·`Finish Answer`·`Next Question`·`Ask a Follow-up`·`Skip`·`End Practice`·`Retry Saving Recording`·`Retry Transcription`, 입력 방식 radio `Record`·`Type` |
| 녹음 동의 | 진행 화면 카드 제목 `Before You Record`·버튼 `Agree & Start`. Settings 버튼 `Agree`. 체크박스 `Keep original audio for 30 days`, 링크 `Details` |
| 카메라 | 카드 제목 `Camera Feedback`, 버튼 `Turn On Camera`·`Turn Off Camera`, 상태 `Face in view`·`Part of your face is out of view`·`Face not found`·`Waiting for camera…` |
| 회고 | 요약 h2 `Summary`, 버튼 `Practice Weak Answers Again`·`Delete`·`Save`·`Check Answer`·`Delete Recording`·`Retry Transcription`·`Reload Review`, 판정 한계 문장 `Rule-based checks, not a hiring assessment.` |
| Settings | h1 `Settings`, 버튼 `Delete All Recordings` |
| 기록 | h1 `History` |
| Track | h1 `Applications`, 버튼 `Add Application`·`Save`·`Edit`·`Cancel`·`Save Version`·`Save as Submitted`·`Delete Question`·`Practice for This Application`, 상세 h2 `Details`·`Stages`·`Essays` |
| 통계 | h1 `Stats`, h2 `By Stage`·`By Month`·`By Job` |
| 저장 값 → 영어 | 설계 4.4 표 그대로 |

**테스트 실행 환경**
- e2e는 `PATH="$PWD/../backend/.venv/bin:$PATH"`로 실행한다.
- pytest는 `cd backend && .venv/bin/python -m pytest -q`다.

**커밋**
- 영어 Conventional Commits로 쓰고, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 팀 저장소 push는 하지 않는다(브랜치는 로컬에 둔다).

## Review Focus

1. **과거 데이터:** 과거 기록(`method:"ai"` 보고서, 디브리프 요약, `ai_feedback`, 한국어 reason 문장)이 있는 세션 회고가 깨지지 않고 그대로 보여야 한다. → Task 8의 `legacy AI coaching and debrief still render` e2e.
2. **표에 없는 값:** 표에 없는 저장 값(새 직무, 알 수 없는 단계)이 와도 원래 값 그대로 보이고 빈칸이 되지 않아야 한다. → Task 2의 `unknown values fall back to the stored value`.
3. **모바일 폭:** 390px 폭에서 시작 화면 접힌 구역과 회고 접힌 카드가 가로 스크롤 없이 열리고 닫혀야 한다. → Task 6·8의 mobile e2e `no horizontal scroll`.
4. **동의 이후:** 동의를 철회하거나 처음 녹음할 때만 동의 카드가 나와야 한다. 이미 동의한 사람에게 매 질문마다 다시 나오면 안 된다. → Task 7의 `consent card appears once`.
5. **전사 꺼짐:** 전사가 꺼진 서버(`STT_PROVIDER=off`)에서 녹음하면, 녹음 버튼 옆에 무엇이 안 되는지와 대안(Type)이 보여야 한다. 상단 상태 줄은 없다. → Task 7의 `transcription off shows an inline notice`.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| Modify `frontend/src/features/practice-track/styles.css` | 팀 디자인 값, 다크 모드 제거, 바깥 상자 제거, 접힌 구역·요약 스타일 |
| Create `frontend/src/features/practice-track/labels.ts` | 저장 값 → 영어 이름(설계 4.4) |
| Modify `frontend/src/features/practice-track/FeatureBoundary.tsx`, `routes.tsx` | 탭별 메뉴, 상태 줄 제거, `lang="en"` |
| Modify `backend/app/{llm,coaching,debrief,stt,config,main,schemas}.py`, `routers/practice.py` | OpenAI 제거, 영어 사용자 문장 |
| Modify `backend/tests/*` (conftest, OpenAI 경로 테스트) | 가짜 전사 fixture, 외부 호출 0회 |
| Modify pages·components under `frontend/src/features/practice-track/` | 화면별 영어·구성 |
| Modify `frontend/e2e/practice-track/*.spec.ts`, `frontend/tests/practice-track/unit/*.spec.ts` | 새 이름으로 같은 동작 검사 |
| Create `frontend/tests/practice-track/unit/design-tokens.spec.ts`, `labels.spec.ts` | 대비·이름 표 |
| Create `frontend/e2e/practice-track/english-ui.spec.ts` | 화면에 한글 UI 글자가 없는지 |
| Create `docs/practice-track/team-ui-notes.md` | 팀에 줄 제안(이모지 아이콘, 다크 모드, 언어 통일) |

---

### Task 1: 팀 디자인 값과 대비 테스트

**Files:**
- Modify: `frontend/src/features/practice-track/styles.css` (첫 블록 `:root` 변수 ~ 다크 모드 블록, 본문 글꼴, h1~h3, `.card`, 바깥 상자 규칙)
- Test: `frontend/tests/practice-track/unit/design-tokens.spec.ts`

**Interfaces:**
- Produces: CSS 변수 이름은 그대로 두고 값만 바꾼다(다른 작업은 변수만 쓴다). 접힌 구역 공통 클래스 `.fold`(= `<details>` 스타일)를 새로 둔다.

- [ ] **Step 1: 실패하는 테스트**
  - `styles.css`를 읽어 `.practice-track.practice-track { … }` 첫 블록의 변수를 파싱한다.
  - 테스트 `text tokens reach 4.5:1 on surface and page background`:
    - `--text`, `--text-2`, `--muted`, `--accent`, `--good-text`, `--warn-text`, `--bad-text` 각각이 `--surface`와 `--bg` 위에서 ≥ 4.5다.
    - 흰 글씨가 `--accent` 위에서 ≥ 4.5다.
  - 테스트 `uses the team palette and has no dark override`:
    - `--accent === "#2563eb"`, `--surface === "#ffffff"`, `--bg === "#f8fafc"`, `--radius === "12px"`.
    - 파일에 `prefers-color-scheme: dark`가 없다.
- [ ] **Step 2: 실패 확인.**
  - Run: `cd frontend && npx playwright test -c playwright.unit.config.ts tests/practice-track/unit/design-tokens.spec.ts`
  - Expected: FAIL. `--muted` 대비가 3.41이고, accent 값이 다르다.
- [ ] **Step 3: `styles.css` 수정.**
  - Global Constraints의 값과 글꼴·제목 크기를 넣는다.
  - 다크 모드 블록을 삭제한다.
  - 기능 루트 배경을 `transparent`로 하고 바깥 상자의 패딩·모서리·테두리를 없앤다. 내용 최대 폭은 팀 `.main`과 같은 `1000px`이다.
  - `.fold` 스타일을 추가한다: `summary` 커서, 굵기 600, 간격.
- [ ] **Step 4: 통과 확인.**
  - Run: unit 위 명령, 그리고 `npx playwright test -c playwright.unit.config.ts`
  - Expected: 전체 PASS.
- [ ] **Step 5: e2e 회귀 확인.**
  - Run: `PATH="$PWD/../backend/.venv/bin:$PATH" npx playwright test -c playwright.practice-track.config.ts`
  - Expected: 기존과 같은 수 PASS. 글자는 아직 그대로다.
- [ ] **Step 6: Commit** `style(practice-track): adopt team colors, type, and radius with 4.5:1 contrast`

### Task 2: 저장 값 → 영어 이름 표

**Files:**
- Create: `frontend/src/features/practice-track/labels.ts`
- Test: `frontend/tests/practice-track/unit/labels.spec.ts`

**Interfaces:**
- Produces:

```ts
export type LabelKind = "category" | "stage" | "status" | "result" | "verdict" | "criterion" | "job" | "questionType" | "competency";
export function label(kind: LabelKind, stored: string | null | undefined): string; // 표에 없으면 stored 그대로, null·undefined면 ""
```

- [ ] **Step 1: 실패하는 테스트.**
  - `maps every stored value in the design table`: 설계 4.4 표의 모든 쌍을 표 그대로 검사한다(예: `label("stage","1차면접") === "1st Interview"`, `label("verdict","판단유보") === "Not Judged"`, `label("competency","technical_expertise") === "Job Expertise"`).
  - `unknown values fall back to the stored value`: `label("job","보안") === "보안"`, `label("stage", null) === ""`.
- [ ] **Step 2: 실패 확인.** Expected: FAIL. 모듈이 없다.
- [ ] **Step 3: `labels.ts` 구현.** 종류별 `Record<string,string>`과 `label()`.
- [ ] **Step 4: 통과 확인.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(practice-track): map stored Korean values to English labels`

### Task 3: 백엔드 OpenAI 제거

**Files:**
- Modify: `backend/app/llm.py`, `coaching.py`, `debrief.py`, `stt.py`, `config.py`, `main.py`, `routers/practice.py`, `schemas.py`(필요 시), `backend/.env.example`
- Modify tests: `backend/tests/conftest.py`(`STT_PROVIDER` 기본 `off`, OpenAI 환경변수 제거), `test_transcription.py`(가짜 전사 fixture로 이식), `test_classification.py`·`test_debrief.py`(AI 경로 테스트 삭제 또는 기본 점검 기대로 교체)
- Delete: `backend/tests/test_llm_paths.py`. 템플릿 질문 검사는 남겨 옮긴다.
- Create: `backend/tests/test_no_external_calls.py`

**Interfaces:**
- Produces:
  - `llm.template_questions(company, position, essay, count) -> list[dict]`. 기존 `_template_questions`의 공개 이름이다.
  - `llm.verify_quote(...)`는 그대로 둔다.
  - `stt` 제공자는 `local`·`off`만 남는다.
  - `/health` 응답: `{"ok", "stt", "auth_disabled"}`(`openai` 없음).
  - conftest fixture `fake_stt(monkeypatch) -> FakeStt`:
    - `FakeStt.reply: str | Exception`, `FakeStt.calls: list`.
    - `stt._PROVIDERS["local"]`를 바꿔 끼우고 `settings.stt_provider="local"`로 둔다.

- [ ] **Step 1: 실패하는 테스트** (`test_no_external_calls.py`)
  - `httpx.Client.send`, `httpx.post`, `urllib.request.urlopen`을 호출하면 실패하도록 monkeypatch한다.
  - 테스트 `full practice flow makes no external requests`:
    1. 질문 생성(`POST /practice/questions/generate`)
    2. 세션 → 답변 전사문 저장 → `/coach` → `/followup` → `/finish`
    3. 디브리프 작업 완료까지 진행한다.
    4. 외부 호출 0회, 각 단계 2xx, 보고서 `method == "basic"`을 확인한다.
  - 테스트 `openai settings are gone`:
    - `OPENAI_API_KEY`를 설정해도 `/health`에 `openai` 키가 없다.
    - `POST /practice/answers/{id}/feedback`가 404다.
    - 경고 로그에 "OPENAI_API_KEY is ignored"가 있다.
- [ ] **Step 2: 실패 확인.**
  - Run: `cd backend && .venv/bin/python -m pytest -q tests/test_no_external_calls.py`
  - Expected: FAIL. `/health`에 `openai`가 있고, feedback 경로가 존재한다.
- [ ] **Step 3: 구현** (기존 설계 B1).
  - `llm.py`: `_chat`, `_chat_json`, `generate_questions`의 AI 분기, `transcribe`, `feedback`, `debrief_summary`, `available`을 삭제한다.
  - `coaching.build_report`: 항상 `_basic`을 쓰고, `competency_evidence`와 그 설정을 삭제한다.
  - `debrief`: AI 요약 단계를 삭제한다. 기본 점검과 다시 연습 고르기만 남기고, 세션 행의 기존 디브리프 필드는 읽기만 한다.
  - `stt`: `_OpenAI` 삭제.
  - `routers/practice.py`: feedback 경로 삭제. 질문 생성은 항상 템플릿으로 하고 `source="rule"`.
  - `config.py`: `OPENAI_*`를 삭제하고, 환경에 키가 있으면 시작 때 경고 한 번만 남긴다.
  - `.env.example`: OpenAI 줄을 지운다.
- [ ] **Step 4: 기존 테스트 이식.**
  - `test_transcription.py`의 6개 동작(다중 형식, 빈 전사 재시도, mp4 재시도, 수정 보존, 미지원 형식, 느린 전사 비차단)을 `fake_stt`로 그대로 검사한다.
  - AI 전용 테스트는 삭제하되, 같은 파일의 기본 점검·분류·디브리프 기대는 유지한다.
- [ ] **Step 5: 전체 확인.**
  - Run: `cd backend && .venv/bin/python -m pytest -q`
  - Expected: 전체 PASS. 삭제한 AI 전용 테스트 수만큼 줄어든다. 줄어든 테스트 이름은 커밋 메시지 본문에 적는다.
- [ ] **Step 6: Commit** `refactor(backend): remove OpenAI paths and keep rule-based coaching only`

### Task 4: 백엔드 사용자 문장 영어화

**Files:**
- Modify: `backend/app/auth.py`, `routers/*.py`, `services/*.py`(사용자에게 가는 `HTTPException` detail 51개), `coaching.py`(`_basic`의 summary·reason·next_action, `RUBRIC.note`, `CRITERIA` 표시 문구), `debrief.py`(사용자에게 보이는 상태 문장)
- Test: `backend/tests/test_english_messages.py`, 그리고 한국어 detail을 비교하던 기존 테스트

**Interfaces:**
- Produces:
  - 기본 점검 `followup.text`는 한국어 그대로 둔다(면접 내용).
  - `next_action`은 영어다. 예: "Explain why you chose that approach and how you checked the result."
  - 템플릿 질문은 한국어 그대로다.

- [ ] **Step 1: 실패하는 테스트.**
  - `api errors are English`: 대표 오류 6개(401 토큰 없음, 422 전사문 없음, 409 꼬리질문 중복, 404 없는 답변, 413 큰 파일, 동의 필요)의 detail에 한글이 없고 비어 있지 않다.
  - `basic coaching guidance is English but the follow-up stays Korean`: `summary`·`next_action`·각 `reason`에 한글이 없고, `followup.text`에는 한글이 있다.
  - `no Korean in user-facing backend strings`: `app/` 아래 `HTTPException(` 줄과 `_basic` 반환 문자열에 한글이 없다. 템플릿 질문 상수와 `followup.text` 조립은 허용 목록이다.
- [ ] **Step 2: 실패 확인.** Expected: FAIL.
- [ ] **Step 3: 문장 교체.** 설계 4.2 규칙 5번(무엇이 잘못됐고 어떻게 고치는지)을 따른다. `followup.text`의 한국어 조립에는 기존 한국어 `detail`을 쓰고, `next_action`에는 같은 뜻의 영어 문장을 따로 둔다.
- [ ] **Step 4: 기존 테스트의 한국어 detail 비교를 새 영어 문장으로 바꾼다.** 동작 비교는 그대로 둔다.
- [ ] **Step 5: 전체 확인.**
  - Run: `cd backend && .venv/bin/python -m pytest -q`
  - Expected: PASS.
- [ ] **Step 6: Commit** `feat(backend): return English errors and guidance while keeping Korean interview content`

### Task 5: 공통 틀, Settings, 동의, 카메라

**Files:**
- Modify: `FeatureBoundary.tsx`, `routes.tsx`(`PracticeFeature`는 `section="practice"`, `TrackFeature`는 `section="track"`), `sttText.ts`(상태 줄 함수 `serviceNotice` 삭제, 진행 화면용 `transcriptionNotice(stt): string | null`), `types.ts`(`Health`에서 `openai` 제거), `api.ts`(`feedback` 제거), `pages/PracticeSettings.tsx`, `components/ConsentPanel.tsx`, `components/CameraPanel.tsx`, `components/CameraDiagnostics.tsx`(개발 플래그일 때만 렌더)
- Modify tests: `e2e/practice-track/team-shell.spec.ts`, `recorder.spec.ts`, `camera.spec.ts`, `camera-lifecycle.spec.ts`, `gaze-lab.spec.ts`, `gaze-direction.spec.ts`, unit `api-client.spec.ts` 등 해당 문구를 쓰는 것
- Modify: `docs/practice-track/gaze-direction-protocol.md`(버튼 이름)

**Interfaces:**
- Consumes: Task 1 변수, Task 2 `label()`.
- Produces:
  - `FeatureBoundary({section, children}: {section: "practice" | "track"; children: ReactNode})`
  - `ConsentPanel` props는 유지한다. 문구는 3줄 + `Details` 링크(`/practice/settings`)다.
  - `CameraPanel` props는 유지한다. 카드 제목 `Camera Feedback`, 한 줄 설명 "Optional. Video stays on this device.", 상세는 `<details>`에 둔다.

- [ ] **Step 1: 실패하는 e2e.**
  - `team-shell.spec.ts`에 `practice tab shows only practice links`를 추가한다.
    - `/practice`에서 기능 메뉴 링크가 정확히 `Start`·`History`·`Settings`다.
    - `/track`에서는 `Applications`·`Stats`다.
    - 상단 상태 줄(전사·코칭 안내)이 없다.
  - `recorder.spec.ts`·`camera*.spec.ts`·`gaze-*.spec.ts`의 한국어 이름을 고정 화면 이름으로 바꾼다.
- [ ] **Step 2: 실패 확인.**
  - Run: `PATH=… npx playwright test -c playwright.practice-track.config.ts e2e/practice-track/team-shell.spec.ts e2e/practice-track/recorder.spec.ts e2e/practice-track/camera.spec.ts e2e/practice-track/camera-lifecycle.spec.ts`
  - Expected: FAIL. 이름이 없고 메뉴가 다르다.
- [ ] **Step 3: 구현.**
  - Settings 구성: 설계 4.3a 스케치대로 Recordings(보관 토글, `Delete All Recordings`)와 Privacy 2줄로 둔다. 동의 전에는 `Agree`를 둔다.
  - 동의 카드 구성: 무엇을 녹음하는지, 우리 서버에서 전사, 전사 후 삭제(보관 시 30일), `Keep original audio for 30 days`, `Details`.
  - OpenAI 문단, "연습 전용" 반복, "무엇을 어디로 보내나요" 목록을 삭제한다.
- [ ] **Step 4: 통과 확인.** 위 e2e와 `gaze-lab`·`gaze-direction`이 PASS다. unit 전체가 PASS다.
- [ ] **Step 5: Commit** `feat(practice-track): per-tab menus, short consent, and English settings and camera panel`

### Task 6: Practice 시작 화면 단순화

**Files:**
- Modify: `pages/PracticeHome.tsx`, `components/ClassificationControls.tsx`, `components/InterviewContext.tsx`, `practice/*.ts`(사용자 문구가 있으면)
- Modify tests: `e2e/practice-track/practice-question-selection.spec.ts`, `practice-usability.spec.ts`, `classification.spec.ts`, unit `practice-questions.spec.ts`

**Interfaces:**
- Consumes: `label("category"|"job"|"questionType"|"competency", …)`.
- Produces: 화면 구성은 설계 4.3a의 Start 스케치를 따른다.
  - 맨 위는 Questions 카드다: 검색, 분류 select, 질문 목록, `Add a Question`.
  - 그 아래 `Application` select, 버튼 줄 `Start Practice (n)`·`Mock Interview`.
  - 접힌 `More Options`에 넣는 것: 모의시험 질문 수·준비·답변 시간·분류·직무, 채용 공고, 자소서 기준, 꼬리질문 사용, 질문 유형·역량 필터.
  - 접힌 `Generate Questions from an Essay`에는 기존 맞춤 질문 생성을 넣는다.
  - 질문 행의 분류 편집·삭제는 행 끝의 작은 버튼 두 개로 둔다(`Edit Tags`·`Delete`).

- [ ] **Step 1: 실패하는 e2e.**
  - 기존 3개 파일의 동작(선택 → 자유 연습, 모의시험, 분류 필터, 직접 추가, 지원 건 연결)을 새 이름으로 바꾼다. 접힌 구역은 `getByText("More Options").click()`으로 연다.
  - 새 테스트 `start screen leads with questions and one primary action`:
    - `Start Practice`가 Questions 카드 바로 아래에 있다.
    - 처음에는 `More Options`가 닫혀 있다.
    - 화면의 primary 버튼이 1개다.
  - 새 mobile 테스트 `no horizontal scroll`: 390px에서 `More Options`를 열고 `document.documentElement.scrollWidth <= innerWidth`를 확인한다.
- [ ] **Step 2: 실패 확인.** Expected: FAIL.
- [ ] **Step 3: 구현.** 기존 상태·API 호출은 유지하고 배치와 문구만 바꾼다. 반복 안내 문단은 삭제한다.
- [ ] **Step 4: 통과 확인.** 해당 e2e(desktop·mobile)와 unit이 PASS다.
- [ ] **Step 5: Commit** `feat(practice-track): simpler English start screen with folded options`

### Task 7: 면접 진행 화면 단순화

**Files:**
- Modify: `pages/SessionRunner.tsx`, `components/ConsentPanel.tsx`(카드 배치), `components/CameraPanel.tsx`(토글 배치), `components/useRecorder.ts`(사용자 오류 문장)
- Modify tests: `e2e/practice-track/recorder.spec.ts`, `camera.spec.ts`, `coaching.spec.ts`(진행 부분), `track-practice-flow.spec.ts`(진행 부분)

**Interfaces:**
- Consumes: `transcriptionNotice(stt)`(Task 5).
- Produces: 화면 구성은 설계 4.3a의 진행 스케치를 따른다.
  - 머리글은 `Question n of N` + `End Practice`다.
  - 그 아래 질문(`lang="ko"`), 타이머, 주 버튼 하나(`Start Answer` → `Finish Answer`).
  - 그 아래 `Record`·`Type` 전환과 카메라 토글.
  - 동의가 필요할 때만 `Before You Record` 카드가 주 버튼 아래에 나온다.
  - 답한 뒤에는 전사문 편집, `Next Question`(primary), `Ask a Follow-up`이 나온다.
  - "기준 자료" 카드는 삭제하고, 연결된 지원 건이 있으면 머리글 아래 한 줄로 회사·직무만 보인다.

- [ ] **Step 1: 실패하는 e2e.**
  - `consent card appears once`: 동의 전에는 첫 질문에서 카드가 보이고, `Agree & Start` 뒤 두 번째 질문에서는 보이지 않는다.
  - `transcription off shows an inline notice`: `STT_PROVIDER=off` 서버(기본 e2e 설정)에서 녹음 화면의 주 버튼 근처에 `transcriptionNotice` 문장과 `Type` 안내가 보이고, 페이지 상단 상태 줄은 없다.
  - 기존 녹음·카메라·꼬리질문 동작 테스트를 새 이름으로 바꾼다.
- [ ] **Step 2: 실패 확인.** Expected: FAIL.
- [ ] **Step 3: 구현.** 상태 기계(phase)와 API 호출은 유지하고 배치와 문구만 바꾼다.
- [ ] **Step 4: 통과 확인.** 해당 e2e(desktop·mobile)가 PASS다.
- [ ] **Step 5: Commit** `feat(practice-track): focused English interview runner with one-time consent`

### Task 8: 회고 화면 단순화

**Files:**
- Modify: `pages/SessionReview.tsx`, `components/ReviewInsights.tsx`, `IntegratedCoaching.tsx`, `CoachingPanel.tsx`, `VideoReportCard.tsx`, `VoiceReportCard.tsx`, `review/insights.ts`, `review/coaching.ts`, `delivery/*.ts`(사용자 문구)
- Modify tests: `e2e/practice-track/coaching.spec.ts`, `practice-review-fixes.spec.ts`, `review-insights.spec.ts`, `review-insights-recorded.spec.ts`, unit `review-insights-math.spec.ts`, `integrated-coaching.spec.ts`, `delivery-voice.spec.ts`, `delivery-video.spec.ts`

**Interfaces:**
- Consumes: `label("verdict"|"criterion"|"category", …)`.
- Produces: 화면 구성은 설계 4.3a의 회고 스케치를 따른다.
  - 머리글은 `Practice · <날짜>` + `Delete`다.
  - `Summary` 카드 하나에 다음을 담는다:
    - 답변 수, 보완 필요 수, 자기평가 평균
    - 다음에 할 일 1줄(기존 R1 보완점과 통합 코칭의 첫 항목)
    - `Practice Weak Answers Again`
    - 판정 한계 1줄
    - 과거 AI 디브리프가 있으면 그 교훈 1줄(읽기 전용)
  - 답변 카드는 `<details>`로 접혀 있다. 요약 줄은 `Qn 질문(lang=ko) · 판정 · ★`이다.
  - 펼친 답변 카드에는 Transcript, Checks(기준 3개; 모두 Not Judged면 "Not judged: add …" 한 줄), Delivery(말하기·카메라 수치), Self Rating & Note, `Save`, `Check Answer`가 있다.
  - Video·Voice 카드는 답변별 Delivery 안으로 옮긴다.
  - 회고의 "검증 조건" select와 진단은 `CAMERA_DEBUG`일 때만 보인다.

- [ ] **Step 1: 실패하는 e2e.**
  - `review leads with one summary`: 요약 카드가 1개이고 `Practice Weak Answers Again`이 그 안에 있다. 처음에는 답변 카드가 접혀 있다. 판정 한계 문장이 페이지에 정확히 1번 나온다.
  - `legacy AI coaching and debrief still render`:
    - API로 세션을 만든 뒤 DB에 `method:"ai"` 보고서·디브리프 요약·`ai_feedback`·한국어 reason을 직접 넣는다(기존 `practice-review-fixes` 방식).
    - 회고에서 교훈 1줄과 판정 이름(`label`)이 보이고, 원문 reason이 그대로 보이며, 오류가 없다.
  - mobile `no horizontal scroll`: 답변 카드를 펼친 상태에서 확인한다.
  - 기존 회고 동작 테스트를 새 이름으로 바꾼다.
- [ ] **Step 2: 실패 확인.** Expected: FAIL.
- [ ] **Step 3: 구현.** `insights.ts`의 규칙 문장을 영어로 바꾼다. 수치 규칙과 기준값은 그대로 둔다.
- [ ] **Step 4: 통과 확인.** 해당 e2e와 unit이 PASS다.
- [ ] **Step 5: Commit** `feat(practice-track): one-summary English review with folded answer cards`

### Task 9: 기록과 Track 화면

**Files:**
- Modify: `pages/SessionList.tsx`, `pages/TrackList.tsx`, `pages/ApplicationPage.tsx`, `pages/StatsPage.tsx`, `components/track/*.tsx`, `track/*.ts`(사용자 문구가 있으면)
- Modify tests: `e2e/practice-track/track.spec.ts`, `track-practice-flow.spec.ts`, `track-accessibility.spec.ts`, `track-extension.spec.ts`, unit `track-state.spec.ts`, `stats.spec.ts`

**Interfaces:**
- Consumes: `label("stage"|"status"|"result"|"job", …)`.
- Produces: 화면 구성은 설계 4.3a의 Track 스케치를 따른다.
  - 목록: 검색, 상태 select, 접힌 `Filters`(단계·직무), 표.
  - 상세: 머리글 1줄(회사·직무·단계·상태), `Details`·`Stages`·`Essays` 구역, `Practice for This Application`.
  - 통계: 제목 3개(`By Stage`·`By Month`·`By Job`)와 표 보기 토글.

- [ ] **Step 1: 실패하는 e2e.** 기존 Track 동작 테스트를 새 이름과 영어 저장값 이름으로 바꾼다. 예: 상태 칩 "In Progress", select 값은 저장 값이고 보이는 글자는 영어.
- [ ] **Step 2: 실패 확인.** Expected: FAIL.
- [ ] **Step 3: 구현.** select의 `value`는 한국어 저장 값 그대로 두고, 보이는 글자만 `label()`로 바꾼다(확장 sync 계약 유지).
- [ ] **Step 4: 통과 확인.** Track e2e·unit이 PASS다.
- [ ] **Step 5: Commit** `feat(track): English applications, detail, and stats screens`

### Task 10: 남은 한국어 검사, 팀 메모, 최종 확인

**Files:**
- Create: `frontend/e2e/practice-track/english-ui.spec.ts`, `docs/practice-track/team-ui-notes.md`
- Modify: 검사에서 걸린 파일

**Interfaces:**
- Consumes: 모든 이전 작업.

- [ ] **Step 1: 실패할 수 있는 검사 작성.** `english-ui.spec.ts`:
  - 대상 경로: `/practice`, `/practice/history`, `/practice/settings`, 진행 화면, 회고, `/track`, `/track/<id>`, `/track/stats`. 데이터는 API로 만든다.
  - 각 경로에서 `document.body.innerText`를 읽는다. 단, `[lang="ko"]` 요소와 사용자가 입력한 값(`input`, `textarea`)은 제외한다.
  - 그 결과에 한글(`/[가-힣]/`)이 없어야 한다.
  - 시선 실험실 경로는 제외한다.
- [ ] **Step 2: 실행.**
  - Run: `PATH=… npx playwright test -c playwright.practice-track.config.ts e2e/practice-track/english-ui.spec.ts`
  - Expected: 걸린 문구가 있으면 그 파일을 고치고 다시 실행해 PASS를 확인한다. 고친 위치는 커밋 본문에 적는다.
- [ ] **Step 3: 팀 메모 `team-ui-notes.md`.** 짧게 세 가지를 적는다.
  - 대시보드 이모지가 일부 환경에서 □로 보인다(SVG 아이콘 제안).
  - 다크 모드는 셸과 함께 도입하자.
  - 프로필 화면의 한국어 문구를 영어로 통일하자.
- [ ] **Step 4: 전체 확인.**
  - Run: `cd backend && .venv/bin/python -m pytest -q`
  - Run: `cd frontend && npx playwright test -c playwright.unit.config.ts && PATH=… npx playwright test -c playwright.practice-track.config.ts && npm run build && PATH=… npm run test:auth`
  - Expected: 모두 PASS(mobile의 의도된 skip 제외).
- [ ] **Step 5: 스크린샷.**
  - 로컬 pilot에 가짜 데이터를 넣고 화면 8장을 찍는다: 로그인, 대시보드, 프로필, Practice 시작, 진행, 회고, Settings, Track.
  - 저장 위치는 저장소 밖 임시 폴더다. 사용자 확인용이고 커밋하지 않는다.
- [ ] **Step 6: Commit** `test(practice-track): guard against Korean UI text and add team UI notes`
