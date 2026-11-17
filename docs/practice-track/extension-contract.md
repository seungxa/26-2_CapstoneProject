# JobSeeker 확장 0.8.0 계약 문서 (A3)

자동입력 확장(seungxa, JobSeeker Apply 0.7.0)과 지원 관리 팝업을 하나로 합친 확장 `extension/`의 구조와 약속이다. seungxa가 확인할 것은 마지막 절에 모아 두었다.

- **출처:** `origin/chrome-extension` 커밋 `e103160`의 `jobseeker-v0.7.0/jobseeker-extension/`
  - 원본 그대로 들여온 커밋(`706fd50`)과 합친 커밋을 나눠 두어 차이를 볼 수 있다.
  - `git diff 706fd50 -- extension/background.js extension/panel.js extension/manifest.json extension/tests/rules-only.test.js`
- **고정 확장 ID:** `hbbocccjbnobncagkalnkeapkndiompd`
  - manifest `key`의 공개 키로 정해진다. 개인 키는 만들지 않았고 저장소에 없다.
  - 웹은 `VITE_EXTENSION_ID`로 바꿀 수 있다.

## 1. 구조

| 부분 | 파일 | 하는 일 |
|---|---|---|
| 팝업(진입점) | `popup.html`·`popup.js`·`popup.css` | 아이콘을 누르면 뜬다. 이 지원서 채우기, 오늘 할 일·다가오는 일정, 공고 저장(마감일), 최근 지원 현황, 사이버 염주 |
| 사이드 패널 | `panel.*`와 seungxa 모듈 | 자동입력(0.7.0 그대로) |
| 배경 | `background.js` | 탭 연결(`connectTab`), 웹에서 오는 메시지 처리, seungxa의 주소 검색 팝업 연결 |
| 내용 스크립트 | `values.js`·`widgets.js`·`content.js`·`address-agent.js` | 0.7.0 그대로 |
| 지원 관리 API | `api.js`·`settings.js`·`config.js` | 팀 API(`/track/…`) 호출, 주소 설정, 로그인 토큰 |
| 순수 모듈 | `archive.js`·`bridge.js`·`beads.js`·`schedule.js`·`extract.js` | 아카이브 검사, 메시지 검사, 염주 계산, D-day, 공고 제목 추정 |

## 2. seungxa 파일 중 바꾼 곳

| 파일 | 바꾼 점 | 이유 |
|---|---|---|
| `manifest.json` | 이름 "JobSeeker", 0.8.0, `action.default_popup`, 우리 아이콘, `options_page`, API 주소 3개를 `host_permissions`에 추가, `externally_connectable`, `key` | 팝업이 진입점이 되고, 웹과 메시지를 주고받고, ID를 고정하려고 |
| `background.js` | `action.onClicked` 본문을 `connectTab(tab)`로 옮겼다. 팝업이 보내는 `JS_CONNECT_TAB`(같은 확장, 탭이 아닌 곳에서만)을 처리한다. `onMessageExternal`을 추가했다 | 팝업이 있으면 `onClicked`가 오지 않는다. 연결 동작은 그대로다 |
| `panel.js` | `validateArchive`를 `archive.js`로 옮겨 불러 쓴다(내용 같음) | 배경이 웹에서 받은 프로필을 같은 규칙으로 검사하려고 |
| `tests/rules-only.test.js` | 네트워크 모듈 허용 목록에 `api.js`를 더했다 | 지원 관리 API 클라이언트가 두 번째 네트워크 모듈이 됐다. 나머지 파일은 여전히 네트워크를 쓰지 않는다 |

자동입력 로직(matching·planner·widgets·mappings·stage-matching·llm·content·address-agent)은 바꾸지 않았다. seungxa 시험 31개가 그대로 통과한다.

**사용 흐름:** 예전에는 아이콘 한 번이면 패널이 열리고 탭에 연결됐다. 이제는 **아이콘 → 팝업의 "이 지원서 채우기"**, 두 번 누른다.
- 사이드 패널은 사용자 클릭 안에서만 열 수 있다. 그래서 팝업이 먼저 패널을 열고, 배경에 연결을 맡긴다.

## 3. 웹 ↔ 확장 메시지

웹(Apply 페이지와 로그인 상태가 바뀔 때)이 `chrome.runtime.sendMessage(EXTENSION_ID, message, callback)`으로 보낸다.

| 보내는 것 | 확장이 하는 일 | 응답 |
|---|---|---|
| `{type: "jobseeker:ping"}` | 없음 | `{ok: true, version}` |
| `{type: "jobseeker:session", token}` | `chrome.storage.session`에 액세스 토큰 저장(브라우저를 닫으면 지워짐). `token: null`이면 삭제 | `{ok: true}` |
| `{type: "jobseeker:archive", archive}` | `validateArchive` 뒤 `archiveRepository.save`(자동입력이 쓰는 프로필) | `{ok: true}` 또는 `{ok: false, error}` |

- **보낼 수 있는 곳:** Chrome은 manifest `externally_connectable.matches`에 있는 웹 주소에서만 메시지를 넘긴다. 배경은 `sender.origin`을 한 번 더 확인한다. 목록 밖에서 오면 `{ok:false, error:"This site may not talk to JobSeeker."}`로 답하고 아무것도 저장하지 않는다.
- **꼴 검사:**
  - 토큰은 4,096자 이하 문자열이나 null.
  - 아카이브는 객체.
  - 다른 type은 거절한다.
- **웹 쪽 코드:** `frontend/src/features/practice-track/integration/extensionBridge.ts`.
  - 확장이 없으면 1.5초 뒤 "Not installed"로 끝나고, 다른 화면에는 영향이 없다.

## 4. 확장이 쓰는 API

모두 `Authorization: Bearer <Supabase 액세스 토큰>`을 붙인다(토큰이 없으면 개발 모드 서버에서만 동작한다).

| 호출 | 쓰는 곳 |
|---|---|
| `GET /track/applications?url=…` | 지금 탭의 공고가 이미 저장됐는지 |
| `GET /track/applications?sort=due` | 오늘 할 일·다가오는 일정 |
| `GET /track/applications`, `GET /track/stats` | 최근 지원 현황 |
| `POST /track/sync` | 공고 저장, 지원 완료 표시 |

**`/track/sync` 본문:**
- 필드: `{company, position, job_category, url, essays: [{question_text, content, char_limit?}], submitted, applied_at?, deadline?}`
- `submitted`는 항상 명시한다.
  - 팝업 저장: 체크박스 값
  - 지원 완료 표시: `true`
- 같은 URL이면 같은 지원 건으로 합쳐진다. `deadline`은 보낼 때만 덮어쓴다.
- 자동입력이 지원서 제출을 감지해 이 호출로 문항·답변을 보내는 것은 **아직 하지 않았다.** 아래 확인 목록 2번에서 정한다.

## 5. 빌드·배포·업데이트

- **빌드:**
  - `node scripts/practice-track/build-extension.mjs [--web-origin <팀 웹 주소>]... [--api-url <API 주소>]`
  - 결과: `frontend/public/downloads/jobseeker-extension.zip`과 `extension.json`(버전·크기·sha256·출처 커밋·주소)
  - 기본 API 주소: `https://team-api.duckdns.org`
  - 개발용 웹 주소: `localhost:5173`, `127.0.0.1:5173`
- **zip:** 같은 입력이면 같은 바이트다. 시험·데모·문서는 빼고 넣는다.
  - `--check`가 커밋된 zip과 `extension/`이 맞는지 확인한다. 단위 시험에 들어 있다.
- **팀 웹 주소가 정해지면:**
  1. `--web-origin https://<팀 웹 주소>`로 다시 빌드해 커밋한다.
  2. 사용자는 Apply 페이지에서 새 zip을 받아 `chrome://extensions`에서 새로고침한다.
- **버전을 올릴 때:** `extension/manifest.json`의 `version`을 바꾸고 다시 빌드한다.

## 6. seungxa 확인 목록

1. **진입점 변경:** 아이콘 → 팝업 → "이 지원서 채우기"로 사이드 패널을 연다. 괜찮은지, 아니면 사이드 패널 안에 지원 관리 탭을 두는 쪽을 원하는지.
2. **제출 감지 → 지원 관리 기록:**
   - 자동입력이 지원서 제출을 감지했을 때 `/track/sync`(4절)를 부를지.
   - 부른다면 사용자가 확인한 뒤에만 보낸다(자동 전송 금지 원칙 유지).
   - `api.js`의 `api.savePosting`을 넓혀 쓰면 된다.
3. **네트워크 허용 목록:** `rules-only.test.js`에 `api.js`를 더한 것에 동의하는지.
4. **AI 판단 계층:** 기본 꺼짐을 유지한다. 팀은 외부 유료 API를 쓰지 않기로 했으므로, 켤 때는 로컬(Ollama 등) 주소를 권한다.
5. **`validateArchive` 이동:** `archive.js`로 옮긴 것에 동의하는지. 내용은 바꾸지 않았다.

## 7. 확인한 것과 하지 못한 것

- **확인한 것:**
  - seungxa 시험 31개
  - 팝업 e2e(크롬 API 대역): 채우기 버튼, 일정, 마감일 저장, 염주
  - 배경 메시지 처리(대역): 허용·거절 출처, 세션·아카이브 저장
  - 웹 쪽 연결(대역), 빌드 재현성, Apply 페이지 e2e
- **하지 못한 것:**
  - 실제 크롬에 설치한 상태의 동작(사이드 패널 열기, `activeTab` 권한, 외부 메시지)
  - 실제 채용 사이트 자동입력
  - 팀 웹 배포 주소에서의 연결
