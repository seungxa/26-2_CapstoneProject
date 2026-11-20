# 통합 확장·Apply 페이지·최종 연결·A3 (계획 Y) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동입력 확장과 지원 관리 팝업을 확장 하나(`extension/`)로 합친다. 팝업에 다가오는 일정과 사이버 염주를 넣는다. 웹이 로그인 토큰과 프로필을 확장에 보낸다. Apply 페이지에서 zip을 내려받고 설치 매뉴얼을 본다. 계약 문서(A3)를 쓴다.

**Architecture:**
- **확장:** seungxa 0.7.0 파일을 그대로 가져온다. 바꾸는 파일은 `manifest.json`, `background.js`(진입점·외부 메시지), `panel.js`(검증 함수를 `archive.js`로 옮김)뿐이다. 우리 팝업 파일이 진입점이 된다.
- **웹:** 기능 폴더 안 `integration/extensionBridge.ts`가 `chrome.runtime.sendMessage(EXTENSION_ID, …)`로 보낸다. `pages/ApplyPage.tsx`를 팀 `pages/Apply.tsx`가 보인다.
- **빌드:** `scripts/practice-track/build-extension.mjs`가 manifest와 기본 주소를 채우고, 결정적인 zip을 `frontend/public/downloads/`에 쓴다.

**Tech Stack:** Chrome MV3(service worker, side panel, externally_connectable), plain ES modules, Node 22+ 표준 라이브러리(zlib), React 19, Playwright(unit·e2e), node:test(seungxa 시험).

**Spec:** `docs/practice-track/2026-11-17-final-round-design.md` 3·4·5절(E1~E5, P, A3).

## Global Constraints

- **출처:** seungxa `origin/chrome-extension` 커밋 `e103160`의 `jobseeker-v0.7.0/jobseeker-extension/`. 시험·데모 파일까지 그대로 가져오고, 바꾼 세 파일은 계약 문서에 이유와 함께 적는다.
- **seungxa 자동입력 로직**(matching·planner·widgets·llm·content 등)은 바꾸지 않는다. seungxa 시험(`node --test tests/*.test.js`)이 그대로 통과해야 한다.
- **manifest:**
  - `name` "JobSeeker", `version` "0.8.0"
  - `action.default_popup` "popup.html", `side_panel.default_path` "panel.html", 아이콘은 우리 icons
  - `permissions` = seungxa 6개(`storage`, `activeTab`, `scripting`, `sidePanel`, `tabs`, `webNavigation`)
  - `host_permissions` = seungxa 5개 + `http://localhost:8000/*`, `http://127.0.0.1:8000/*`, `https://team-api.duckdns.org/*`
  - `optional_host_permissions`는 seungxa 그대로, `options_page` "options.html"
  - `externally_connectable.matches` = 개발 웹 `http://localhost:5173/*`, `http://127.0.0.1:5173/*`(빌드 인자로 팀 웹 주소 추가)
  - `key` = 이 작업에서 만든 RSA 공개 키. 고정 ID는 문서와 `VITE_EXTENSION_ID` 기본값에 적는다. 개인 키는 저장소에 넣지 않는다.
- **팝업 문구는 한국어**(지금 팝업과 같음). 웹 Apply 페이지는 영어, 문구 최소.
- **외부 메시지:** `jobseeker:ping` → `{ok:true, version}`, `jobseeker:session` `{token: string|null}`, `jobseeker:archive` `{archive}`.
  - 그 밖의 꼴이나 manifest 목록에 없는 출처는 `{ok:false, error}`로 거절하고 아무것도 저장하지 않는다.
  - 토큰은 길이 4096 이하 문자열.
- **팀 공용 파일:** `frontend/src/pages/Apply.tsx`만 바꾼다(사용자 결정). `lib/supabase.ts`, `lib/archiveFields.ts`는 불러 쓰기만 한다.
- **zip:** 같은 입력이면 같은 바이트(파일 이름 순, 고정 시각 1980-01-01, 권한 0644). 커밋한 zip은 `extension/`에서 다시 빌드한 것과 sha256이 같아야 한다(시험).

## Review Focus

1. **다른 사이트(또는 목록에 없는 웹 주소)가 확장 ID로 메시지를 보낸다.** 토큰·프로필을 저장하지 않아야 한다. → Y3 `bridge.spec`: 출처 거절.
2. **확장이 설치되지 않은 브라우저에서 Apply 페이지나 연습 화면을 연다.** 오류 없이 "Not installed"만 보이고, 다른 화면은 영향이 없어야 한다. → Y5 e2e.
3. **누군가 `extension/`을 고치고 zip을 다시 빌드하지 않는다.** 오래된 zip이 배포되면 안 된다. → Y4 `test_committed_zip_matches_the_source`.
4. **아이콘 → 팝업으로 바뀐 뒤 자동입력을 쓴다.** 팝업의 "이 지원서 채우기"가 사이드 패널을 열고 탭에 연결돼야 한다(seungxa 흐름 유지). → Y1 unit(배경 메시지 처리, chrome 대역).
5. **사이버 염주를 밤 12시 전후에 누른다.** 오늘 수가 날짜가 바뀔 때 0이 되고 전체 수는 그대로여야 한다. → Y2 `beads.spec`.

---

### Task 1: 확장 합치기 `extension/`

**Files:**
- Create: `extension/`(seungxa 파일 전부 + 우리 `api.js`, `extract.js`, `options.*`, `popup.*`, `settings.js`, `icons/`), `extension/archive.js`(`validateArchive`를 panel.js에서 옮김), `extension/README.md`(합친 설명)
- Modify: `extension/manifest.json`(Global Constraints), `extension/background.js`(`connectTab(tab)` 함수로 옮기고 `onMessage`에 `JS_CONNECT_TAB` 처리), `extension/panel.js`(`validateArchive` import), `extension/popup.html`·`popup.js`("이 지원서 채우기" 버튼: `chrome.sidePanel.open({windowId})` 뒤 배경에 `{type:'JS_CONNECT_TAB', tabId}`)
- Delete: `extension-track/`
- Test: `frontend/tests/practice-track/unit/extension.spec.ts`(경로 `extension/`), `frontend/e2e/practice-track/track-extension.spec.ts`(경로), 새 `frontend/tests/practice-track/unit/extension-entry.spec.ts`

- [ ] **Step 1: 실패 시험** `extension-entry.spec.ts`
  - manifest가 Global Constraints 값을 갖는다(권한 합집합, 팝업, 사이드 패널, `key`, `externally_connectable`).
  - `background.js`를 chrome 대역으로 불러 `JS_CONNECT_TAB` 메시지를 보내면 `injectIntoTab`과 같은 연결 경로(대역의 `scripting.executeScript`)가 그 탭으로 불린다. 다른 확장 ID에서 온 메시지는 무시한다.
  - `archive.js`의 `validateArchive`가 panel의 이전 동작과 같다(올바른 아카이브 통과, 배열·긴 값 거절).
- [ ] **Step 2: 실패 확인 → 복사·수정 → 경로 바꾸기**
- [ ] **Step 3: 통과 확인**
  - Run: `cd extension && node --test tests/*.test.js`
  - Run: `cd frontend && npx playwright test -c playwright.unit.config.ts && npx playwright test -c playwright.practice-track.config.ts track-extension`
  - Expected: PASS
- [ ] **Step 4: 커밋** `feat(extension): merge the autofill extension and the Track popup into one extension`

### Task 2: 팝업 개선과 사이버 염주

**Files:**
- Create: `extension/beads.js`(순수), `extension/schedule.js`(순수: `todayLocal`, `ddayText`, `dueOf`. 웹 `dday.ts`와 같은 규칙)
- Modify: `extension/popup.html`·`popup.css`·`popup.js`, `extension/api.js`(`upcoming()` = `applications({sort:'due'})`, `savePosting`에 `deadline`)
- Test: `frontend/tests/practice-track/unit/beads.spec.ts`, `frontend/tests/practice-track/unit/extension-schedule.spec.ts`, `frontend/e2e/practice-track/track-extension.spec.ts`(팝업 DOM 대역에 일정·염주)

**Behavior:**
- **다가오는 일정:**
  - `sort=due` 목록에서 D-day가 0~7인 건을 최대 5건 보인다(`D-n 회사 · 마감/다음 일정 이름`).
  - 0·1일은 "오늘 할 일" 칸에 둔다. 없으면 칸을 숨긴다.
- **공고 저장:** "마감일" 날짜 입력(선택)을 더하고 `deadline`으로 보낸다.
- **사이버 염주:**
  - `<details>` "사이버 염주"(열림 상태 기억), 원형 12알, 가운데 큰 버튼 "한 알 넘기기"(Space·Enter 지원, `aria-live`로 "오늘 N번").
  - 저장 `{date, today, total, open}`은 `chrome.storage.local` 키 `jobseeker.beads.v1`.
  - 108번마다 "오늘도 수고했어요"를 2초 보인다. `prefers-reduced-motion`이면 회전 애니메이션을 끈다.
- **`beads.js`:**
  - `press(state, today) -> {state, bead, lap, milestone}`
  - `load(raw, today)`: 날짜가 다르면 today를 0으로, 값 이상이면 0

- [ ] **Step 1: 실패 시험**
  - `beads.spec`:
    - 12번째 누름에 bead 0·lap 1
    - 108번째 milestone
    - 자정 넘어 load하면 today 0·total 유지
    - 음수·문자열 저장값은 0
  - `extension-schedule.spec`: 웹 `dday.spec`과 같은 표.
  - e2e 팝업:
    - 일정 2건(오늘·5일 뒤) → "오늘 할 일"에 1건, 목록에 2건
    - 염주를 세 번 누르면 "오늘 3번"
    - 팝업을 다시 열면 유지
- [ ] **Step 2: 실패 확인 → 구현 → 통과**
- [ ] **Step 3: 커밋** `feat(extension): show upcoming deadlines in the popup and add the cyber prayer beads`

### Task 3: 웹↔확장 연결

**Files:**
- Create: `extension/bridge.js`(순수: `allowedOrigin(origin, manifest)`, `parseExternal(message) -> {kind, …} | {error}`), `frontend/src/features/practice-track/integration/extensionBridge.ts`
- Modify: `extension/background.js`(`chrome.runtime.onMessageExternal`: 출처 확인 → ping/session/archive 처리), `frontend/src/features/practice-track/integration/host.ts`(로그인·갱신·로그아웃 때 `sendSession`)
- Test: `frontend/tests/practice-track/unit/bridge.spec.ts`, `frontend/tests/practice-track/unit/extension-bridge-web.spec.ts`

**Interfaces:**
- 웹 `extensionBridge.ts`:
  - `EXTENSION_ID`(= `import.meta.env.VITE_EXTENSION_ID ?? 고정 ID`)
  - `pingExtension(): Promise<{installed: boolean; version?: string}>`(1.5초 상한)
  - `sendSession(token: string | null): Promise<boolean>`
  - `sendArchive(archive: unknown): Promise<{ok: boolean; error?: string}>`
  - `chrome.runtime`이 없으면 `installed:false`, `false`.
- 확장 배경:
  - 출처가 manifest `externally_connectable.matches`에 맞을 때만 처리한다.
  - session은 `setAccessToken`, archive는 `validateArchive` 뒤 `archiveRepository.save`. 응답 `{ok:true}` 또는 `{ok:false, error}`.

- [ ] **Step 1: 실패 시험**
  - `bridge.spec`:
    - 허용 출처·포트·경로 패턴
    - 목록 밖 출처 거절
    - 메시지 꼴 검사(토큰 4097자 거절, 알 수 없는 type 거절, archive 객체 아님 거절)
    - 배경 처리기(chrome 대역): 허용 출처의 session이 세션 저장소에 저장되고, 거절 출처는 저장 없음
  - `extension-bridge-web.spec`:
    - `chrome` 없으면 not installed
    - 대역 `sendMessage`가 응답하면 installed·version
    - 응답 없으면 1.5초 뒤 not installed
    - `sendSession`이 정한 메시지 꼴로 보냄
- [ ] **Step 2: 실패 확인 → 구현 → 통과**
- [ ] **Step 3: 커밋** `feat(extension): let the web app hand the sign-in token and profile to the extension`

### Task 4: 빌드 스크립트와 배포 zip

**Files:**
- Create: `scripts/practice-track/build-extension.mjs`, `frontend/public/downloads/jobseeker-extension.zip`, `frontend/public/downloads/extension.json`, `extension/config.js`(기본 주소: 소스는 개발값, 빌드가 바꿔 씀)
- Modify: `extension/settings.js`(DEFAULTS를 `config.js`에서 읽음)
- Test: `frontend/tests/practice-track/unit/extension-build.spec.ts`

**Interfaces:**
- `node scripts/practice-track/build-extension.mjs [--web-origin URL]... [--api-url URL] [--out DIR] [--check]`
- 기본값: `--api-url https://team-api.duckdns.org`, 웹 출처는 개발 두 개.
- **결과물:**
  - zip 안의 manifest에 웹 출처를 더하고, API 출처를 `host_permissions`에 더한다.
  - `config.js`의 `apiUrl`은 인자 값, `webUrl`은 첫 비개발 웹 출처(없으면 개발값).
  - `extension.json`은 `{version, size, sha256, source_commit, web_origins, api_url}`.
- `--check`: 다시 빌드한 zip이 커밋된 것과 같으면 0, 다르면 1과 안내 문장.
- zip 생성: `zlib.deflateRawSync`·`zlib.crc32`로 local header·central directory를 직접 쓴다. 시험·데모·`tests/`·`package.json`·`VERIFICATION.md`는 넣지 않는다(사용자 배포물).

- [ ] **Step 1: 실패 시험** `extension-build.spec.ts`
  - 임시 폴더로 두 번 빌드하면 같은 sha256.
  - zip 안 manifest에 `--web-origin https://team.example.app`이 `externally_connectable`에, `--api-url`이 `host_permissions`에 있다.
  - `tests/`가 없다.
  - `config.js`에 API 주소.
  - `test_committed_zip_matches_the_source`: `--check`가 0.
- [ ] **Step 2: 실패 확인 → 구현 → 빌드해서 커밋할 zip 생성 → 통과**
- [ ] **Step 3: 커밋** `feat(extension): build a reproducible zip for the Apply page`

### Task 5: Apply 페이지

**Files:**
- Create: `frontend/src/features/practice-track/pages/ApplyPage.tsx`, `frontend/src/features/practice-track/pages/ApplyPage.css`(기능 범위 클래스 안)
- Modify: `frontend/src/pages/Apply.tsx`(ApplyPage를 보이는 한 줄)
- Test: `frontend/e2e/practice-track/apply-page.spec.ts`

**Behavior (영어):**
- 제목 `Apply`. 세 카드:
  1. **Install the extension:**
     - `Download (v0.8.0, 123 KB)` 링크(`/downloads/jobseeker-extension.zip`, `download` 속성). 버전·크기는 `extension.json`을 fetch해 쓰고, 없으면 버전 없이.
     - 5단계 목록.
  2. **Connect:**
     - 상태 `Installed v0.8.0` 또는 `Not installed`(ping 결과), `Check again` 버튼.
     - 설치됐으면 로그인 토큰을 바로 보내고, `Send my profile`이 팀 `profiles.archive`(현재 사용자)를 읽어 `sendArchive`. 결과 `Profile sent`나 오류.
  3. **Use it:** 세 줄(공고 페이지에서 아이콘 → Save posting / Fill this application, 지원 관리에서 확인).
- `.practice-track` 범위 클래스로 감싸 팀 CSS와 섞이지 않는다.

- [ ] **Step 1: 실패 시험** `apply-page.spec.ts`
  - 확장 없음: `Not installed`, 내려받기 링크의 href·download.
  - 확장 대역(`addInitScript`로 `window.chrome.runtime.sendMessage`): `Installed v0.8.0`, 로드 때 session 메시지 1회, `Send my profile` → archive 메시지와 `Profile sent`.
  - 대역이 `{ok:false,error:"Not a valid archive."}`면 그 문장을 alert로.
  - mobile 가로 넘침 없음.
  - 내려받기 파일이 실제로 200을 준다.
- [ ] **Step 2: 실패 확인 → 구현 → 통과** (Apply 경로는 팀 ProtectedRoute 안: e2e는 기존 로컬 인증 대역으로 로그인)
- [ ] **Step 3: 커밋** `feat(apply): offer the extension download, install steps and a connect check`

### Task 6: 계약 문서(A3)와 문서 정리

**Files:**
- Create: `docs/practice-track/extension-contract.md`
- Modify: `extension/README.md`, `docs/practice-track/deploy-oracle.md`(7절: 확장 빌드 인자), `docs/practice-track/supabase-apply.md`(6절 다음: Auth URL 설정 한 줄), 설계 문서(구현 링크)

- [ ] **Step 1: 문서 쓰기**(설계 5절 목록 전부, 고정 확장 ID, 빌드 명령, seungxa 확인 목록)
- [ ] **Step 2: 문서의 명령·파일 이름이 실제와 같은지 확인** (`node scripts/practice-track/build-extension.mjs --check`, `ls extension`)
- [ ] **Step 3: 전체 확인**
  - Run: `cd backend && .venv/bin/python -m pytest -q`
  - Run: `cd extension && node --test tests/*.test.js`
  - Run: `cd frontend && npx playwright test -c playwright.unit.config.ts && npx playwright test -c playwright.practice-track.config.ts && npm run test:auth && npm run build`
  - Expected: 전부 PASS
- [ ] **Step 4: 커밋** `docs(extension): add the extension contract (A3) for the merged extension`
