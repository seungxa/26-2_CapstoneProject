# 팀 Supabase 적용 묶음 (A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 Supabase 프로젝트에 연습 기능 테이블을 안전하게 적용할 수 있게 한다. 무엇이 이미 있는지 읽기만 하는 점검 SQL, 상황별 적용 순서 문서, 적용 뒤 연결을 확인하는 점검 도구를 만든다. 팀 프로젝트에는 아무것도 실행하지 않는다.

**Architecture:**
- `supabase/precheck.sql`: 카탈로그만 읽는 SELECT 한 문장. 판정 한 줄(NEW·UPGRADE·STOP)과 항목별 줄을 낸다. Supabase SQL Editor에 붙여 넣어 실행한다.
- `docs/practice-track/supabase-apply.md`: 판정별로 무엇을 어떤 순서로 실행하는지, 기능 플래그와 migration의 짝, 녹음 버킷, 되돌리기.
- `scripts/practice-track/check_supabase.py`: 서버 설정 파일(`api.env`)을 읽어 DB 연결, 테이블·컬럼(앱 ORM과 비교), 앱 시작 검사, RLS, 녹음 버킷이 비공개인지, 로그인 토큰 검증 수단을 확인한다. 읽기만 한다.
- 실제 PostgreSQL로 시험한다: `backend/integration`의 기존 일회용 클러스터(Supabase의 `auth`·`storage` 일부만 흉내)를 쓴다.

**Tech Stack:** PostgreSQL 16 카탈로그(`pg_class`, `pg_attribute`, `pg_policies`, `pg_proc`), SQLAlchemy, httpx, pytest.

**Spec:** `docs/practice-track/2026-11-14-local-ai-gaze-direction-design.md` 4.1절 **A2**.

**조사로 정한 것**
- 적용 순서는 기존 통합 테스트가 이미 정한 것을 따른다: 새 DB는 `schema.sql` 한 번, 이어서 `supabase/migrations/*.sql`을 파일 이름 순서로. migration은 다시 실행해도 안전하다(`test_fresh_full_sql_and_all_migrations_repeat_without_data_loss`). `schema.sql`은 정책을 `drop if exists` 없이 만들어 두 번 실행하면 실패한다. 그래서 점검 판정이 둘을 가른다.
- 팀 프런트는 Supabase에서 `profiles`만 쓴다(`frontend/src/pages/Profile.tsx`). 앱의 테이블 14개와 이름이 겹치지 않을 것으로 보이지만, 점검 SQL이 확인한다. `profiles`는 읽기만 하고 바꾸지 않는다.
- 앱은 Postgres에서 테이블을 만들지 않는다(`init_db`). 시작할 때 Track migration 두 개와(플래그를 켰으면) insights migration을 검사하고, 없으면 시작하지 않는다. 점검 도구는 이 검사를 그대로 불러 같은 문장을 보여 준다.
- 새 Supabase 프로젝트는 비대칭 JWT 서명 키(JWKS)를 쓰고, 예전 프로젝트는 HS256 secret을 쓴다. 점검 도구는 설정된 방식에 맞춰 확인한다.

## Global Constraints

- **팀 프로젝트에 쓰지 않는다.** 이 작업은 팀 Supabase에 접속하지 않는다. `precheck.sql`과 점검 도구는 읽기만 한다(점검 SQL은 읽기 전용 트랜잭션에서 시험한다). 사람이 실행한다.
- **팀 소유 파일은 바꾸지 않는다:** 저장소 루트 `README.md`, `frontend/`, `extension-track/`. `supabase/schema.sql`과 기존 migration도 바꾸지 않는다(이미 검증된 적용 대상).
- **비밀값을 저장소에 넣지 않는다.** 점검 도구는 키·비밀번호를 출력하지 않는다.
- **글 언어:** 도구 출력과 코드 주석은 영어, 사람이 읽는 적용 문서는 한국어.
- **앱 테이블 14개:** `questions`, `practice_sessions`, `practice_answers`, `applications`, `stage_events`, `essay_items`, `answer_versions`(여기까지 기본 7개, 처음 스키마), `user_settings`, `practice_private_questions`, `practice_contexts`, `answer_coaching`, `question_competencies`, `application_states`, `essay_submissions`.
- **판정 규칙 (`precheck.sql`):**
  - **STOP:** 앱 테이블 이름을 가진 테이블이 앱의 컬럼을 갖지 않음(다른 테이블), 또는 기본 7개 중 일부만 있음, 또는 앱 테이블이 하나도 없는데 `storage.objects`의 정책 `rec_own`이나 함수 `public.protect_answer_version_history`가 이미 있음.
  - **NEW:** 앱 테이블이 하나도 없고 위 이름 충돌도 없음 → `schema.sql` 한 번, 이어서 migration 전부.
  - **UPGRADE:** 기본 7개가 모두 앱의 컬럼으로 있음(새 테이블은 없어도 됨) → migration 전부만. `schema.sql`은 다시 실행하지 않는다.

## Review Focus

1. **누군가 `precheck.sql`을 실수로 두 번, 또는 적용 도중에 실행한다.** 읽기만 하므로 아무것도 바뀌지 않아야 한다. → Task 1, 읽기 전용 트랜잭션 시험.
2. **팀 프로젝트에 같은 이름의 다른 `applications` 테이블이 있다.** NEW로 판정해 `schema.sql`을 돌리면 `create table if not exists`가 조용히 건너뛰어 앱이 깨진다. STOP이어야 한다. → Task 1 `test_other_table_with_an_app_name_stops`.
3. **적용을 마쳤는데 버킷이 공개로 만들어졌거나 RLS가 꺼져 있다.** 점검 도구가 FAIL로 알려야 한다. → Task 2 `test_public_bucket_fails`, `test_rls_off_fails`.
4. **`DATABASE_URL`에 직결 주소(`db.<ref>.supabase.co`)를 넣었다.** IPv4 서버에서 연결이 안 된다. 실패 문장이 세션 풀러를 쓰라고 알려야 한다. → Task 2 `test_direct_address_failure_points_to_the_pooler`.
5. **프로젝트가 예전 HS256 방식인데 `SUPABASE_JWT_MODE=jwks`로 두었다.** JWKS에 키가 없으니 모든 로그인이 401이 된다. 점검 도구가 hs256으로 바꾸라고 알려야 한다. → Task 2 `test_jwks_without_keys_suggests_hs256`.

---

### Task 1: 읽기 전용 점검 SQL

**Files:**
- Create: `supabase/precheck.sql`
- Test: `backend/integration/test_supabase_precheck.py` (실제 PostgreSQL, `backend/integration/conftest.py`의 `cluster`)

**Interfaces:**
- Produces: `precheck.sql`은 SELECT 한 문장. 결과 열 `(section text, item text, status text, detail text)`. 첫 줄은 `section='verdict'`, `status`는 `NEW`·`UPGRADE`·`STOP` 중 하나, `detail`은 다음에 할 일(영어 한 문장). 이어서 `table`(14줄, status `absent`·`ours`·`CONFLICT`, detail에 RLS 여부나 빠진 컬럼), `storage`(버킷 `recordings` 있음·공개 여부, 정책 `rec_own`), `function`(`protect_answer_version_history`), `profiles`(있음, 컬럼, RLS, 정책 수 — 정보용) 줄.

- [ ] **Step 1: 실패하는 시험을 쓴다** (각 시험은 `cluster.database(schema=...)`로 DB를 만들고, `begin transaction read only` 안에서 `precheck.sql`을 실행해 결과를 읽는다)
  - `test_bootstrap_only_is_new`: Supabase 흉내 스키마만 있는 DB → verdict `NEW`, 테이블 14줄 모두 `absent`.
  - `test_after_schema_is_upgrade`: `schema.sql`만 적용 → `UPGRADE`, 14줄 모두 `ours`, 버킷 줄에 private.
  - `test_after_schema_and_migrations_is_upgrade_and_rls_on`: `schema.sql`과 migration 전부 → `UPGRADE`, 테이블 줄 detail에 RLS on.
  - `test_historical_schema_is_upgrade`: 기존 fixture의 옛 스키마(`schema="historical"`) → `UPGRADE`(새 테이블은 `absent`여도 됨).
  - `test_other_table_with_an_app_name_stops`: 흉내 스키마에 `create table public.applications(id bigint primary key, title text)` → `STOP`, `applications` 줄이 `CONFLICT`이고 detail에 빠진 컬럼(`user_id` 등).
  - `test_partial_base_tables_stop`: `schema.sql` 뒤 `drop table stage_events cascade` → `STOP`.
  - `test_taken_policy_or_function_name_stops_a_new_project`: 흉내 스키마에 `create policy rec_own on storage.objects for select using (true)` → `STOP`. 함수 `public.protect_answer_version_history()`만 있어도 `STOP`.
  - `test_profiles_is_reported_not_judged`: 흉내 스키마에 `create table public.profiles(user_id uuid primary key, archive jsonb)`와 RLS → verdict `NEW` 그대로, `profiles` 줄에 컬럼 `user_id, archive`와 RLS.
  - `test_precheck_is_one_read_only_select`: 파일에서 주석을 뺀 본문이 `with`나 `select`로 시작하고 `;`가 끝에 하나뿐이다. `insert|update|delete|create|alter|drop|grant|revoke|truncate`가 없다.
- [ ] **Step 2: 시험이 실패하는지 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q integration/test_supabase_precheck.py`
  Expected: FAIL(파일 없음). 클러스터가 없으면 기존 통합 시험처럼 건너뛴다. 이때는 `scripts/practice-track/setup_pg_validation_runtime.py`로 만든 뒤 다시 돌린다.
- [ ] **Step 3: `supabase/precheck.sql`을 쓴다.** 맨 위 주석: 무엇을 하는지, 아무것도 바꾸지 않는다는 것, SQL Editor에서 Run, 결과를 `docs/practice-track/supabase-apply.md`의 판정표와 맞춰 본다는 것.
- [ ] **Step 4: 통과를 확인한다**
  Run: `cd backend && .venv/bin/python -m pytest -q integration/test_supabase_precheck.py integration/test_postgres.py`
  Expected: 전부 PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(supabase): add a read-only precheck for applying the app schema to the team project"`

### Task 2: 연결 점검 도구

**Files:**
- Create: `scripts/practice-track/check_supabase.py`
- Test: `backend/tests/test_check_supabase.py`(SQLite·가짜 HTTP), `backend/integration/test_supabase_precheck.py`에 실제 Postgres 시험 추가

**Interfaces:**
- Consumes: `app.config.Settings`, `app.db.Base`·`validate_track_schema`·`validate_insights_schema`, `app.storage._sb_headers`
- Produces:
  - `load_env_file(path: str) -> dict[str, str]`: `KEY=VALUE` 줄(주석·빈 줄 무시, 값 양끝의 같은 따옴표 한 쌍 제거).
  - `run_checks(settings, engine, http: httpx.Client) -> list[tuple[str, str]]`: (등급, 문장) 목록. 등급은 `PASS`·`WARN`·`FAIL`·`SKIP`.
  - CLI: `python check_supabase.py --env-file /etc/jobseeker/api.env`. 파일 값을 환경 변수로 먼저 넣은 뒤 `app`을 불러온다. 줄마다 등급으로 시작하고, FAIL이 있으면 종료 코드 1. 키·비밀번호는 출력하지 않는다.
- 확인 순서와 문장 규칙:
  1. 설정: `settings.check()`가 오류면 FAIL(오류 문장). `DATABASE_URL`이 비어 SQLite면 FAIL("the app would use a local SQLite file, not Supabase").
  2. DB 연결(`select version()`, 연결 시간 상한 10초): 실패하면 FAIL. 호스트가 `db.`로 시작하고 `.supabase.co`로 끝나면 "the direct address is IPv6 only on the free plan; use the Session pooler address"를 덧붙인다.
  3. 테이블·컬럼: `Base.metadata`의 테이블·컬럼 중 DB에 없는 것 → FAIL(최대 10개 이름). 다 있으면 PASS(개수).
  4. 앱 시작 검사: `validate_track_schema`, 플래그가 켜졌으면 `validate_insights_schema`. 예외 문장을 그대로 FAIL로.
  5. RLS(Postgres만): 앱 테이블 중 `relrowsecurity`가 꺼진 것 → FAIL. SQLite면 SKIP.
  6. 녹음 버킷: 서비스 키가 없으면 FAIL("recordings would be kept on the server disk"). `GET {SUPABASE_URL}/storage/v1/bucket/{STORAGE_BUCKET}`(헤더 `_sb_headers()`): 200이고 `public`이 거짓이면 PASS, 참이면 FAIL, 404면 FAIL("run schema.sql or create a private bucket"), 401·403이면 FAIL("check the service key").
  7. 로그인 토큰 검증: `jwks`면 `GET {SUPABASE_URL}/auth/v1/.well-known/jwks.json`에 키가 1개 이상이면 PASS(알고리즘 이름), 0개면 FAIL("this project signs with the legacy JWT secret: set SUPABASE_JWT_MODE=hs256 and SUPABASE_JWT_SECRET"). `hs256`이면 secret이 있으면 PASS.
  - 2단계가 실패하면 3~5단계는 SKIP. 6·7단계는 DB와 상관없이 한다.

- [ ] **Step 1: 실패하는 시험을 쓴다** (`backend/tests/test_check_supabase.py`, `importlib`로 스크립트를 불러온다. DB는 임시 SQLite에 `Base.metadata.create_all`, HTTP는 `httpx.MockTransport`)
  - `test_env_file_parsing`: 주석·빈 줄·`KEY="v a"`·`KEY='x'`·`=`가 들어간 값(`postgresql://u:p@h/db?x=1`).
  - `test_sqlite_database_fails`: `DATABASE_URL` 빈 설정 → FAIL 문장에 `SQLite`.
  - `test_complete_schema_and_private_bucket_pass`: create_all한 SQLite(RLS SKIP), 버킷 `{"public": false}`, JWKS 키 1개 → FAIL 없음.
  - `test_missing_table_fails`: 테이블 하나를 지운 SQLite → FAIL에 그 이름.
  - `test_public_bucket_fails`, `test_missing_bucket_fails`(404), `test_bad_service_key_fails`(401).
  - `test_jwks_without_keys_suggests_hs256`: `{"keys": []}` → FAIL 문장에 `SUPABASE_JWT_MODE=hs256`.
  - `test_direct_address_failure_points_to_the_pooler`: 연결 실패하는 엔진과 `postgresql://postgres:pw@db.abc.supabase.co:5432/postgres` → FAIL 문장에 `Session pooler`. 이어지는 테이블 줄은 SKIP.
  - `test_output_never_shows_secrets`: CLI를 임시 env 파일(키 `sb_secret_TOPSECRET`, 비밀번호 `pw-TOPSECRET`)로 돌리면 출력에 `TOPSECRET`이 없다(HTTP·DB는 실패해도 됨, 네트워크 없이 끝나도록 주소는 `127.0.0.1`의 닫힌 포트).
  - 통합(`integration/`) `test_check_supabase_on_migrated_postgres` 와 `test_rls_off_fails`: 실제 Postgres에 `schema.sql`과 migration 전부 → 테이블·앱 검사·RLS 줄 PASS. `alter table applications disable row level security` 뒤 → RLS FAIL에 `applications`.
- [ ] **Step 2: 실패를 확인한다** Run: `cd backend && .venv/bin/python -m pytest -q tests/test_check_supabase.py` Expected: FAIL
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 통과를 확인한다** Run: `cd backend && .venv/bin/python -m pytest -q && .venv/bin/python -m pytest -q integration/test_supabase_precheck.py` Expected: 전부 PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(supabase): add a read-only connection check for the team project"`

### Task 3: 적용 문서

**Files:**
- Create: `docs/practice-track/supabase-apply.md`
- Modify: `docs/practice-track/deploy-oracle.md`(5절에 적용 문서와 점검 도구 안내 한 줄), `docs/practice-track/2026-11-14-local-ai-gaze-direction-design.md`(A2 끝에 구현 링크 한 줄), `backend/.env.example`(JWT 방식 설명에 새 프로젝트는 jwks라는 한 줄)

- [ ] **Step 1: 문서를 쓴다** (한국어, Supabase 대시보드에 권한이 있는 팀원이 따라 하는 순서)
  1. 무엇이 생기고 무엇은 건드리지 않는가: 앱 테이블 14개와 RLS 정책, 녹음 버킷(`recordings`, 비공개)과 그 정책, 답변 버전 보호 트리거. `profiles`·`auth`·팀의 다른 테이블은 건드리지 않는다.
  2. 점검: SQL Editor에 `supabase/precheck.sql`을 붙여 넣고 Run. 아무것도 바꾸지 않는다.
  3. 판정별 할 일:
     - NEW → `schema.sql` 한 번 → `migrations/` 파일 이름 순서대로 전부.
     - UPGRADE → migration만.
     - STOP → 아무것도 실행하지 않고 결과를 공유.
     - `schema.sql`을 두 번 실행하면 정책이 이미 있다는 오류로 멈춘다(그 앞 문장은 이미 적용됨). 이때는 다시 점검부터 한다.
  4. migration과 기능의 짝(표):
     - `20261105_track_integrity.sql`·`20261105_version_immutability.sql`은 앱 시작에 꼭 필요하다(없으면 앱이 시작하지 않는다).
     - `20261104_practice_insights.sql`·`20261105_practice_integrity.sql` 적용 뒤에만 `PRACTICE_INSIGHTS_ENABLED=true`로 둔다.
     - 나머지 둘은 `schema.sql`에 이미 들어 있고, 다시 실행해도 안전하다.
  5. 녹음 버킷: Storage 화면에서 `recordings`가 Public이 아닌지 확인한다.
  6. 적용 뒤 확인: 서버(또는 키를 가진 PC)에서 `check_supabase.py --env-file …`. 결과 예시.
  7. 되돌리기: `PRACTICE_INSIGHTS_ENABLED=false` 뒤 이전 앱으로 돌아간다. 데이터를 지우는 down migration은 없다. 테이블을 지우는 일은 이 문서에서 다루지 않는다(데이터가 사라진다).
  8. 서버 설정에 넣을 값과 어디서 찾는지는 `deploy-oracle.md` 5절로 연결한다. 세션 풀러, JWT 방식(새 프로젝트는 jwks), secret key.
  9. 이번에 확인하지 못한 것: 실제 Supabase 클라우드에서의 실행(시험은 `auth`·`storage` 일부만 흉내 낸 PostgreSQL 16).
- [ ] **Step 2: 문서에 적은 명령과 파일 이름이 실제와 같은지 확인한다** (`ls supabase/migrations`, 도구의 `--help`)
- [ ] **Step 3: 커밋** `git commit -m "docs(supabase): add the apply guide for the team project"`
