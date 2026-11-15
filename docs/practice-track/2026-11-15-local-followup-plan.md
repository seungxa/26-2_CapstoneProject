# 로컬 꼬리질문 모델 (B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 "Ask a Follow-up"을 누르면, 서버가 작은 한국어 언어 모델로 답변 내용에 맞는 꼬리질문 한 문장을 만든다. 모델이 없거나, 느리거나, 이상한 문장을 내면 지금의 고정 문장으로 대신한다.

**Architecture:**
- `backend/app/followup_model.py`가 `llama-cpp-python`으로 GGUF 모델을 서버 프로세스 안에서 불러와 재사용한다. 불러오는 시점은 지연 로딩이 기본이고, 미리 불러오는 설정을 둔다. 한 번에 하나씩 처리하고 시간 상한을 둔다.
- 프롬프트와 검증은 순수 함수(`followup_text.py`)로 분리해 모델 없이 테스트한다.
- 꼬리질문 API(`POST /practice/answers/{id}/followup`)는 그대로 두고, 세션 잠금을 잡기 전에 생성을 시도한다.

**Tech Stack:** FastAPI, `llama-cpp-python`(CPU wheel, 서버 설치용 별도 requirements), `huggingface-hub`(모델 내려받기), pytest, React 19 + Playwright.

**Spec:** `docs/practice-track/2026-11-14-local-ai-gaze-direction-design.md` 4.2절 **B3**. 앞선 결정(OpenAI 제거, 영어 화면, 한국어 면접 내용)은 `docs/practice-track/2026-11-14-english-ui-cleanup-design.md`를 따른다.

**설계와 달리 정한 것 하나 (이 계획의 결정)**
- 설계 B3는 "보고서가 없을 때 만드는 `_report` 단계에서 생성"이라고 했다. 이 계획은 **꼬리질문 요청 때만** 생성한다.
- 이유:
  - `_report`(= `coaching.build_report`)는 "Check Answer"와 세션 종료 디브리프의 모든 답변 점검에도 쓰인다. 거기서 모델을 부르면 점검마다 10~30초가 걸린다.
  - 이미 점검한 답변에는 `_report`가 다시 돌지 않으므로, 모델이 아예 쓰이지 않는다.
- 설계가 정한 나머지 조건은 그대로 지킨다: API는 바뀌지 않고, 세션 잠금을 잡은 동안에는 모델을 부르지 않는다.

## Global Constraints

**외부 서비스와 저장 범위**
- 외부 유료 API를 쓰지 않는다. 허용되는 외부 요청은 모델 파일을 처음 한 번 Hugging Face에서 받는 것뿐이다(`FOLLOWUP_ALLOW_DOWNLOAD`로 끌 수 있음). 테스트 환경은 `FOLLOWUP_MODEL=off`라서 `test_no_external_calls.py`가 계속 통과해야 한다.
- DB 스키마와 저장 값을 바꾸지 않는다. 팀 소유 프런트 파일(`frontend/src/App.tsx`, `App.css`, `index.css`, `pages/*`, `lib/*`, `components/ProtectedRoute.tsx`)은 수정하지 않는다.

**의존성**
- `llama-cpp-python`과 `huggingface-hub`는 새 파일 `backend/requirements-followup.txt`에만 넣는다. 기본 `requirements.txt`와 `requirements-dev.txt`는 바꾸지 않는다.
- 이 패키지가 없어도 서버와 테스트가 정상 동작해야 한다. 그때는 고정 문장으로 대신한다.

**언어**
- 꼬리질문 문장은 한국어(면접 내용)다. 그 밖의 화면 글자와 API 오류 문장은 영어다(앞 묶음의 규칙).

**모델 후보 (Task 3에서 이 순서로 시험해 첫 통과 모델을 기본값으로 정함)**

| 순서 | repo_id | 파일 | 비고 |
|---|---|---|---|
| 1 | `ssolunar/Kanana-2-1.3b-instruct-Q4_K_M-GGUF` | `Kanana-2-1.3b-instruct-Q4_K_M.gguf` | arch `qwen3`. 카카오 Kanana Open License, 상업 가능(조건 있음) |
| 2 | `LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF` | `EXAONE-4.0-1.2B-Q4_K_M.gguf` | arch `exaone4`, 공식. 비상업 라이선스(학교 과제는 가능) |
| 3 | `naver-ellm/HyperCLOVAX-SEED-Text-Instruct-0.5B-GGUF` | 저장소의 Q4 계열 파일 | "Powered by HyperCLOVA" 표시 의무 |

- `winwinplatform/Kanana-2-1.3b-instruct-GGUF`는 arch가 `kanana2tiny`라 표준 llama.cpp가 지원하지 않아 쓰지 않는다.

**설정 이름과 기본값** (`backend/app/config.py`, `.env.example`)

| 설정 | 기본값 | 뜻 |
|---|---|---|
| `FOLLOWUP_MODEL` | `local` | `local` 또는 `off` |
| `FOLLOWUP_MODEL_REPO` · `FOLLOWUP_MODEL_FILE` | Task 3 결정값 | 쓸 모델 |
| `FOLLOWUP_MODEL_DIR` | `""` | 비우면 HF 캐시 |
| `FOLLOWUP_THREADS` | `min(4, CPU 수)` | CPU 스레드 수 |
| `FOLLOWUP_TIMEOUT_SEC` | `45` | 대기와 생성을 합친 상한 |
| `FOLLOWUP_ALLOW_DOWNLOAD` | `true` | 처음 한 번 내려받기 허용 |
| `FOLLOWUP_PRELOAD` | `false` | 서버 시작 때 미리 불러오기. 배포에서는 `true` |

**생성 조건**
- `n_ctx` 1536, `max_tokens` 96, `temperature` 0.1. (처음 계획은 1024와 0.3이었다. Task 3 시험 뒤 바꿨다: 숫자가 많은 1,200자 답변이 1,084~1,169토큰이었고, EXAONE 모델 카드가 한국어 대화에 0.1을 권한다. `followup-model-check.md` 참고)
- 입력 전사문은 앞 1,200자까지만, 질문은 앞 300자까지만(`MAX_QUESTION_CHARS`, 긴 직접 입력 질문이 `n_ctx`를 넘지 않게) 넣는다.

**검증 규칙** (`followup_text.validate_followup`)
- 맨 앞의 생각 블록(`<think>…</think>`)을 먼저 뗀다. 닫히지 않은 생각 블록만 있으면 빈 출력(`empty`)이다.
- 그다음 내용이 있는 첫 줄만 쓴다. 머리말만 있는 줄(`**꼬리질문:**` 한 줄 뒤에 질문)은 건너뛰고, 그 밖의 첫 줄(평서문 등)은 그대로 검사한다.
- 각 줄에서 다음을 뗀다: 앞의 목록 기호(`- `, `* `, `• `, `1. `, `2) `, `(1) `. 뒤에 빈칸이 있을 때만이라 `-5도`, `3.5초`는 그대로), 마크다운 꾸밈(`**…**`는 어디서나, `__…__`, `*…*`, `_…_`는 문장 전체나 `**꼬리질문:**`, `_답습_:` 같은 앞 머리말을 감쌀 때만이라 `__init__`, `user_id`는 그대로), "꼬리질문:" 같은 머리말, 6자 이하의 짧은 머리말 하나(`답습: `처럼 콜론 뒤에 빈칸이나 줄 끝이 있을 때만이라 `10:30`은 그대로).
- 따옴표는 문장 전체를 감싼 짝(`"…"`, `“…”`, `'…'`, `‘…’`, `「…」` 등)일 때만 뗀다. `“40% 줄였습니다”라고 하셨는데, …?`의 따옴표는 남는다.
- 한글 비율 ≥ 0.5 (글자 기준).
- 길이 10~120자.
- `?`로 끝나거나 `(주세요|주시겠어요|나요|까요|습니까)[.?]?$`에 맞아야 한다.
- 한 문장이어야 한다: 끝이 아닌 곳에 `?`, `!`, 또는 한글 뒤·빈칸 앞의 `.`(`입니다. 그때`)가 있으면 안 된다(`not_one_sentence`). `3.5초`, `Node.js`, `vs. `는 문장 끝으로 보지 않는다.
- 원래 질문을 되풀이하면 안 된다: 빈칸과 문장 부호를 뺀 출력이 질문과 같거나 질문 전체를 품으면 버린다(`repeats_question`). 빈칸·문장 부호를 뺀 질문이 8자보다 짧으면(직접 입력한 "자기소개" 등) 같을 때만 버린다.
- 다음 낱말이 들어 있으면 안 된다: `감정`, `기분`, `외모`, `성격`, `자신감`, `표정`, `느낌`, `심정`.
- 출력의 숫자열은 모두 질문이나 전사문에 있어야 한다.
- 실패 사유 코드: `empty`, `not_korean`, `length`, `not_question`, `not_one_sentence`, `repeats_question`, `forbidden`, `invented_number`.

**커밋:** 영어 Conventional Commits. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다. push는 하지 않는다.

**테스트 명령**
- `cd backend && .venv/bin/python -m pytest -q`
- 프런트(`frontend/`에서):
  - `npx playwright test -c playwright.unit.config.ts`
  - `PATH="$PWD/../backend/.venv/bin:$PATH" npx playwright test -c playwright.practice-track.config.ts`
  - `npm run build`

## Review Focus

1. **모델을 쓸 수 없을 때도 꼬리질문은 나와야 한다.** 해당 경우: `llama-cpp-python`이 없음, 모델 내려받기 실패, 네트워크 없음. 이때 고정 문장으로 바로 대신하고, `/health.followup`은 `available:false`와 사유를 보인다. → Task 2 `missing_library_falls_back` · `download_failure_falls_back`.
2. **시간 상한:** 모델이 느리거나 멈춰도 사용자는 `FOLLOWUP_TIMEOUT_SEC` 안에 고정 문장을 받는다. 그다음 요청은 앞 생성이 끝난 뒤 정상 처리된다. → Task 2 `slow_generation_times_out_to_template`.
3. **동시 요청:** 같은 답변에 꼬리질문 요청이 동시에 두 번 와도 꼬리질문은 하나만 생긴다. → Task 4 `concurrent_followup_requests_create_one_question`.
4. **이상한 출력:** 모델이 영어로 답하거나, 없는 수치를 지어내거나, 감정·성격을 물으면 그 문장을 버리고 고정 문장을 쓴다. → Task 1 검증 테스트들.
5. **아주 긴 답변:** 15분짜리 전사문이 와도 입력이 잘려 `n_ctx`를 넘지 않고 오류가 나지 않는다. → Task 1 `long_transcript_is_truncated`.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| Create `backend/app/followup_text.py` | 프롬프트 메시지 만들기, 출력 정리·검증 (순수) |
| Create `backend/app/followup_model.py` | 모델 로딩·재사용·직렬화·시간 상한·상태 |
| Modify `backend/app/config.py`, `backend/.env.example` | `FOLLOWUP_*` 설정 |
| Modify `backend/app/main.py` | `/health.followup`, 미리 불러오기(lifespan) |
| Modify `backend/app/routers/practice.py` (`followup` 엔드포인트 ~779) | 잠금 전에 생성 시도, 성공하면 그 문장을 쓴다 |
| Modify `backend/tests/conftest.py` | `FOLLOWUP_MODEL=off`, `fake_followup` fixture |
| Create `backend/requirements-followup.txt` | `llama-cpp-python`, `huggingface-hub` |
| Create `backend/evals/followup_probe.py` | 실제 모델 시험(사람이 읽는 표) |
| Create `docs/practice-track/followup-model-check.md` | 시험 결과·모델 결정·라이선스 표기 |
| Modify `frontend/src/features/practice-track/pages/SessionRunner.tsx` | 꼬리질문을 만드는 동안 상태 표시 |
| Tests | `backend/tests/test_followup_text.py`, `test_followup_model.py`, `test_followup_endpoint.py`, `frontend/e2e/practice-track/runner.spec.ts` |

---

### Task 1: 프롬프트와 출력 검증 (순수 함수)

**Files:**
- Create: `backend/app/followup_text.py`
- Test: `backend/tests/test_followup_text.py`

**Interfaces:**
- Produces:

```python
MAX_TRANSCRIPT_CHARS = 1200
MAX_QUESTION_CHARS = 300   # 최종 리뷰에서 더함
FORBIDDEN = ("감정", "기분", "외모", "성격", "자신감", "표정", "느낌", "심정")   # 느낌·심정은 최종 리뷰에서 더함
def build_messages(question: str, transcript: str, focus: str) -> list[dict]   # [{"role":"system",...},{"role":"user",...}]
def validate_followup(raw: str, question: str, transcript: str) -> tuple[str | None, str | None]  # (정리된 문장, 실패 사유 코드)
```

- [ ] **Step 1: 실패하는 테스트**

```python
def test_valid_korean_question_is_cleaned():
    text, reason = validate_followup('꼬리질문: "그 일정 조정에서 본인이 맡은 역할은 무엇이었나요?"\n다음 줄', "갈등 경험", "일정을 다시 나눴습니다")
    assert reason is None and text == "그 일정 조정에서 본인이 맡은 역할은 무엇이었나요?"

@pytest.mark.parametrize("raw,code", [
    ("", "empty"),
    ("What was your role in that project?", "not_korean"),
    ("왜요?", "length"),
    ("그 프로젝트에서 본인이 맡은 역할을 설명했습니다.", "not_question"),
    ("그때 기분은 어떠셨나요?", "forbidden"),
    ("매출을 37% 올렸다고 하셨는데 어떻게 측정했나요?", "invented_number"),
])
def test_bad_outputs_are_rejected(raw, code):
    assert validate_followup(raw, "성과를 말해 주세요", "매출을 올렸습니다") == (None, code)

def test_numbers_from_the_answer_are_allowed():
    text, reason = validate_followup("마감 2일 전에 끝낸 방법을 구체적으로 설명해 주세요.", "q", "마감 2일 전에 완성했습니다")
    assert reason is None and text.endswith("주세요.")

def test_long_transcript_is_truncated():
    msgs = build_messages("질문", "가" * 20000, "specificity")
    assert len(msgs) == 2 and msgs[0]["role"] == "system"
    assert msgs[1]["content"].count("가") <= MAX_TRANSCRIPT_CHARS

def test_prompt_states_the_rules():
    system = build_messages("q", "a", "specificity")[0]["content"]
    for rule in ("한 문장", "지어내지", "감정"):
        assert rule in system
```

- [ ] **Step 2: 실패 확인**
  - Run: `cd backend && .venv/bin/python -m pytest -q tests/test_followup_text.py`
  - Expected: FAIL (모듈 없음).
- [ ] **Step 3: 구현**
  - system 메시지(한국어)에 들어갈 내용:
    - 역할: 면접관.
    - 출력 형식: 꼬리질문 한 문장만, 존댓말, 물음표나 "~해 주세요"로 끝남.
    - 금지: 답변·질문에 없는 사실이나 수치를 지어내지 않는다. 감정·외모·성격·자신감을 묻지 않는다.
    - 초점: `focus`에 맞는 설명 한 줄. `specificity`이면 "답변 속 상황·본인 행동·결과 중 빠진 것을 더 묻는다". 그 밖의 값이면 일반 문장.
  - user 메시지: `질문: …\n답변: …(앞 1,200자)`.
  - `validate_followup`은 Global Constraints의 순서대로 검사한다.
- [ ] **Step 4: 통과 확인** (위 명령). Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): build follow-up prompts and validate model output`

### Task 2: 모델 실행기 (로딩·직렬화·시간 상한·상태)

**Files:**
- Create: `backend/app/followup_model.py`
- Modify: `backend/app/config.py`(`Settings`에 `FOLLOWUP_*`), `backend/.env.example`, `backend/app/main.py`(`/health` 응답에 `followup`, lifespan의 `FOLLOWUP_PRELOAD`), `backend/tests/conftest.py`(`os.environ["FOLLOWUP_MODEL"]="off"`, fixture `fake_followup`)
- Create: `backend/requirements-followup.txt`
- Test: `backend/tests/test_followup_model.py`

**Interfaces:**
- Consumes: Task 1의 `build_messages`, `validate_followup`.
- Produces:

```python
@dataclass
class FollowupResult:
    text: str | None            # 검증을 통과한 한국어 꼬리질문, 실패면 None
    fallback_reason: str | None  # "off" | "unavailable" | "timeout" | "error" | validate 사유 코드
    elapsed_ms: int
def status() -> dict           # {"mode": "local"|"off", "available": bool, "model": str|None, "state": "idle"|"loading"|"ready"|"error", "error": str|None}
def generate(question: str, transcript: str, focus: str) -> FollowupResult
def preload() -> None          # FOLLOWUP_PRELOAD일 때 lifespan이 부른다. 실패해도 예외를 밖으로 던지지 않는다
def _loader()                  # 테스트가 바꿔 끼우는 지점: (settings) -> 객체(create_chat_completion(messages, max_tokens, temperature) -> dict)
```

- `/health` 응답은 `{"ok", "stt", "auth_disabled", "followup": status()}`가 된다.
- conftest의 `fake_followup(monkeypatch) -> FakeFollowup`:
  - 필드: `reply: str | Exception`, `delay: float`, `calls: list`.
  - 동작: `settings.followup_model = "local"`로 두고 `_loader`를 바꿔 끼운다.

- [ ] **Step 1: 실패하는 테스트**
  - `off_mode_returns_off_without_loading`: `FOLLOWUP_MODEL=off`면 `generate(...)`가 `FollowupResult(None, "off", …)`이고 로더를 부르지 않는다.
  - `valid_reply_is_returned`: fake가 `"그때 본인이 맡은 역할은 무엇이었나요?"`를 내면 `text`가 그 문장이고 `fallback_reason`은 None이다.
  - `invalid_reply_reports_reason`: fake가 영어 문장을 내면 `fallback_reason == "not_korean"`.
  - `missing_library_falls_back`: 로더가 `ImportError`를 내면 `fallback_reason == "unavailable"`이고, `status()["available"]`은 False이며 error에 사유가 들어 있다.
  - `download_failure_falls_back`: 로더가 `OSError`를 내면 같은 처리다. 같은 결과를 매번 다시 내려받으려 하지 않는다(실패 후 다시 부르면 로더 호출이 1회 그대로).
  - `slow_generation_times_out_to_template`:
    1. `FOLLOWUP_TIMEOUT_SEC=0.2`, fake `delay=1.0`으로 둔다.
    2. 첫 `generate`가 0.5초 안에 `"timeout"`으로 돌아온다.
    3. 1초 뒤 두 번째 요청은 정상 결과를 받는다.
    4. 생성은 한 번에 하나다. `calls`가 겹치지 않음을 시작·끝 시각으로 확인한다.
  - `loads_once_and_reuses`: `generate`를 세 번 불러도 로더 호출은 1회다.
  - `health_reports_followup_status`: `GET /health`에 `followup` 키가 있고 `mode`, `available`이 있다.
- [ ] **Step 2: 실패 확인**
  - Run: `cd backend && .venv/bin/python -m pytest -q tests/test_followup_model.py`
  - Expected: FAIL.
- [ ] **Step 3: 구현**
  - 로딩: 잠금으로 보호한 지연 로딩이다.
  - 직렬화: `threading.Semaphore(1)`을 쓴다. 남은 시간 동안만 acquire를 기다리고, 시간 안에 못 얻으면 `"timeout"`.
  - 생성: 작업 스레드에서 실행하고 `join(timeout=남은 시간)`으로 기다린다. 시간이 넘으면 `"timeout"`을 돌려준다. 스레드는 끝까지 돌고 마지막에 세마포어를 놓는다.
  - 기본 로더(`_loader`): 캐시 먼저 찾는다. `huggingface_hub.hf_hub_download(repo_id, filename, cache_dir=FOLLOWUP_MODEL_DIR or None, local_files_only=True)`로 캐시에 있는 파일 경로를 얻고, 그 파일을 `llama_cpp.Llama(model_path=…, n_ctx=1536, n_threads=FOLLOWUP_THREADS, n_threads_batch=FOLLOWUP_THREADS, verbose=False)`로 연다. (n_ctx는 Task 3에서 1024→1536)
    - 캐시에 없을 때만 `local_files_only` 없이 한 번 내려받는다(`FOLLOWUP_ALLOW_DOWNLOAD=true`일 때). `false`면 내려받지 않고 불러오기 실패(`unavailable`, /health에 이유)로 끝난다.
    - `Llama.from_pretrained`는 쓰지 않는다. 불러올 때마다 저장소 목록을 온라인으로 확인해서, 파일이 캐시에 있어도 시작할 때마다 Hugging Face에 접속하고 오프라인이면 실패한다.
  - 생성 호출: `create_chat_completion(messages, max_tokens=96, temperature=0.1)`(Task 3에서 0.3→0.1)의 `choices[0]["message"]["content"]`를 `validate_followup`에 넣는다.
  - `requirements-followup.txt`: 첫 줄에 `--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu`, 그다음 `llama-cpp-python>=0.3.36`(EXAONE 4로 시험한 버전, 최종 리뷰에서 0.3에서 올림), `huggingface-hub>=0.24`.
  - `.env.example`: `FOLLOWUP_*` 설정을 각 한 줄 설명과 함께 넣는다.
- [ ] **Step 4: 통과 확인.** 위 명령과 전체 `pytest -q`. Expected: 전체 PASS(`test_no_external_calls` 포함).
- [ ] **Step 5: Commit** `feat(backend): run a local follow-up model with lazy loading, one-at-a-time and a time limit`

### Task 3: 실제 모델 시험과 기본 모델 결정

**Files:**
- Create: `backend/evals/followup_probe.py`
- Create: `docs/practice-track/followup-model-check.md`
- Modify: `backend/app/config.py`(기본 `FOLLOWUP_MODEL_REPO`·`FILE`을 결정값으로), `backend/.env.example`

**Interfaces:**
- Consumes: Task 1·2의 `build_messages`, `validate_followup`, `generate` 경로.
- Produces: 기본 모델 값(설정 기본값), 결과 문서.

- [ ] **Step 1: 설치.** `cd backend && .venv/bin/pip install -r requirements-followup.txt`.
  - Expected: 설치 성공, `python -c "import llama_cpp; print(llama_cpp.__version__)"`가 버전을 출력한다.
  - 사전 빌드 wheel이 없어서 컴파일이 실패하면 멈추고 BLOCKED로 보고한다.
- [ ] **Step 2: 시험 스크립트 `followup_probe.py`**
  - 인자: `--repo --file --threads 2`.
  - 고정 샘플: 질문·답변 쌍 10개(한국어, 다양한 길이와 유형). 다음을 반드시 포함한다:
    - 수치가 있는 답변
    - 수치가 없는 답변
    - 아주 짧은 답변
    - 1,500자 넘는 답변
    - 팀 경험("우리") 답변
  - 출력: 샘플마다 원문 출력, 검증 결과(문장 또는 사유), 걸린 시간(ms). 그리고 첫 로딩 시간, 평균·최대 생성 시간, 통과 수.
  - 결과는 마크다운 표로 stdout에 낸다.
- [ ] **Step 3: 후보 순서대로 실행.**
  - 명령: `.venv/bin/python evals/followup_probe.py --repo <repo> --file <file> --threads 2`
  - 첫 통과 조건: 불러오기 성공, 10개 중 7개 이상 검증 통과, 평균 생성 20초 이하.
  - 조건을 만족하는 첫 모델을 기본값으로 정한다. 세 후보가 모두 실패하면 멈추고 BLOCKED로 보고한다(결과 표 첨부).
- [ ] **Step 4: 결과 문서 `followup-model-check.md`** 에 담을 것:
  - 시험 환경: CPU, 스레드 2, RAM, Git SHA.
  - 후보별 결과 표와 통과 모델의 샘플 10개 출력 원문. **사람이 읽고 쓸 만한지 판단하는 칸**을 비워 둔다.
  - 결정한 기본 모델과 이유.
  - 라이선스와 표기 의무. 통과 모델의 모델 카드에서 라이선스 이름과 표기 요구를 옮겨 적는다.
  - 품질을 자동 점수로 주장하지 않는다는 문장.
- [ ] **Step 5: 기본값 반영.** `config.py`와 `.env.example`의 기본 `FOLLOWUP_MODEL_REPO`·`FILE`을 결정값으로 바꾸고, 전체 pytest를 실행한다. Expected: PASS.
- [ ] **Step 6: Commit** `chore(backend): pick the default follow-up model from a local probe`

### Task 4: 꼬리질문 엔드포인트 연결과 화면의 기다림 표시

**Files:**
- Modify: `backend/app/routers/practice.py`(`followup`, ~779-830)
- Modify: `frontend/src/features/practice-track/pages/SessionRunner.tsx`(꼬리질문 요청 중 상태)
- Test: `backend/tests/test_followup_endpoint.py`, `frontend/e2e/practice-track/runner.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `followup_model.generate(question, transcript, focus) -> FollowupResult`.
- Produces: 엔드포인트 응답 형식은 그대로다(`SessionOut`).

- [ ] **Step 1: 실패하는 테스트** (`test_followup_endpoint.py`, `fake_followup` 사용)
  - `generated_question_is_used`: fake가 유효 문장을 내면 새 꼬리질문의 `question.text`가 그 문장이고, 부모 연결은 지금과 같다. `followup_reason`은 고정 문장의 이유 대신 "This follow-up was written from your answer."다(화면이 질문 위에 보여 주는 설명이라, 고정 문장의 이유를 두면 질문과 맞지 않는다. 최종 리뷰에서 바꿈). 고정 문장을 쓸 때의 이유는 그대로다.
  - `invalid_or_off_uses_template`: fake가 영어를 내거나 `off`면 새 질문이 기존 고정 문장(`followup.text`)과 같다.
  - `model_is_not_called_under_the_session_lock`:
    - `answer_coaching.lock_session`을 monkeypatch해 호출 순서를 기록한다. fake 모델 호출 시각도 함께 기록한다.
    - 모델 호출이 `lock_session`보다 먼저, 한 번 일어났는지 확인한다.
  - `concurrent_followup_requests_create_one_question`:
    - 같은 답변에 두 요청을 동시에 보낸다(fake `delay` 0.3초, 스레드 2개).
    - 꼬리질문 자식은 1개, 두 응답 모두 201이다.
  - `existing_followup_skips_generation`: 이미 꼬리질문이 있으면 모델을 부르지 않는다(`calls` 0).
- [ ] **Step 2: 실패 확인**
  - Run: `cd backend && .venv/bin/python -m pytest -q tests/test_followup_endpoint.py`
  - Expected: FAIL.
- [ ] **Step 3: 엔드포인트 구현.** 아래 흐름을 지킨다.

```
기존 검사(종료·전사문·사용 여부·중복 부모·이미 자식 있음) → 보고서 없으면 _report
suggestion = current_report(a)["followup"]
r = followup_model.generate(a.question.text, a.transcript, suggestion["focus"])   # 잠금 전
text = r.text or suggestion["text"]
lock_session → 재검사(기존 코드) → Question(text=text, …) 생성 → commit
log.info("followup generated=%s reason=%s ms=%d", r.text is not None, r.fallback_reason, r.elapsed_ms)
```

- [ ] **Step 4: 화면의 기다림 표시 (e2e 먼저)**
  - `runner.spec.ts`에 `asking for a follow-up shows a waiting status`를 추가한다.
    1. `POST **/followup`을 1.5초 지연시킨다(route).
    2. 그동안 `role="status"`에 `Preparing a follow-up question…`이 보인다.
    3. `Ask a Follow-up`과 `Next Question`이 비활성이다.
    4. 끝나면 새 질문(`lang="ko"`)이 보인다.
  - 실행해서 실패를 확인한 뒤 구현한다. 문구 규칙에 맞춰 짧게 쓴다.
- [ ] **Step 5: 통과 확인.** 위 pytest와 `runner.spec.ts`·`coaching.spec.ts`(desktop·mobile), 전체 pytest, unit, `npm run build`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(practice): ask the local model for follow-up questions with a template fallback`
