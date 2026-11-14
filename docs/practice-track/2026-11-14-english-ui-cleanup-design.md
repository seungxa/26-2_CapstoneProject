# 영어 화면 · 문구 정리 · 팀 디자인 맞춤 · OpenAI 제거 — 설계

- 상태: **초안(2026-11-14)**, 사용자 검토 전.
- 작업 기준: `feature/local-ai-gaze-direction`(팀 저장소, PR #1 브랜치 위) 다음 커밋부터.
- 관련 문서:
  - [2026-11-14-local-ai-gaze-direction-design.md](2026-11-14-local-ai-gaze-direction-design.md)의 B1·B2(OpenAI 제거)를 이 묶음에 합친다. B3(로컬 꼬리질문)·B4(배포)는 이 묶음 다음이다.

## 0. 왜 하는가

- **팀 앱과 한 제품처럼 보여야 한다.**
  - 팀 셸(머리글·탭·대시보드·로그인)은 영어이고, 흰 카드·회청색·파랑 `#2563eb`·굵은 제목을 쓴다.
  - Practice·Track 화면은 한국어이고, 따뜻한 회색 상자 안에 다른 파랑·작은 제목을 쓴다.
  - 그래서 팀 페이지 안에 다른 앱이 들어앉은 것처럼 보인다.
- **사용자 요청: "쓸데없는 문구를 다 걷어내."** 2026-11-14 화면 점검 결과:
  - 녹음·개인정보 화면 약 1,100자·목록 11개, 회고 화면 약 1,000자·작은 안내문 31개.
  - 같은 안내가 여러 번 반복된다.
  - 모델 이름·"이 탭 메모리"·OpenAI 같은 내부 구현 설명이 사용자 화면에 나온다.
- **접근성 실패.** 작은 회색 글씨 대비가 3.41:1, 링크 4.30:1, 주 버튼 글씨 4.42:1로 모두 기준(4.5:1)에 못 미친다.
- **팀 결정:** 외부 유료 API를 쓰지 않는다. 남아 있는 OpenAI 코드와 안내를 없앤다.
- **사용자 결정 (2026-11-14):**
  - 앱 화면 언어는 **영어**다.
  - **면접 내용은 한국어**로 둔다(한국 기업 면접 연습). 질문, 답변, 전사문, 꼬리질문이 여기에 해당한다.
  - 문구는 각 화면에서 바로 고친다(방식 ①).

## 1. 목표 · 하지 않는 것 · 실패로 보는 것

**목표**
- Practice·Track 화면의 모든 화면 글자(UI chrome)가 영어다. 화면 글자는 제목, 메뉴, 버튼, 라벨, 안내, 상태, 오류, 앱이 만든 피드백 문장을 말한다.
- 화면마다 꼭 필요한 문구만 남긴다. 내부 구현 설명과 반복 안내는 없앤다.
- 색, 글꼴, 모서리, 제목 굵기가 팀 셸과 같다. 모든 글자가 대비 4.5:1 이상이다.
- OpenAI 호출 코드와 관련 설정·화면·안내가 없다. 앱 전체 흐름에서 외부 HTTP 요청이 0회다.

**하지 않는 것**
- 팀 소유 파일은 수정하지 않는다: `App.tsx`, `App.css`, `index.css`, `pages/*`, `lib/*`, `components/ProtectedRoute.tsx`.
  - 팀 쪽 제안(이모지 아이콘이 깨짐, 다크 모드)은 문서로만 남긴다.
- DB 스키마나 저장 값은 바꾸지 않는다(4.4절).
- 한국어 면접 내용은 번역하지 않는다: 질문은행·템플릿 질문, 전사, 꼬리질문 문장.
- 로컬 꼬리질문 모델(B3), 배포(B4), Supabase 적용 묶음(A2), 확장 계약 문서(A3)는 이 묶음에 넣지 않는다.
- 개발 전용 시선 실험실 두 개(`GazeLab`, `GazeDirectionLab`)의 고유 문구는 바꾸지 않는다. 다만 공용 컴포넌트(`CameraPanel` 등)가 영어로 바뀌므로 그 테스트와 절차 문서의 버튼 이름은 맞춘다.
- 크롬 확장 `extension-track`의 문구는 바꾸지 않는다(seungxa 확장과 합칠 때 정한다).
- 영어·한국어 전환 기능(i18n)은 만들지 않는다.

**실패로 보는 것**
- 개인정보 고지가 사라져, 무엇을 녹음해 어디서 처리하고 얼마나 보관하는지 알 수 없게 된다. 줄이되 지우지 않는다.
- 기존 기록(과거 AI 코칭·디브리프·AI 피드백, 한국어 저장 값)이 화면에서 깨지거나 사라진다.
- 팀 셸·로그인·프로필의 동작이나 모양이 바뀐다. `test:auth`와 `team-shell` e2e가 실패하는 경우도 여기에 해당한다.
- 기존 기능 테스트의 동작 범위가 줄어든다. 글자만 바꾸고 검사하던 동작은 그대로 검사해야 한다.

## 2. 제약

- **기술 스택:** 팀 frontend는 React 19, react-router 8, Vite 8, TypeScript 6이다. 새 npm·pip 의존성은 추가하지 않는다.
- **CSS 범위:** 기능 스타일은 `.practice-track.practice-track` 범위 안에서만 바꾼다(팀 CSS에 새지 않게).
- **디자인 값 출처:** 팀 `App.css`가 실제로 쓰는 색·크기에서 가져온다.
  - 배경 `#f8fafc`, 카드 흰색, 테두리 `#e2e8f0`.
  - 글자 `#0f172a` / `#1e293b`, 보조 글자 `#475569` / `#64748b`.
  - 파랑 `#2563eb`, 카드 모서리 12px.
- **대비:** 본문·작은 글자 모두 4.5:1 이상. 숫자로 확인한다.
- **기준 문서:** `docs/decisions.md`의 개인정보 결정(녹음 동의, 원본 삭제, 탭 메모리 관찰 D-17·D-30·D-35)은 동작으로 유지한다. 화면 설명만 줄인다.

## 3. 검토한 방법과 고른 것

**문구를 어떻게 바꿀까**
- **① 각 컴포넌트의 문구를 영어로 바로 고치면서 걷어내기 (선택).** 구조가 그대로이고 의존성이 없다.
- **② `copy.ts` 한 파일에 문구 모으기.** 검토는 쉽지만 컴포넌트 20여 개를 고쳐야 하고 코드를 읽기 어려워진다.
- **③ react-i18next 도입.** 새 의존성이 생기고 팀 셸까지 건드려야 해서 영어 하나로 정한 지금은 과하다.
- **고른 이유:** 영어 하나로 정했으니 모으는 구조는 당장 쓸 데가 없다. 걷어내는 판단은 화면을 보며 하는 게 정확하다.

**면접 언어**
- **(가) 화면만 영어, 면접은 한국어 (선택).**
- (나) 전부 영어: 질문은행·전사·점검 규칙·모델을 다시 만들어야 한다.
- (다) 사용자가 고르기: 일이 가장 많다.

## 4. 설계

### 4.1 디자인 값 (기능 CSS 변수 교체)

`styles.css`의 변수를 아래 값으로 바꾸고, 다크 모드 블록을 없앤다.

| 변수 | 값 | 쓰임 | 흰 배경 대비 |
|---|---|---|---|
| `--bg` | `#f8fafc` | 페이지 배경(팀 `.app`과 같음) | – |
| `--surface` | `#ffffff` | 카드 | – |
| `--border` | `#e2e8f0` | 카드·입력 테두리 | – |
| `--text` | `#0f172a` | 본문·제목 | 17.9:1 |
| `--text-2` | `#475569` | 보조 글자 | 7.6:1 |
| `--muted` | `#64748b` | 작은 안내·표 머리 | 4.76:1 |
| `--accent` | `#2563eb` | 링크·주 버튼(흰 글씨 5.17:1) | 5.17:1 |
| `--accent-soft` | `#eff6ff` | 선택된 칩·탭 배경 | – |
| `--good-text` · `--warn-text` · `--bad-text` | 흰 배경 4.5:1 이상인 녹·황·적 | 상태 글자 | 구현 때 계산해 4.5:1 이상 |
| `--radius` | `12px` | 카드 | – |

- **다크 모드:** 팀 셸에 없으므로 없앤다. 팀 문서에 나중 과제로 남긴다.
- **글꼴:** `Arial, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`. 영문은 팀과 같고, 한국어 면접 내용은 한글 글꼴로 보인다.
- **제목:** 굵게 쓴다.
  - 페이지 제목: 팀 `.main h2`처럼 30px·굵게·`#0f172a`.
  - 카드 제목: 20px·굵게.
  - 작은 제목: 16px·굵게.
- **기능 바깥 상자:** 따뜻한 회색 상자를 없애고, 기능 내용이 팀 페이지 배경 위에 바로 놓이게 한다. 폭은 팀 `.main`의 최대 폭을 따른다.
- **기준:** 버튼·입력·카드의 크기와 간격은 팀 화면(프로필 카드, 로그인 버튼)과 나란히 놓았을 때 같아 보이는 것이다.

### 4.2 문구 규칙

1. **화면은 세 가지로 구성한다.** 제목, 주 동작, 꼭 필요한 안내 1줄 이내다. 설명이 더 필요하면 접힌 "Details" 안에 둔다.
2. **내부 구현을 말하지 않는다.** 모델 이름(Whisper base 등), "this tab's memory", 서버 구조, 플래그, 스냅샷 지문, 분류 버전 같은 용어를 화면에 쓰지 않는다. 동작이 사용자에게 의미가 있을 때만 결과로 말한다. 예: "Video stays on your device."
3. **같은 안내는 한 곳에만 둔다.** "연습 전용", 원본 녹음 보관 기간, 판정 한계는 각각 한 번만 보인다.
4. **상태는 문제가 있을 때만, 관련된 자리 옆에 보인다.** 모든 화면 위의 "음성 전사·AI 코칭" 상태 줄을 없앤다. 전사가 꺼져 있거나 실패하면 녹음 버튼이나 해당 답변 옆에 한 줄로 알린다.
5. **오류는 무엇이 잘못됐고 어떻게 고치는지 말한다.** 사과나 감탄사는 쓰지 않는다. 예: "Add a transcript or record an answer first."
6. **대소문자:**
   - 제목·버튼·탭·메뉴: 단어 첫 글자 대문자. 예: "Start Practice", "Log Out".
   - 설명문·라벨 보조문: 문장 첫 글자만 대문자.
7. **사람의 판단처럼 들리는 말을 쓰지 않는다.** 점수, 합격, 자신감, 집중도 같은 표현이 여기에 해당한다(기존 결정 유지).
   - 판정 한계는 회고 화면에서 한 번만 말한다. 예: "Rule-based checks, not a hiring assessment."

### 4.3 화면별 정리

| 화면 | 남길 것 | 걷어낼 것·바꿀 것 |
|---|---|---|
| 공통 | 기능 하위 메뉴 | 상단 상태 줄. Practice 메뉴의 "지원 관리·통계"(Track 탭에 있음) |
| Practice 홈 | 맨 위: 질문 고르기 + "Start Practice". 아래 접힌 구역: Mock Interview, Generate Questions, Filters | 같은 기준 안내의 반복, 구역마다 붙은 설명 문단, 분류 필터 설명 |
| 면접 진행 | 질문, 타이머, 녹음·답변 입력, 다음·꼬리질문 버튼 | 단계마다 붙은 보조 설명 |
| 회고 | 한눈에 보기, 답변 카드(질문·전사·자기평가·메모·점검 결과), 다시 연습 | 카드마다 반복되는 면책문, "녹음이 없습니다/녹음 없음" 중복, 판단 못 한 기준 세 줄 반복(판단 못 하면 한 줄로), OpenAI 디브리프 안내 |
| 녹음·개인정보(Privacy) | 짧은 동의: 무엇을 녹음하는지, 우리 서버에서 전사, 원본은 전사 후 삭제(보관을 고르면 최대 30일), 영상은 기기 밖으로 안 나감. "원본 보관" 선택, "Delete All Recordings" | "연습 전용" 반복, OpenAI 문단 전부, "무엇을 어디로 보내나요" 8개 목록(동의 문구와 중복) |
| 카메라 동의·회고 카드 | 켜기·끄기, 얼굴 상태, 측정 결과 | 구현 설명(코끝 위치로 고개 추정 등)은 "Details"로 |
| Track 목록·상세·통계 | 표, 상태, 버전·제출 기록, 통계 | 설명 문단, 같은 설명의 반복 |

- 표는 문구 기준이다. 화면 배치는 4.3a를 따른다(둘이 다르면 4.3a가 우선).

- **구역 구성:** 표에 적은 남길 것과 걷어낼 것의 구성은 정해진 것이다.
- **빌더가 정할 것:** 각 구역의 정확한 영어 문구. 4.2의 규칙을 지켜야 한다.

### 4.3a 구성 단순화 (사용자 요청: "잡다하고 복잡하다, 사람에게 친절하게")

**원칙**

1. **화면 하나에 할 일 하나, 주 버튼 하나.**
   - 연습 시작 화면: 질문 고르고 시작.
   - 진행 화면: 답하고 다음.
   - 회고 화면: 어디를 고칠지 보고 다시 연습.
2. **기능은 없애지 않고 접는다.** OpenAI 기능과 검증 도구는 예외다.
   - 자주 쓰지 않는 선택지는 접힌 구역("More Options")이나 다음 단계로 옮긴다: 모의시험 설정, 질문 생성, 분류 필터·편집, 채용 공고, 자소서 기준.
3. **동의는 처음 필요할 때 한 번, 세 줄로.**
   - 첫 녹음 직전에 짧은 동의 카드가 나온다.
   - 카드 내용: 무엇을 녹음하는지 / 우리 서버에서 전사 / 원본은 전사 후 삭제(보관 선택 시 최대 30일).
   - 자세한 내용은 Settings로 링크한다.
   - 카메라는 진행 화면의 작은 토글 하나로 둔다. 한 줄 설명: "Optional. Video stays on this device."
4. **회고는 요약 한 줄과 답변 목록으로 한다.**
   - 지금 따로 떨어진 카드들("한눈에 보기", "통합 코칭", "다음 연습으로 연결하기", "기준 자료", "세션 디브리프")을 맨 위 요약 하나로 합친다.
   - 답변 카드는 접힌 상태로 시작하고, 펼치면 전사문, 점검, 말하기·카메라 관찰, 자기평가·메모가 보인다.
5. **메뉴는 탭마다 자기 것만 둔다.**
   - Practice: Start · History · Settings.
   - Track: Applications · Stats.
6. **검증 도구는 제품 화면에서 뺀다.** 회고의 "검증 조건" 선택, 진단 표시가 해당한다. 개발 플래그일 때만 보인다.

**화면 구성 (텍스트 스케치)**

Practice › Start

```
Practice                                   Start · History · Settings
┌ Questions ──────────────────────────── [Search…] [All ▾] ┐
│ ☐ 팀 프로젝트에서 갈등을 해결한 경험을 말해 주세요.   Personality │
│ ☐ 지원한 직무에서 가장 중요하다고 생각하는 역량은…    Job Fit     │
│ …                                                        │
│ + Add a Question                                         │
└──────────────────────────────────────────────────────────┘
Application  [None ▾]
[ Start Practice (2) ]        [ Mock Interview ]
▸ More Options   (mock settings · job posting · essay version · follow-ups)
▸ Generate Questions from an Essay
```

Practice › 진행 (답하기 전 → 답한 뒤)

```
Question 1 of 5                                       [End]
팀 프로젝트에서 갈등을 해결한 경험을 말해 주세요.
                    01:30
               [ ● Start Answer ]
        Type instead   ·   Camera ○ Off
┌ First time only ───────────────────────────────────────┐
│ Your voice is recorded and transcribed on our server.   │
│ Audio is deleted after transcription.  ☐ Keep 30 days   │
│ [ Agree & Start ]                     Details           │
└─────────────────────────────────────────────────────────┘
--- 답한 뒤 ---
Transcript (editable)  [ …………………………………………… ]
[ Next Question ]   [ Ask a Follow-up ]
```

Practice › 회고

```
Practice · Nov 14, 18:04                              [Delete]
2 answers · 1 needs work · Next: add a result with numbers to Q1
[ Practice Weak Answers Again ]
Rule-based checks, not a hiring assessment.
▸ Q1 팀 프로젝트에서 갈등을…           Needs Work   ★★★☆☆
▸ Q2 지원한 직무에서 가장 중요…        Not Judged   ★★★★☆
   (펼치면: Transcript · Checks · Delivery · Self Rating & Note)
```

Settings

```
Settings
Recordings   Keep original audio for 30 days  [ Off ]
             [ Delete All Recordings ]
Privacy      Voice is transcribed on our server. Nothing goes to other services.
             Camera video never leaves your device.
```

Track › Applications

```
Applications                                       [ + Add Application ]
[Search…]  [All statuses ▾]   ▸ Filters (stage · job)
Company        Role        Stage           Status        Updated
Naver          Backend     1st Interview   In Progress   Nov 12
```

- **상세 화면:** 회사·직무·단계·상태를 머리글 한 줄에 둔다. 아래는 Essays와 Timeline 두 구역, "Practice for This Application" 버튼 하나다.
- **스케치의 성격:** 배치와 구성은 정해진 것이고, 영어 문구의 정확한 글자는 빌더가 4.2 규칙으로 정한다.

### 4.4 저장 값은 그대로, 화면 이름만 영어

**배경**
- DB와 API, 확장의 `/track/sync`가 한국어 값을 주고받는다: 전형 단계·지원 상태·질문 분류·코칭 판정·결과 값.
- 분류 스냅샷에도 한국어 라벨이 저장되어 있다.

**결정**
- 이 값들은 **바꾸지 않는다**.
- 프런트엔드에 값 → 영어 이름 표(`labels.ts` 하나)를 두고, 화면에서만 영어로 보인다.
- 표에 없는 값이 오면 원래 값을 그대로 보인다(깨지지 않게).

| 종류 | 저장 값 → 화면 이름 |
|---|---|
| 질문 분류 | 인성 → Personality, 직무 → Job Fit, 기업 → Company, 상황 → Situational, 인적성 → Aptitude |
| 전형 단계 | 서류 → Application, 인적성 → Aptitude Test, 1차면접 → 1st Interview, 2차면접 → 2nd Interview, 최종 → Final |
| 지원 상태 | 진행중 → In Progress, 합격 → Passed, 불합격 → Rejected, 보류 → On Hold |
| 결과 | 대기 → Pending, 합격 → Passed, 불합격 → Rejected |
| 코칭 판정 | 충분 → Meets, 보완 → Needs Work, 판단유보 → Not Judged |
| 코칭 기준 | specificity → Specificity, relevance → Relevance, consistency → Matches Your Essay |
| 직무 | 개발 → Engineering, 기획 → Product, 마케팅 → Marketing, 데이터 → Data, 디자인 → Design, 기타 → Other, 공통 → General |
| 질문 유형(key) | self_description → Self-Introduction, motivation → Motivation & Goals, behavioral → Behavioral, situational → Situational Judgment, project_deep_dive → Project Deep Dive, knowledge → Knowledge & Reasoning |
| 역량(key) | problem_solving → Problem Solving, communication → Communication, collaboration → Collaboration, leadership → Leadership, technical_expertise → Job Expertise, adaptability → Adaptability & Learning, analytical_thinking → Analytical Thinking |

**적용 규칙**
- 질문 유형·역량은 API가 주는 한국어 라벨 대신 key로 영어 이름을 찾는다.
- 코칭 판정·기준 이름도 저장된 보고서의 값으로 찾는다. 과거 보고서도 영어 이름으로 보인다.

### 4.5 백엔드가 만드는 사용자용 문장

- **API 오류 메시지:** `HTTPException` detail 51개를 영어로 바꾼다. 프런트가 그대로 보여 주기 때문이다. 4.2의 5번 규칙을 따른다.
- **앱이 만든 피드백 문장:** 영어로 바꾼다.
  - 기본 점검의 summary·reason·next_action.
  - 루브릭 설명(`GET /practice/rubric`).
  - 회고 규칙 문장(`review/insights.ts`).
- **한국어 그대로 두는 것 (면접 내용):**
  - 기본 점검이 만드는 꼬리질문 문장(`followup.text`). 한국어 면접 질문이다.
  - 템플릿 질문, 질문은행.
- **새로 만드는 기록만 영어다.** 이미 저장된 과거 보고서의 한국어 문장은 그대로 보인다.

### 4.6 OpenAI 제거 (기존 설계 B1·B2를 그대로 포함)

- **백엔드:** 기존 설계 4.2 B1을 그대로 따른다.
  - `llm.py`: AI 호출 제거, 템플릿 질문만 남긴다.
  - `coaching`: 항상 기본 점검을 쓰고, AI 역량 근거와 그 플래그를 제거한다.
  - `debrief`: AI 요약 제거. 기본 점검과 다시 연습할 답변 고르기만 남긴다.
  - `stt`: OpenAI 제공자 제거.
  - `POST /answers/{id}/feedback` 제거.
  - `OPENAI_*` 설정 제거. 남아 있는 키는 경고 로그만 남기고 무시한다.
  - `/health.openai` 필드를 없앤다.
- **기존 기록:** `method:"ai"` 보고서, 디브리프 요약, `ai_feedback`은 읽기 전용으로 계속 보인다.
- **프런트엔드:** OpenAI 의존 화면을 없앤다. AI 피드백 버튼, 키 없음 안내, AI 디브리프 카드의 "키가 없어" 문구가 여기에 해당한다. 과거 AI 기록 표시는 남긴다.
- **테스트:** 앱 전체 흐름(질문 생성 → 답변 → 점검 → 꼬리질문 → 종료·디브리프)에서 외부 HTTP 요청이 0회임을 확인하는 백엔드 테스트를 추가한다.

### 4.7 테스트

- **글자만 바꾸는 테스트는 동작 범위를 유지한다.** e2e 17개 파일(한국어 글자 약 700줄)과 unit 11개 파일이 대상이다. 화면 이름으로 찾던 것은 새 영어 이름으로 찾는다. 검사하던 동작은 빼지 않는다.
- **새 테스트:**
  - 디자인 값 대비: CSS 변수의 글자 색이 흰 배경과 `--bg`에서 4.5:1 이상인지 계산하는 unit 테스트.
  - 저장 값 표시: 한국어 저장 값이 영어 이름으로 보이고, 모르는 값은 원래 값 그대로인지.
  - 문구 걷어냄 확인: Practice·Track 화면(시선 실험실 제외)에 한글 화면 글자가 없는지 검사한다. 한국어 면접 내용(질문·전사)은 예외다.
  - 외부 호출 0회 (4.6).
- **팀 테스트:** `test:auth`, `team-shell` e2e가 계속 통과해야 한다.

## 5. 진행 순서 (계획에서 작업으로 나눈다)

1. 디자인 값과 바깥 상자, 대비 테스트.
2. 저장 값 → 영어 이름 표.
3. OpenAI 제거(백엔드)와 영어 오류·피드백 문장.
4. 화면별 영어 전환과 문구 정리. 다음 순서로 하고, 각 화면의 테스트를 같이 고친다.
   1. 공통 메뉴·상태 줄
   2. Privacy·동의
   3. Practice 홈
   4. 진행
   5. 회고
   6. Track
5. 시선 실험실 테스트와 절차 문서의 공용 버튼 이름 맞추기. 팀에 줄 제안 메모(이모지 아이콘, 다크 모드, 언어).

## 6. 검증

- **자동:** 백엔드 pytest, 프런트 unit·build·전체 e2e(desktop·mobile), `test:auth`.
- **사람:** 바뀐 화면을 팀 화면과 나란히 찍은 스크린샷으로 사용자가 확인한다(로컬 pilot, 가짜 데이터).
- **확인하지 못하는 것:** 실제 사용자 반응, 실제 기기별 글꼴 렌더링 차이.

## 7. 빌더에게 맡기는 것

- 각 화면의 정확한 영어 문구. 4.2 규칙과 4.3 구성을 지켜야 한다.
- 상태 글자 색의 정확한 값(4.5:1 이상), 접는 구역의 구현 방식(`<details>` 등).
- `labels.ts`의 위치와 함수 이름, 테스트 파일 구성.

## 8. 이 대화에서 사용자가 정한 것 (2026-11-14)

- UI 디자인은 팀과 맞춘다. 쓸데없는 문구는 다 걷어낸다. 구성은 더 단순하고 사람에게 친절하게 한다(4.3a).
- 화면 정리와 OpenAI 제거를 한 묶음으로 한다.
- 앱 화면 언어는 영어, 면접 내용은 한국어다((가)).
- 문구는 각 화면에서 바로 고친다(①).
- 브랜치 처리는 Claude 판단에 맡긴다. 이 묶음을 끝낸 뒤 한 번에 올린다.
