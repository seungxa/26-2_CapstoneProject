# 마지막 묶음 설계: Track 디벨롭, 확장 통합·배포, 최종 연결, 시선 방향 화면

팀이 정한 마지막 할 일과 남은 계획(A3, C2~C4)을 한 번에 끝내기 위한 설계다. 사용자 결정(2026-11-17)을 따른다.

- **확장:** 두 확장(seungxa 자동입력 0.7.0 + 우리 지원 관리 팝업)을 **하나로 합쳐** Apply 페이지에서 배포한다. seungxa 코드 수정은 사용자가 허락했고, seungxa의 확인은 계약 문서로 받는다.
- **Track:** 칸반 보드, 달력, 통계 강화, 마감일·D-day를 모두 만든다.
- **사이버 염주:** 확장 팝업 안의 장난감(누를 때마다 구슬이 넘어가는 카운터).
- **팝업:** 확장 팝업을 개선한다(다가오는 일정, 오늘 할 일).
- **A3:** 확장 계약 문서를 쓴다.
- **시선 방향:** 연습 화면과 회고에 넣되, 실측 전까지 기능 플래그를 끈다(설계 C5의 통과 조건).

## 1. 범위와 하지 않는 것

**하는 것**
- **T. Track:** 일정 필드(마감일·다음 일정)와 D-day, 단계별 보드, 달력, 통계 강화.
- **E. 통합 확장:** 하나의 확장 폴더 `extension/`, 팝업 개선, 사이버 염주, 웹↔확장 연결(로그인·프로필), zip 빌드.
- **P. Apply 페이지:** 확장 내려받기, 설치 매뉴얼, 연결 상태와 "프로필 보내기".
- **A3. 계약 문서:** 통합 확장의 구조, 메시지, API, seungxa 확인 목록.
- **G. 시선 방향(C2~C4):** 기준 잡기 단계, 답변별 방향 요약, 회고 카드. 플래그 `VITE_GAZE_DIRECTION` 기본 꺼짐.

**하지 않는 것**
- 크롬 웹 스토어 등록(심사·계정 필요). 배포는 zip과 "압축해제된 확장 프로그램 로드"다.
- seungxa 자동입력 로직(매칭·위젯·AI 판단 계층)의 동작 변경. 합치기에 필요한 진입점과 메시지 처리만 바꾼다.
- 팀 공용 파일 수정. 예외로 Apply 페이지 자리표시(`frontend/src/pages/Apply.tsx`, 4줄)만 우리 컴포넌트를 보이게 바꾼다(사용자 결정). 팀 `lib/supabase.ts`, `lib/archiveFields.ts`는 불러 쓰기만 한다.
- 외부 유료 API. 새 기능은 서버나 브라우저 안에서만 돈다.

## 2. T. Track 디벨롭

### T1. 일정 필드와 D-day
- `applications`에 nullable 컬럼 세 개를 더한다.
  - `deadline date`: 공고 마감일
  - `next_step_on date`: 다음 일정 날짜(인적성·면접 등)
  - `next_step text`: 다음 일정 이름(최대 40자)
- **DB 변경:**
  - Supabase migration `supabase/migrations/20261117_track_schedule.sql`(`add column if not exists`, 다시 실행해도 안전).
  - `schema.sql` 끝에 같은 문장을 "Full-schema inclusion"으로 붙인다(새 DB와 업그레이드 DB의 카탈로그가 같아야 한다는 기존 시험).
  - SQLite 업그레이드(`upgrade_sqlite`)에 컬럼 추가.
  - 앱 시작 검사(`validate_track_schema`)가 세 컬럼을 요구한다. 없으면 이 migration 이름을 말하고 시작하지 않는다. ORM이 모든 컬럼을 읽으므로, 없을 때 조용히 깨지는 것보다 낫다.
- **API:**
  - 생성·수정·목록·상세에 세 필드를 더한다.
  - 목록에 `sort=due` 정렬: 다가오는 날짜(오늘 이후의 마감일·다음 일정 중 이른 것)가 가까운 순, 없으면 뒤.
  - `/track/sync`는 선택 필드 `deadline`을 받는다(확장 팝업에서 저장).
- **화면:**
  - 목록과 상세에 D-day 칩(`D-3`, `D-day`, `Closed`)을 보인다. 날짜는 사용자 브라우저의 오늘 기준.
  - 상세에서 세 필드를 고친다.

### T2. 단계별 보드 `/track/board`
- 열은 단계 5개(서류·인적성·1차면접·2차면접·최종). 카드는 회사·직무·상태 칩·D-day.
- **옮기기:**
  - 마우스는 끌어 놓기.
  - 키보드와 터치는 카드의 "← / →" 버튼(단계 한 칸씩).
  - 상태는 카드 메뉴에서 바꾼다(진행중·합격·불합격·보류).
  - 바꾸면 기존 `PATCH /track/applications/{id}`(수동 변경 기록 `track_state.manual`)를 쓴다.
- 기본으로 결과가 난 건(합격·불합격)은 접어 두고 "Show closed"로 펼친다.
- 좁은 화면에서는 열을 세로로 쌓는다.

### T3. 달력 `/track/calendar`
- 월 달력(일요일 시작). 표시 항목: 지원일, 마감일, 다음 일정, 단계 결과(기존 `stage_events`).
- 항목을 누르면 그 지원 건 상세로 간다. 이전·다음 달, 오늘로 이동.
- 좁은 화면에서는 날짜별 목록으로 보인다.
- 서버 변경 없이 목록 API와 상세의 이벤트를 쓴다. 목록 응답에 이벤트 날짜가 없으면, 목록 응답에 `events` 요약(날짜·단계·결과)을 더한다.

### T4. 통계 강화
- 기존 `/track/stats`에 두 가지를 더한다.
  - `upcoming`: 앞으로 14일 안의 마감일·다음 일정 수와 목록
  - `days_to_first_result`: 지원일에서 첫 결과 이벤트까지 걸린 날의 중앙값과 건수
- **화면:** 라이브러리 없이 SVG·CSS 막대로 그린다.
  - 단계별 도달·통과 막대
  - 최근 12개월 지원 수 막대
  - 직무별 최종 합격률
  - 다가오는 14일 목록
  - 첫 결과까지 걸린 날
- 색은 팀 토큰, 숫자는 막대 옆에 글자로도 보인다(색만으로 구분하지 않음).
- **Track 메뉴:** Applications · Board · Calendar · Stats.

## 3. E. 통합 확장 `extension/`

### E1. 합치기
- **출처:** seungxa `chrome-extension` 브랜치의 `jobseeker-v0.7.0/jobseeker-extension/`(커밋 `e103160`)와 우리 `extension-track/`.
  - `extension/`에 합친다. `extension-track/`은 지우고 시험 경로를 옮긴다.
  - seungxa 파일은 그대로 복사하고, 바꾸는 파일(`manifest.json`, `background.js`)만 계약 문서에 적는다.
- **manifest 0.8.0:**
  - `action.default_popup = popup.html`
  - `side_panel.default_path = panel.html`
  - 권한은 두 확장의 합집합
  - `host_permissions`에 API 주소: 개발 `localhost:8000`·`127.0.0.1:8000`, 배포 `https://team-api.duckdns.org`
  - `externally_connectable.matches`: 팀 웹 주소
  - `key`로 고정 ID
- **진입점:**
  - 아이콘을 누르면 팝업이 뜬다.
  - 팝업의 "Fill this application(이 지원서 채우기)" 버튼이 사이드 패널을 열고(사용자 클릭이라 `sidePanel.open` 가능), 배경에 탭 연결을 요청한다.
  - 배경은 seungxa의 `action.onClicked` 본문을 `connectTab(tab)` 함수로 옮겨 그대로 쓴다. 팝업이 뜨면 `activeTab` 권한이 그 탭에 주어진다.

### E2. 팝업 개선
- **다가오는 일정:**
  - 저장한 지원 건 중 앞으로 7일 안의 마감일·다음 일정을 D-day 순으로 최대 5건 보인다.
  - 오늘·내일 건은 "오늘 할 일"로 위에 둔다.
  - 서버 `sort=due` 목록을 쓴다.
- **공고 저장:** 마감일 입력칸을 더한다(선택).
- 문구는 지금 팝업처럼 한국어로 둔다. 확장 팝업과 사이드 패널은 웹 앱의 영어 화면 규칙 밖이다.

### E3. 사이버 염주 (팝업 속 장난감)
- 구슬 12알이 원으로 놓인다. 누를 때마다(클릭·Space·Enter) 다음 구슬이 밝아진다. 12알을 돌면 한 바퀴가 늘어난다.
- "오늘 N번 · 모두 M번"을 보인다. `chrome.storage.local`에 날짜·오늘·전체를 저장하고, 날짜가 바뀌면 오늘 수를 0으로 한다.
- 108번째에 짧은 문구 하나("오늘도 수고했어요")를 잠깐 보인다.
- 소리는 없다. `prefers-reduced-motion`이면 움직임을 줄인다.
- 팝업 아래 접히는 칸에 둔다(기본 펼침 상태는 마지막 선택을 기억).
- 계산은 순수 함수(`beads.js`)로 나눠 시험한다.

### E4. 웹↔확장 연결
- **메시지:** 웹(팀 웹 주소)에서 확장 ID로 `chrome.runtime.sendMessage`를 보낸다.
  - `{type: "jobseeker:ping"}` → `{ok, version}`
  - `{type: "jobseeker:session", token}` → 확장이 액세스 토큰을 저장한다. `token: null`이면 지운다(로그아웃).
  - `{type: "jobseeker:archive", archive}` → 확장의 프로필 아카이브 검증 함수로 확인한 뒤 저장한다. 자동입력에 쓰인다.
- **확인:** 확장은 `sender.origin`이 manifest의 `externally_connectable` 목록에 있을 때만 받는다. 메시지 꼴은 순수 함수(`bridge.js`)로 검사한다.
- **웹 쪽(우리 기능 폴더):**
  - 로그인·토큰 갱신·로그아웃 때 세션을 자동으로 보낸다(호스트 세션 구독).
  - Apply 페이지의 "Send profile"은 팀 `profiles.archive`를 읽어 보낸다(읽기만).
  - 확장이 없으면 조용히 아무것도 하지 않는다.
- **확장 ID:**
  - manifest `key`로 고정한다(공개 키만 저장소에 둔다).
  - 웹은 `VITE_EXTENSION_ID`(기본값은 그 고정 ID)를 쓴다.

### E5. 빌드와 배포 파일
- `scripts/practice-track/build-extension.mjs [--web-origin <url>]... [--api-url <url>]`
  - `extension/`을 읽어 manifest의 `externally_connectable`과 `host_permissions`를 채운다.
  - 결과물은 `frontend/public/downloads/jobseeker-extension.zip`과 `extension.json`(버전·크기·sha256·출처 커밋)이다.
- zip은 Node 표준 라이브러리로 만든다(외부 도구 없음). 같은 입력이면 같은 바이트가 나온다(파일 순서·시각 고정).
- **기본 출처:**
  - 개발 웹 주소 `http://localhost:5173`·`http://127.0.0.1:5173`
  - 팀 웹 주소는 아직 모르므로 빌드 인자로 받는다. 정해지면 다시 빌드한다.
- 커밋한 zip이 `extension/`과 어긋나면 시험이 실패한다(오래된 zip 배포 방지).

## 4. P. Apply 페이지
- 화면은 영어(웹 앱 규칙), 문구는 최소로. 팀 디자인 토큰을 쓴다.
- **세 카드:**
  1. **Install:** 내려받기 버튼(버전·크기)과 설치 5단계.
     1. 압축 풀기
     2. `chrome://extensions`
     3. 개발자 모드
     4. "Load unpacked"로 폴더 선택
     5. 툴바에 고정
  2. **Connect:** 확장 감지 상태(ping)와 "Send profile"(프로필을 자동입력에 보냄). 로그인은 자동으로 이어진다.
  3. **Use:** 채용 공고에서 아이콘 → "Save posting" / "Fill this application". 문제 해결 세 줄.
- 구현은 `frontend/src/features/practice-track/pages/ApplyPage.tsx`에 둔다. `pages/Apply.tsx`는 이 컴포넌트를 보이는 한 줄로 바꾼다.

## 5. A3. 계약 문서 `docs/practice-track/extension-contract.md`
- 통합 확장 구조(팝업·사이드 패널·배경·내용 스크립트)와 파일 출처
- seungxa 파일 중 바꾼 곳(diff 요약)과 이유
- 웹↔확장 메시지(E4)와 확인 규칙
- 확장이 쓰는 API:
  - `/track/sync` 본문(`submitted` 명시, `essays`, `deadline`)
  - `/track/applications?sort=due`
  - 인증 헤더
- **seungxa 확인 목록:**
  - 진입점 변경(아이콘 → 팝업 → 채우기)
  - 지원서 제출을 감지했을 때 `/track/sync`를 부르는 자리(선택, 사용자 승인 후)
  - AI 판단 계층 기본 꺼짐 유지
- 빌드·배포·업데이트 절차와 팀 웹 주소가 정해졌을 때 할 일

## 6. G. 시선 방향 화면 (C2~C4)
- **플래그:** `VITE_GAZE_DIRECTION=true`일 때만 보인다. 기본은 꺼짐이고, 사용자 실측(3회 중 2회 통과) 뒤에 켠다.
- **C2 기준 잡기:**
  - 연습 화면에서 카메라가 켜져 있고 첫 답변 전이면, "Calibrate gaze (10 s)" 단계를 보인다. 실험실과 같은 `useDirectionCalibration`·점 오버레이를 쓴다.
  - 실패하면 다시 하기·건너뛰기. 건너뛰면 그 세션은 방향을 재지 않는다.
  - 창 크기·해상도가 바뀌면 기준을 버린다.
- **C3 답변별 요약:**
  - 답변 구간 동안 프레임마다 `classifyDirection`, 0.75초 평활.
  - 요약 내용: 방향별 시간·비율, 판정 못 함과 사유, 방향 바뀐 횟수, 가장 긴 '아래' 구간.
  - 탭 메모리에만 두고 서버로 보내지 않는다(기존 영상 요약과 같은 보관).
- **C4 회고:**
  - `VideoReportCard`에 "Gaze direction" 부분을 더한다.
  - 내용: 방향별 막대, 판정 못 함 비율, 해석 한 줄(예: 아래 18%: 대본이나 키보드를 본 시간일 수 있음), 한계 안내(평가 아님, 화면과 카메라 구별 안 함).
  - 플래그가 켜지면 카메라 동의 문구의 "not eye tracking"류 표현을 실제 동작에 맞게 고친다.
- **시험:**
  - 합성 얼굴과 가짜 검출기로 한다: 기준 잡기 → 답변 → 회고에 비율.
  - 플래그 꺼짐이면 아무것도 보이지 않는다.
  - e2e는 빌드 플래그 대신 가짜 검출기 모드에서만 읽는 localStorage 값으로 켠다.

## 7. 공통 제약과 확인
- **DB:** SQLite와 Supabase 양쪽에서 동작한다. 새 migration은 다시 실행해도 안전하다. A2 문서의 migration 목록에 더한다.
- **테스트:**
  - 백엔드 pytest, 통합(PostgreSQL), 프런트 unit·build·e2e(desktop/mobile)
  - 확장 node 시험(seungxa 것 포함)
  - 팀 로그인 시험(`test:auth`)도 계속 통과해야 한다.
- **실패로 보는 것:**
  - 팀 화면(로그인·프로필·대시보드)이 바뀐다.
  - 자동입력이 이전보다 덜 동작한다(seungxa 시험 실패).
  - 확장이 다른 사이트에서 오는 메시지를 받는다.
  - 오래된 zip을 배포한다.
  - 시선 방향이 플래그 없이 보인다.
- **이번에 확인하지 못할 것** (끝나고 보고에 적는다):
  - 실제 크롬에 설치한 확장의 동작(자동 시험은 크롬 확장 API 대역)
  - 팀 웹 배포 주소에서의 연결
  - 실제 채용 사이트 자동입력
  - 시선 실측

## 8. 진행 순서
1. **계획 X (Track):** T1 → T2 → T3 → T4.
2. **계획 Y (확장·Apply·연결·A3):** E1 → E2·E3 → E4 → E5 → P → A3.
3. **계획 Z (시선 방향):** C2 → C3 → C4.

계획마다 네이티브로 실행하고, 끝에 가장 강한 모델 검토자 한 명이 전체를 본다. 팀 저장소 브랜치 `feature/local-ai-gaze-direction`에 이어서 올린다.
