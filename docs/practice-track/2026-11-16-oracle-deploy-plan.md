# 무료 서버 배포 준비 (B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 Oracle 상시 무료 ARM 서버를 만들고 명령 몇 개만 실행하면, 연습 API가 `https://<이름>.duckdns.org`에서 돈다. 전사와 꼬리질문 모델은 메모리에 늘 올라와 있고, 재부팅해도 다시 뜬다.

**Architecture:**
- 서버: Ubuntu 24.04 aarch64. 코드는 `/opt/jobseeker`(git clone), 설정은 `/etc/jobseeker/api.env`, 모델 캐시와 녹음은 `/var/lib/jobseeker`에 둔다.
- `uvicorn`(작업자 1개, `127.0.0.1:8000`)을 systemd 서비스로 띄운다. Caddy가 앞에서 자동 인증서를 받아 https로 넘긴다.
- 설치는 `scripts/practice-track/deploy/install.sh` 하나가 한다. 다시 실행하면 업데이트가 된다. 끝난 뒤 `check_server.py`가 서비스·모델·https·CORS·메모리를 점검한다.
- 실제 가입과 서버 생성은 사용자가 한다(설계 B4). 이 계획은 코드·스크립트·문서만 만든다.

**Tech Stack:** FastAPI, uvicorn, systemd, Caddy 2.11.6 이상(공식 apt 저장소), DuckDNS, bash, Python 3.12(서버 기본), pytest.

**Spec:** `docs/practice-track/2026-11-14-local-ai-gaze-direction-design.md` 2절(제약)과 4.2절 **B4**. 꼬리질문 모델 결정은 `docs/practice-track/followup-model-check.md`.

**조사로 정한 것 (이 계획의 결정, 근거)**
- **ARM 빌드는 필요 없다.** 잠긴 패키지 52개(`requirements-lock.txt`)와 `llama-cpp-python` 0.3.36 모두 cp312 manylinux aarch64 wheel이 있다(2026-11-16 PyPI·abetlen 색인 확인). 그래도 서버 CPU에서 불러오지 못할 때를 위해 소스 빌드 명령을 문서의 문제 해결에 둔다.
- **도메인은 DuckDNS.** sslip.io·nip.io는 Public Suffix List에 없어서, 그 도메인을 쓰는 모든 사람이 Let's Encrypt 발급 한도를 함께 쓴다. duckdns.org는 목록에 있어 하위 도메인마다 한도가 따로다.
- **Supabase DB는 세션 풀러 주소.** 무료 플랜의 직결 주소(`db.<ref>.supabase.co`)는 IPv6 전용이고, Oracle VM은 기본이 IPv4다. 세션 풀러(`aws-…pooler.supabase.com:5432`)는 IPv4다.
- **`postgresql://` 주소를 그대로 받는다.** Supabase가 주는 주소는 `postgresql://…`인데, SQLAlchemy는 이 꼴을 psycopg2로 연다. 이 앱은 psycopg 3만 설치한다. 그래서 설정에서 `postgresql+psycopg://`로 바꾼다.
- **회수 방지는 메모리로.** Oracle 공식 문서: 7일 동안 CPU(95번째 백분위수)·네트워크·메모리(A1만) 사용률이 **모두** 20% 미만이면 회수될 수 있다. 사용자가 없을 때 CPU·네트워크는 20%를 넘지 않으므로 메모리가 기준이다.
  - 이 PC에서 잰 상주 메모리: 앱 77 MB, Whisper base int8 포함 310 MB, EXAONE까지 1.75 GB.
  - 인스턴스를 **2 OCPU / 6 GB**로 만든다. 1.75 GB에 OS를 더하면 6 GB의 30%를 넘는다. 12 GB 전부를 쓰면 20%(2.4 GB) 근처라 위험하다.
  - Oracle 지표가 파일 캐시를 "사용 중"으로 세는지 문서에 없다. 그래서 GGUF를 mmap하지 않고 메모리에 바로 읽는다(`use_mmap=False`). 메모리 총량은 같다.
  - 전사 모델도 시작할 때 미리 불러 둔다(`LOCAL_STT_PRELOAD`).
- **프록시 시간 상한.** Caddy 2.11.6부터 응답 쓰기가 1분 동안 진전이 없으면 연결을 끊는다(`write_idle` 기본 1m). 전사는 업로드 요청 안에서 돌아 1분을 넘을 수 있으므로 `write_idle 10m`으로 둔다. 그래서 Caddy는 2.11.6 이상이어야 한다.
- **Oracle Ubuntu 이미지의 iptables.** 기본 규칙에 모든 것을 거부하는 REJECT 줄이 있다. 80·443 허용 규칙을 그 줄 **앞에** 넣고 `netfilter-persistent save`로 저장한다. VCN 보안 목록에서도 80·443을 열어야 한다(사용자 일).

## Global Constraints

**범위**
- 팀 소유 파일은 수정하지 않는다: 저장소 루트 `README.md`, `frontend/` 전체, `extension-track/`, `supabase/`. 이 계획은 `backend/`, `scripts/practice-track/`, `docs/practice-track/`만 바꾼다.
- 외부 유료 API를 쓰지 않는다. 허용하는 외부 요청은 패키지 설치, Caddy 저장소, Hugging Face 모델 파일 처음 한 번, Let's Encrypt 인증서뿐이다.
- 비밀값(DB 비밀번호, service role key, JWT secret)을 저장소에 넣지 않는다. `api.env.example`에는 `<…>` 자리표시만 둔다.
- 테스트는 실제 서버·root 권한·네트워크 없이 돈다. 실제 계정은 쓰지 않는다.

**서버 배치 (모든 파일이 이 값을 쓴다)**

| 항목 | 값 |
|---|---|
| OS | Ubuntu 24.04 LTS aarch64, Python 3.12 |
| 인스턴스 | `VM.Standard.A1.Flex`, 2 OCPU, 6 GB |
| 서비스 사용자 | `jobseeker` (system 계정, 로그인 셸 없음) |
| 코드 | `/opt/jobseeker` (root 소유), 가상환경 `/opt/jobseeker/backend/.venv` |
| 설정 | `/etc/jobseeker/api.env` (root:jobseeker, 0640) |
| 데이터 | `/var/lib/jobseeker` (jobseeker, 0750), 모델 캐시 `/var/lib/jobseeker/hf`(`HF_HOME`), 녹음 `/var/lib/jobseeker/recordings` |
| API | systemd `jobseeker-api.service`, `uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1` |
| 프록시 | Caddy, `/etc/caddy/Caddyfile`, 요청 본문 최대 30MB(API 녹음 한도 25MB), `write_idle 10m` |
| 도메인 | `<이름>.duckdns.org` |
| 스레드 | `LOCAL_STT_CPU_THREADS=2`, `FOLLOWUP_THREADS=2` |

**배포 설정값 (`api.env.example`)**
- `APP_ENV=production`, `AUTH_DISABLED=false`, `SUPABASE_JWT_MODE=jwks`
- `STT_PROVIDER=local`, `LOCAL_STT_MODEL=base`, `LOCAL_STT_PRELOAD=true`
- `FOLLOWUP_MODEL=local`, `FOLLOWUP_PRELOAD=true`, `FOLLOWUP_TIMEOUT_SEC=45`
- `PRACTICE_INSIGHTS_ENABLED=false` (Supabase migration은 A2에서 적용한 뒤 켠다)
- 내려받기 허용 값은 기본(true) 그대로 둔다. 캐시가 비었으면 시작할 때 한 번 받는다.

**언어**
- 스크립트 출력, 로그, 오류 문장은 영어다(앞 묶음의 규칙). 사용자용 배포 문서는 한국어다.

## Review Focus

1. **업데이트하려고 `install.sh`를 다시 실행한다.** 채워 둔 `api.env`를 덮어쓰지 않아야 한다. 방화벽 규칙도 두 번 넣지 않아야 한다. → Task 3 `test_rerun_keeps_a_filled_env_file`, iptables는 `iptables -C` 확인 뒤에만 넣는다.
2. **Supabase가 준 주소 `postgresql://…`나 `postgres://…`를 붙여 넣는다.** 그대로 연결돼야 한다. → Task 1 `test_supabase_uri_uses_psycopg`.
3. **시작할 때 모델을 못 불러온다**(내려받기 실패, ARM CPU 문제). API는 떠 있어야 하고, 점검 도구가 그 사실과 회수 위험(메모리 20% 미만)을 알려야 한다. → Task 4 `test_model_errors_fail`, `test_low_memory_warns_about_reclaim`.
4. **긴 녹음을 올리거나 꼬리질문이 45초 걸린다.** 프록시가 중간에 끊으면 안 된다. → Task 3 `test_caddyfile_has_the_domain_and_long_write_idle`.
5. **서버가 재부팅된다.** API와 Caddy가 다시 떠야 한다. → Task 3 `test_service_unit_restarts_and_starts_at_boot`, 설치가 두 서비스를 `enable`한다.

---

### Task 1: 설정과 시작 동작 (DB 주소, 전사 모델 미리 불러오기)

**Files:**
- Modify: `backend/app/config.py`, `backend/app/stt.py`, `backend/app/main.py`, `backend/.env.example`
- Test: `backend/tests/test_config.py`, `backend/tests/test_local_stt.py`

**Interfaces:**
- Produces:
  - `config.sqlalchemy_url(url: str) -> str`: `postgres://`·`postgresql://`로 시작하면 `postgresql+psycopg://`로 바꾼다. 그 밖의 주소(`sqlite:///…`, `postgresql+psycopg://…`)는 그대로 둔다. `Settings.database_url`이 이 값을 쓴다.
  - `Settings.local_stt_preload: bool`: 환경 변수 `LOCAL_STT_PRELOAD`, 기본 `false`.
  - `stt.preload() -> None`: 로컬 전사 모델을 불러온다. 예외를 던지지 않는다(실패는 기존 `model()`이 로그와 상태로 남긴다).
  - 앱 시작(`lifespan`): `local_stt_preload`이고 `stt_provider == "local"`이면 `stt-preload` 스레드(daemon)에서 `stt.preload()`를 돌린다. 시작을 막지 않는다(꼬리질문 미리 불러오기와 같은 방식).

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `test_supabase_uri_uses_psycopg`: `Settings({"DATABASE_URL": u, "AUTH_DISABLED": "true"}).database_url`이 다음과 같다.
    - `postgresql://postgres.ref:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres` → `postgresql+psycopg://postgres.ref:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`
    - `postgres://u:p@h:5432/db` → `postgresql+psycopg://u:p@h:5432/db`
    - `postgresql+psycopg://u@h/db`와 `sqlite:///x.db`는 그대로
  - `test_stt_preload_defaults_off_and_reads_env`: 기본 `False`, `LOCAL_STT_PRELOAD=true`이면 `True`.
  - `test_stt_preload_loads_the_model_once_and_never_raises`: 로컬 제공자의 `model`을 세는 가짜로 바꿔 `stt.preload()`를 부르면 한 번 불린다. 가짜가 `STTError`를 던져도 `preload()`는 예외 없이 끝난다.
  - `test_startup_preloads_stt_when_asked`: `local_stt_preload=True`, `stt_provider="local"`에서 `TestClient(app)`로 앱을 띄우면 `stt.preload`가 불린다(가짜로 바꿔 Event로 확인, 최대 5초). `False`이면 불리지 않는다.
- [ ] **Step 2: 테스트가 실패하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q tests/test_config.py tests/test_local_stt.py`
  Expected: 위 네 테스트가 FAIL(속성·함수 없음)
- [ ] **Step 3: 구현한다**
  - `.env.example`의 `DATABASE_URL` 설명에 Supabase **세션 풀러** 주소를 쓰라고 적는다(IPv4 서버, 직결 주소는 IPv6 전용). `postgresql://`를 그대로 붙여도 된다고 적는다.
  - `.env.example`에 `LOCAL_STT_PRELOAD=false`를 `FOLLOWUP_PRELOAD`처럼 설명과 함께 넣는다("배포에서는 true").
- [ ] **Step 4: 테스트가 통과하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q`
  Expected: 전부 PASS
- [ ] **Step 5: 커밋**
  `git commit -m "feat(backend): accept Supabase postgresql:// URLs and preload the speech model on request"`

### Task 2: 꼬리질문 모델을 서버에 맞추기 (mmap 없이 불러오기, 미리 받기 명령, 버전 고정)

**Files:**
- Modify: `backend/app/followup_model.py`, `backend/requirements-lock.txt`, `backend/.env.example`
- Test: `backend/tests/test_followup_model.py`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `_loader`가 `Llama(..., use_mmap=False)`로 연다. 주석에 이유(회수 기준의 메모리 사용률, 유휴 뒤 페이지 다시 읽기)를 적는다.
  - `_cli(argv: list[str]) -> int`: 아래 명령의 본체(테스트 대상). `__main__`은 `sys.exit(_cli(sys.argv[1:]))`만 한다.
  - `python -m app.followup_model download`: `FOLLOWUP_ALLOW_DOWNLOAD`와 상관없이 캐시에 없으면 받고, llama.cpp로 한 번 불러 본다. 성공하면 `ready: <repo>/<file>`을 출력하고 0으로 끝난다. 실패하면 `_describe(e)` 문장을 stderr에 쓰고 1로 끝난다. 다른 인자면 `usage: python -m app.followup_model download`, 종료 코드 2.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - 기존 `test_default_loader_uses_the_cache_without_downloading`의 기대값에 `"use_mmap": False`를 더한다.
  - `test_download_command_fetches_even_when_downloads_are_off`: `libs` 가짜(캐시 없음)와 `followup_allow_download=False`에서 명령의 진입 함수(`_cli(argv: list[str]) -> int`)를 `["download"]`로 부르면 내려받기 호출이 `local_files_only=False`까지 가고, 반환값 0, 출력에 `ready: LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF/EXAONE-4.0-1.2B-Q4_K_M.gguf`.
  - `test_download_command_reports_a_load_failure`: 가짜 `Llama`가 예외를 던지면 반환값 1, stderr에 `could not be loaded`.
  - `test_download_command_rejects_other_arguments`: `_cli([])`와 `_cli(["x"])`는 2.
- [ ] **Step 2: 테스트가 실패하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q tests/test_followup_model.py`
  Expected: 위 테스트가 FAIL
- [ ] **Step 3: 구현한다**
  - `if __name__ == "__main__": sys.exit(_cli(sys.argv[1:]))`.
  - `requirements-lock.txt`에 꼬리질문 묶음을 더한다(이 PC `.venv`에서 확인한 값): `llama-cpp-python==0.3.36`, `diskcache==5.6.3`, `Jinja2==3.1.6`, `MarkupSafe==3.0.4`. 주석으로 `requirements-followup.txt`와 짝임을 적는다.
  - `.env.example`의 꼬리질문 설명에 미리 받기 명령(`cd backend && .venv/bin/python -m app.followup_model download`)을 적는다.
- [ ] **Step 4: 테스트가 통과하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q`
  Expected: 전부 PASS
- [ ] **Step 5: 실제 모델로 명령을 한 번 돌린다**
  Run: `cd backend && HF_HUB_OFFLINE=1 .venv/bin/python -m app.followup_model download`
  Expected: `ready: LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF/EXAONE-4.0-1.2B-Q4_K_M.gguf` (캐시에 있음). 상주 메모리를 Task 4 문서에 적기 위해, mmap 없이 불러온 뒤의 RSS를 함께 잰다.
- [ ] **Step 6: 커밋**
  `git commit -m "feat(backend): load the follow-up model into memory and add a download command"`

### Task 3: 배포 파일 (설치 스크립트, 서비스, Caddy, 설정 틀)

**Files:**
- Create: `scripts/practice-track/deploy/install.sh`, `scripts/practice-track/deploy/jobseeker-api.service`, `scripts/practice-track/deploy/Caddyfile`, `scripts/practice-track/deploy/api.env.example`
- Test: `backend/tests/test_deploy_files.py`

**Interfaces:**
- Consumes: Task 1의 `LOCAL_STT_PRELOAD`, Task 2의 `python -m app.followup_model download`, 기존 `python -m app.stt download`
- Produces:
  - `install.sh <domain>`: root로 실행한다. 저장소 안에서 자기 위치로 코드 경로를 찾는다.
    - 도메인은 소문자 호스트 이름(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)이어야 한다. 아니거나 인자가 없으면 사용법을 쓰고 종료 코드 2.
    - `--files-only <domain>`: 설정 파일 배치만 한다(apt·pip·systemctl·iptables·모델 받기·`chown` 없음, root가 아니어도 됨). 경로 앞에 환경 변수 `JOBSEEKER_PREFIX`(기본 빈 값)를 붙인다. 테스트 전용.
    - 전체 실행에서 `JOBSEEKER_PREFIX`가 비어 있지 않거나 root가 아니면 멈춘다(종료 코드 2).
  - `Caddyfile`: 도메인 자리에 `@DOMAIN@`을 두고, `install.sh`가 바꿔 `/etc/caddy/Caddyfile`에 쓴다.
  - `api.env.example`: `install.sh`가 `/etc/jobseeker/api.env`가 **없을 때만** 복사한다.

`install.sh` 전체 실행 순서(각 단계는 다시 실행해도 같은 결과):
1. apt: `python3-venv python3-pip git curl debian-keyring debian-archive-keyring apt-transport-https iptables-persistent`(비대화식). Caddy 공식 저장소(Cloudsmith stable) 키와 목록을 추가하고 `caddy`를 설치한다. `caddy version`이 2.11.6보다 낮으면 멈춘다.
2. `jobseeker` system 사용자를 만든다(없을 때만).
3. 디렉터리와 권한: 위 "서버 배치" 표대로.
4. `api.env`: 없을 때만 틀을 복사한다.
5. 가상환경: `python3 -m venv`(없을 때만), `pip install -r requirements.txt -c requirements-lock.txt`, `pip install -r requirements-followup.txt -c requirements-lock.txt`. 이어서 `python -c "import llama_cpp"`로 불러오기를 확인한다.
6. 서비스 파일과 Caddyfile을 쓰고 `systemctl daemon-reload`, `enable caddy jobseeker-api`, `reload caddy`.
7. 방화벽: 80·443 허용 규칙이 없을 때만(`iptables -C`) INPUT의 첫 REJECT 줄 앞에 넣고 `netfilter-persistent save`.
8. 모델 미리 받기: `systemd-run --wait --pipe --collect -p User=jobseeker -p WorkingDirectory=/opt/jobseeker/backend -p EnvironmentFile=/etc/jobseeker/api.env --setenv=HF_HOME=/var/lib/jobseeker/hf` 로 `python -m app.stt download`와 `python -m app.followup_model download`를 돌린다. 서비스와 같은 환경·사용자·캐시를 쓰려는 것이다.
9. `api.env`에 아직 `<`가 남아 있으면 API를 시작하지 않고 "Fill /etc/jobseeker/api.env, then run: sudo systemctl restart jobseeker-api"를 출력한다. 다 채워졌으면 `restart jobseeker-api`.
10. 마지막에 점검 명령(Task 4)을 안내한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`install.sh`는 `subprocess`로 `bash install.sh --files-only …`, `JOBSEEKER_PREFIX=tmp_path`)
  - `test_files_only_places_the_files`: `example.duckdns.org`로 실행하면 종료 코드 0. `tmp/etc/caddy/Caddyfile`, `tmp/etc/systemd/system/jobseeker-api.service`, `tmp/etc/jobseeker/api.env`가 생긴다. `api.env` 권한은 0640.
  - `test_caddyfile_has_the_domain_and_long_write_idle`: 렌더링한 Caddyfile에 `example.duckdns.org {`, `reverse_proxy 127.0.0.1:8000`, `write_idle 10m`, `max_size 30MB`가 있고 `@DOMAIN@`은 없다.
  - `test_rerun_keeps_a_filled_env_file`: 첫 실행 뒤 `api.env`를 바꿔 두고 다시 실행하면 내용이 그대로다.
  - `test_bad_or_missing_domain_is_refused`: 인자 없음, `"Bad Domain"`, `"http://x.duckdns.org"`는 종료 코드 2이고 파일을 만들지 않는다.
  - `test_service_unit_restarts_and_starts_at_boot`: 서비스 파일에 `User=jobseeker`, `EnvironmentFile=/etc/jobseeker/api.env`, `Environment=` 안에 `HF_HOME=/var/lib/jobseeker/hf`, `ExecStart=`에 `--host 127.0.0.1 --port 8000 --workers 1`, `Restart=on-failure`, `WantedBy=multi-user.target`, `ReadWritePaths=/var/lib/jobseeker`.
  - `test_env_template_names_are_settings`: `api.env.example`의 모든 키가 `backend/app/config.py`가 읽는 이름이다(`env.get("NAME"`과 `_number(env, "NAME"`을 소스에서 모아 비교). 오타 방지.
  - `test_env_template_passes_the_production_check`: 틀을 읽어 `<…>` 자리표시를 그럴듯한 가짜 값으로 바꾼다(`SUPABASE_URL=https://example.supabase.co` 등). 그 값으로 만든 `Settings(env)`는 `check()`를 통과하고, `app_env == "production"`, `auth_disabled is False`, `followup_preload`와 `local_stt_preload`가 `True`, `cors_origins`에 `localhost`가 없다.
- [ ] **Step 2: 테스트가 실패하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q tests/test_deploy_files.py`
  Expected: FAIL(파일 없음)
- [ ] **Step 3: 네 파일을 만든다** (위 Interfaces와 실행 순서대로. `set -euo pipefail`, 함수로 나눔)
- [ ] **Step 4: 테스트가 통과하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q`
  Expected: 전부 PASS
- [ ] **Step 5: 셸 검사와 Caddy 설정 검사**
  - `bash -n scripts/practice-track/deploy/install.sh`
  - shellcheck v0.10.0 정적 바이너리(GitHub 릴리스)를 scratch 폴더에 받아 `shellcheck scripts/practice-track/deploy/install.sh` → 경고 없음
  - Caddy v2.11.9 linux_amd64(GitHub 릴리스)를 scratch 폴더에 받아, 테스트가 렌더링한 Caddyfile로 `caddy adapt --adapter caddyfile --config <파일>` → JSON이 나오고 오류 없음
  - 받은 도구는 저장소에 넣지 않는다.
- [ ] **Step 6: 커밋**
  `git commit -m "feat(deploy): add the Oracle ARM install script, API service, Caddy config and env template"`

### Task 4: 배포 점검 도구와 사용자 문서

**Files:**
- Create: `scripts/practice-track/deploy/check_server.py`, `docs/practice-track/deploy-oracle.md`
- Modify: `docs/practice-track/2026-11-14-local-ai-gaze-direction-design.md` (B4 끝에 "구현: 이 계획과 deploy-oracle.md" 한 줄만)
- Test: `backend/tests/test_deploy_check.py`

**Interfaces:**
- Consumes: `/health` 응답 `{ok, stt: {provider, available, model, state, error}, auth_disabled, followup: {mode, available, state, error, model}}`
- Produces:
  - `check_server.py --domain <d> [--origin <o>]`: 서버에서 시스템 `python3`로 돈다(표준 라이브러리만).
    - 확인 순서: `http://127.0.0.1:8000/health` → `https://<d>/health` → CORS 사전 요청(`OPTIONS https://<d>/health`, `Origin: <o>`, `Access-Control-Request-Method: GET`)에서 `Access-Control-Allow-Origin == <o>` → `/proc/meminfo`.
    - `--origin`이 없으면 CORS 확인은 SKIP으로 출력한다.
    - 각 줄은 `PASS`·`WARN`·`FAIL`·`SKIP` 중 하나로 시작한다. FAIL이 하나라도 있으면 종료 코드 1.
  - `evaluate(health: dict, meminfo: str) -> list[tuple[str, str]]`: (등급, 영어 문장) 목록. 순수 함수, 테스트 대상.
    - `stt.available`이 거짓이거나 `stt.state == "error"` → FAIL. `state == "loading"` → WARN("still loading, run again in a minute").
    - `followup.mode == "local"`이고 `state == "error"` → FAIL, `loading` → WARN, `ready` → PASS. `mode == "off"` → WARN(고정 문장만 씀).
    - `auth_disabled`가 참 → FAIL.
    - 메모리 사용률 `(MemTotal - MemAvailable) / MemTotal`이 20% 미만 → WARN("Oracle may reclaim an idle instance below 20% memory use"). 이상이면 PASS와 퍼센트.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`importlib`로 스크립트 경로에서 불러온다)
  - `test_ready_server_passes`: 두 모델 `ready`, 인증 켬, 메모리 30% → 모두 PASS.
  - `test_model_errors_fail`: `stt.state="error"`, `followup.state="error"` → 각각 FAIL.
  - `test_loading_models_warn`: 둘 다 `loading` → WARN 두 줄, FAIL 없음.
  - `test_followup_off_warns`, `test_auth_disabled_fails`.
  - `test_low_memory_warns_about_reclaim`: `MemTotal: 6000000 kB`, `MemAvailable: 5400000 kB`(10%) → WARN, 문장에 `20%`.
- [ ] **Step 2: 테스트가 실패하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q tests/test_deploy_check.py`
  Expected: FAIL
- [ ] **Step 3: `check_server.py`를 만든다.** 네트워크 오류(연결 거부, 인증서 오류, 시간 초과 10초)는 그 단계의 FAIL 한 줄로 낸다. 원인을 짐작할 수 있게 쓴다. 예: https 실패는 "check DuckDNS points to this server and ports 80/443 are open".
- [ ] **Step 4: 사용자 문서 `deploy-oracle.md`를 쓴다** (한국어, 사람이 따라 하는 순서)
  1. 준비물: Oracle 계정(카드 인증), DuckDNS 계정, 팀에게서 받을 값(Supabase 주소, service role key, 세션 풀러 DB 주소, 팀 웹 주소). 받기 전에는 설치까지만 하고 API는 시작하지 않는다.
  2. 인스턴스 만들기: Ubuntu 24.04 aarch64, `VM.Standard.A1.Flex` 2 OCPU / 6 GB(이유: 회수 기준), SSH 키, 공인 IP. VCN 보안 목록에 TCP 80·443 수신을 연다.
  3. DuckDNS에서 하위 도메인을 만들고 공인 IP를 넣는다.
  4. 설치: `sudo git clone -b feature/local-ai-gaze-direction https://github.com/seungxa/26-2_CapstoneProject.git /opt/jobseeker`, `sudo /opt/jobseeker/scripts/practice-track/deploy/install.sh <이름>.duckdns.org`.
  5. `sudo nano /etc/jobseeker/api.env`로 값을 채운다(항목별 어디서 찾는지). `sudo systemctl restart jobseeker-api`.
  6. 점검: `python3 /opt/jobseeker/scripts/practice-track/deploy/check_server.py --domain <이름>.duckdns.org --origin <팀 웹 주소>`. 정상일 때 나오는 줄의 예를 싣는다.
  7. 팀에 알릴 것: 팀 웹 배포의 `VITE_API_URL=https://<이름>.duckdns.org`. 확장은 이미 `chrome-extension://` 출처가 허용된다(`main.py`).
  8. 사람이 하는 첫 실사용 점검(설계 6절): 녹음 1건 → 전사 → 꼬리질문 → 회고.
  9. ARM에서 속도 다시 재기: `cd /opt/jobseeker/backend && sudo -u jobseeker HF_HOME=/var/lib/jobseeker/hf .venv/bin/python evals/followup_probe.py --repo LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF --file EXAONE-4.0-1.2B-Q4_K_M.gguf --threads 2`. 결과 요약을 `followup-model-check.md`에 붙인다. 평균이 20초를 넘거나 최대가 45초에 가까우면 알려 달라고 적는다.
  10. 업데이트: `sudo git -C /opt/jobseeker pull` 뒤 `install.sh`를 다시 실행.
  11. 회수 방지와 다시 만들기: 20% 규칙, 상주 메모리 근거(Task 2 Step 5에서 잰 값), 점검 도구의 메모리 줄. 회수되면 새 인스턴스 → 2~6단계 반복. `api.env`는 비밀번호 관리자 같은 안전한 곳에 따로 보관해 둔다(저장소에는 넣지 않는다). 데이터는 Supabase에 있어 남는다.
  12. 동시 사용: 전사와 꼬리질문은 각각 하나씩 처리한다. 둘이 겹치면 2코어를 나눠 써서 느려진다. 부하 시험은 하지 않았다.
  13. 문제 해결: 인증서 발급 실패(DNS, 80·443, `journalctl -u caddy`), 502(`journalctl -u jobseeker-api`), `import llama_cpp`가 "Illegal instruction"으로 실패할 때의 소스 빌드(`sudo apt install build-essential cmake` 뒤 `CMAKE_ARGS="-DGGML_NATIVE=ON" .venv/bin/pip install --no-binary llama-cpp-python llama-cpp-python==0.3.36 --force-reinstall`), DB 연결 실패(세션 풀러 주소인지).
  14. 라이선스: EXAONE은 비상업(연구·교육) 라이선스다. 발표 자료에 출처를 표기한다(`followup-model-check.md`의 라이선스 절).
  15. 이번에 확인하지 못한 것: 실제 Oracle ARM에서의 설치 실행(스크립트는 문법·shellcheck·파일 배치 시험만 거쳤다), A1 속도, 동시 사용자, 팀 Supabase 실제 연결.
- [ ] **Step 5: 테스트가 통과하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q`
  Expected: 전부 PASS
- [ ] **Step 6: 이 PC에서 점검 도구를 한 번 돌린다**
  - 백엔드를 `127.0.0.1:8000`에 띄운다. 값: `AUTH_DISABLED=true`, `STT_PROVIDER=local`, `LOCAL_STT_PRELOAD=true`, `FOLLOWUP_PRELOAD=true`, 임시 SQLite.
  - `check_server.py --domain example.invalid`로 실행한다. 로컬 health 줄은 PASS(모델이 다 불러와진 뒤), 인증은 FAIL(개발 모드라 맞음), https는 FAIL(도메인 없음).
  - 이렇게 각 단계가 예상대로 나오는지만 확인한다. 결과는 커밋하지 않는다.
- [ ] **Step 7: 커밋**
  `git commit -m "docs(deploy): add the server check tool and the Oracle deploy guide"`
