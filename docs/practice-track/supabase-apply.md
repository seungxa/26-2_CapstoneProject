# 팀 Supabase에 연습 기능 테이블 적용하기

면접 연습·지원 관리(Practice·Track) 기능이 쓰는 테이블을 팀 Supabase 프로젝트에 넣는 순서다. Supabase 대시보드에 권한이 있는 팀원이 따라 한다. 먼저 읽기만 하는 점검을 돌리고, 그 판정에 맞는 파일만 실행한다.

- 계획과 근거: [2026-11-17-supabase-apply-plan.md](2026-11-17-supabase-apply-plan.md)
- 서버 설정값(주소·키)을 넣는 곳: [deploy-oracle.md](deploy-oracle.md) 5절

## 1. 무엇이 생기고, 무엇은 그대로인가

**생기는 것**
- 앱 테이블 14개와 각 테이블의 RLS 정책. 로그인한 사용자는 자기 행만 읽고 쓴다.
  - 연습: `questions`, `practice_sessions`, `practice_answers`, `user_settings`, `practice_private_questions`, `practice_contexts`, `answer_coaching`, `question_competencies`
  - 지원 관리: `applications`, `stage_events`, `essay_items`, `answer_versions`, `application_states`, `essay_submissions`
- 녹음 파일 버킷 `recordings`(비공개)와 그 정책 `rec_own`. 사용자는 자기 폴더의 파일만 다룬다.
- 자소서 답변 버전을 고치거나 지우지 못하게 막는 트리거(`answer_versions_history_guard`, 함수 `protect_answer_version_history`).

**그대로인 것**
- `profiles`(팀의 프로필 테이블), `auth` 스키마, 팀의 다른 테이블과 버킷. 점검 SQL은 `profiles`의 컬럼과 RLS를 보여 주기만 한다.

## 2. 점검 (아무것도 바꾸지 않음)

1. Supabase 대시보드 → **SQL Editor** → New query.
2. 저장소의 [`supabase/precheck.sql`](../../supabase/precheck.sql) 내용을 전부 붙여 넣고 **Run**.
3. 결과 첫 줄(`verdict`)의 `status`를 본다. 카탈로그를 읽기만 하므로 몇 번을 실행해도 된다.

결과 줄의 뜻:

| section | 뜻 |
|---|---|
| `verdict` | 판정(아래 3절)과 다음에 할 일 |
| `table` | 앱 테이블마다 `absent`(없음), `ours`(앱의 테이블, RLS on/off), `CONFLICT`(같은 이름의 다른 테이블, 빠진 앱 컬럼) |
| `storage` | 버킷 `recordings`가 있는지와 공개 여부, 정책 `rec_own`이 있는지 |
| `function` | 트리거 함수 `protect_answer_version_history`가 있는지 |
| `profiles` | 팀 프로필 테이블의 컬럼·RLS·정책 수(참고용, 판정에 쓰지 않음) |

## 3. 판정별로 할 일

**NEW: 앱 테이블이 하나도 없다** (팀 프로젝트에 처음 적용할 때)
1. SQL Editor에서 [`supabase/schema.sql`](../../supabase/schema.sql)을 **한 번** 실행한다.
2. 이어서 [`supabase/migrations/`](../../supabase/migrations/)의 파일 7개를 **파일 이름 순서대로** 하나씩 실행한다.
   1. `20261015_interview_coaching.sql`
   2. `20261015_practice_p0.sql`
   3. `20261104_practice_insights.sql`
   4. `20261105_practice_integrity.sql`
   5. `20261105_track_integrity.sql`
   6. `20261105_version_immutability.sql`
   7. `20261117_track_schedule.sql`
3. 점검(2절)을 다시 돌려 `UPGRADE`가 나오고, 테이블 14줄이 모두 `ours`·`RLS on`인지 본다.

**UPGRADE: 앱 테이블이 이미 있다** (예전에 적용했고 새 버전으로 올릴 때)
- migration 7개를 파일 이름 순서대로 실행한다. 다시 실행해도 데이터가 바뀌거나 사라지지 않는다.
- 점검 결과에서 테이블 줄이 `RLS off`면, 그 줄에 적힌 `alter table public.<테이블> enable row level security;`를 SQL Editor에서 실행한다. 정책은 이미 있어서 RLS만 다시 켜면 된다. migration은 처음 7개 테이블의 RLS를 다시 켜지 않는다.
- 버킷 줄이 `absent`면 5절의 "버킷이 없을 때"를 따른다. migration은 버킷을 만들지 않는다.
- `schema.sql`은 **다시 실행하지 않는다.** 정책을 이미 있는 이름으로 또 만들려다 오류로 멈춘다(그 앞까지의 문장은 이미 실행된 상태가 된다). 실수로 실행했다면 점검부터 다시 한다.

**STOP: 아무것도 실행하지 않는다**
- 원인은 셋 중 하나다.
  - 앱 테이블과 같은 이름의 다른 테이블이 있다(`CONFLICT` 줄).
  - 녹음 버킷이 공개로 있다.
  - 앱 테이블이 일부만 있다.
- 결과 표를 그대로 복사해 공유한다. 이름을 바꿀지 등은 같이 정한다.
- 이유: `schema.sql`은 `create table if not exists`라서, 같은 이름의 다른 테이블을 조용히 건너뛰고 앱만 깨진다.

SQL Editor가 `drop policy` 같은 문장을 보고 "destructive operation" 경고를 띄울 수 있다. migration의 `drop policy if exists`는 같은 이름의 정책을 새로 고치려는 것이라 데이터를 지우지 않는다. 경고를 확인하고 실행한다.

## 4. migration과 기능 설정의 짝

| 파일 | 왜 필요한가 | 서버 설정 |
|---|---|---|
| `20261105_track_integrity.sql`, `20261105_version_immutability.sql` | 지원 관리 기록의 무결성. **없으면 앱이 시작하지 않는다** | 항상 필요 |
| `20261117_track_schedule.sql` | 지원 건의 마감일·다음 일정(D-day, 보드, 달력). **없으면 앱이 시작하지 않는다** | 항상 필요 |
| `20261104_practice_insights.sql`, `20261105_practice_integrity.sql` | 질문 유형·역량 태그(연습 회고의 분석) | 적용한 뒤에만 `PRACTICE_INSIGHTS_ENABLED=true` |
| `20261015_interview_coaching.sql`, `20261015_practice_p0.sql` | 답변 점검·꼬리질문, 녹음 동의와 보관 | `schema.sql`에 이미 들어 있다. 예전 스키마에서 올릴 때 필요 |

앱은 시작할 때 위 표의 첫 줄과 둘째 줄(항상), 셋째 줄(설정을 켰을 때)이 적용됐는지 검사한다. 빠졌으면 어떤 파일이 필요한지 로그에 쓰고 시작하지 않는다.

## 5. 녹음 버킷 확인

Storage → Buckets에서 `recordings`가 있고 **Public이 꺼져 있는지** 본다. 공개 버킷이면 파일 주소만 알면 누구나 녹음을 들을 수 있다. 앱은 서버의 secret key로만 녹음을 읽고 쓴다.

**버킷이 없을 때** (판정이 UPGRADE인데 버킷 줄이 `absent`):
1. Storage → **New bucket** → 이름 `recordings`, **Public bucket은 끈 채로** 저장한다.
2. 점검 결과의 `policy rec_own on storage.objects` 줄이 `absent`면, SQL Editor에서 아래를 실행한다(`schema.sql`의 같은 문장이다).

```sql
create policy rec_own on storage.objects for all
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
```

## 6. 적용 뒤 연결 점검

서버 설정 파일의 값으로 앱이 Supabase를 제대로 쓰는지 확인한다. 읽기만 한다.

**Oracle 서버에서**

```bash
sudo /opt/jobseeker/backend/.venv/bin/python /opt/jobseeker/scripts/practice-track/check_supabase.py \
  --env-file /etc/jobseeker/api.env
```

**서버가 아직 없을 때 (백엔드를 설치한 PC에서)**
1. 저장소 **밖**에 설정 파일을 만든다. 예: `~/jobseeker-team.env`. 형식은 [`api.env.example`](../../scripts/practice-track/deploy/api.env.example)과 같다. `chmod 600`으로 나만 읽게 하고, 저장소에 넣지 않는다.
2. `cd backend && .venv/bin/python ../scripts/practice-track/check_supabase.py --env-file ~/jobseeker-team.env`

**어떤 키로 로그인 토큰을 서명하는지 확인하기 (`--token`):** 공개된 서명 키만 보고는 프로젝트가 실제로 그 키로 서명하는지 알 수 없다. 예전 방식 프로젝트도 새 키를 미리 공개해 둘 수 있다. 그래서 `--token` 없이 돌리면 `sign-in` 줄은 WARN이다. 실제 토큰으로 확인하려면:
1. 팀 웹에 로그인한다.
2. 개발자 도구(F12) → Application(애플리케이션) → Local Storage → 팀 웹 주소 → `sb-<ref>-auth-token` 항목을 연다.
3. 값 안의 `access_token` 문자열을 복사해 `--token '<복사한 값>'`으로 넘긴다.
   - 이 토큰은 약 1시간 동안 그 계정의 임시 비밀번호와 같다. 다른 사람에게 보내거나 어디에 붙여 두지 않는다.
   - 만료된 토큰이어도 서명 방식은 확인된다.

**결과:** 모든 줄이 `PASS`면 된다(`--token` 없이 돌리면 `sign-in` 줄만 WARN). 예시(버전과 키 수는 프로젝트마다 다르다. 앱이 쓰는 테이블은 `PRACTICE_INSIGHTS_ENABLED=false`면 13개, `true`면 `question_competencies`까지 14개다):

```
PASS  settings: complete
PASS  database: connected (PostgreSQL 17.4)
PASS  tables: all 13 app tables and their columns are present
PASS  app startup check (Track): passes
PASS  row level security: on for every app table
PASS  storage: bucket recordings exists and is private
PASS  sign-in: the app verifies this project's ES256 tokens
```

| FAIL 문장 | 할 일 |
|---|---|
| `database: cannot connect … IPv6 only …` | `DATABASE_URL`을 **Session pooler** 주소로 바꾼다 |
| `tables: missing …` 또는 `app startup check … requires manual migration …` | 3절의 판정에 맞게 빠진 파일을 실행한다 |
| `row level security: off on …` | 문장 끝에 적힌 `alter table … enable row level security;`를 SQL Editor에서 실행한다 |
| `storage: bucket recordings is public` | 5절대로 비공개로 바꾼다 |
| `storage: bucket recordings does not exist …` | 판정이 NEW였다면 `schema.sql`을 실행한다. 이미 적용한 프로젝트면 5절의 "버킷이 없을 때" |
| `storage: … refused the service key` | `SUPABASE_SERVICE_ROLE_KEY`를 다시 복사한다(secret key `sb_secret_…` 또는 예전 service_role key) |
| `sign-in: … legacy JWT secret` | 예전 방식 프로젝트다. `SUPABASE_JWT_MODE=hs256`과 `SUPABASE_JWT_SECRET`(Project Settings → JWT Keys의 legacy secret)을 넣는다 |
| `sign-in: … signs tokens with a signing key … set SUPABASE_JWT_MODE=jwks` | 새 방식 프로젝트다. `SUPABASE_JWT_MODE=jwks`로 바꾼다(secret은 필요 없다) |
| `sign-in: unexpected reply … (is the project paused?)` | 서명 방식과는 상관없다. 대시보드에서 프로젝트가 일시정지(paused)됐는지 보고 다시 켠 뒤 점검한다 |

## 7. 되돌리기

- **분석 기능만 끄기:** `PRACTICE_INSIGHTS_ENABLED=false`로 두고 API를 다시 시작한다. 추가된 컬럼과 태그는 남지만 쓰지 않는다.
- **이전 앱으로 돌아가기:** 서버 코드를 이전 커밋으로 돌린다. 이 묶음의 migration은 컬럼·테이블을 더하기만 해서 이전 앱도 그대로 돈다.
- **데이터를 지우는 되돌리기(down migration)는 만들지 않았다.** 테이블을 지우면 사용자의 연습 기록과 녹음이 사라진다. 꼭 필요하면 팀이 함께 정한다.

## 8. 이번에 확인하지 못한 것

- **실제 Supabase 클라우드에서 실행해 보지 않았다.** 점검 SQL의 판정 7가지 경우, `schema.sql`과 migration, 연결 점검 도구의 DB 부분(테이블·앱 시작 검사·RLS)은 이 PC의 일회용 PostgreSQL 16.15에서 시험했다(읽기 전용 트랜잭션 안에서 실행해 아무것도 쓰지 않음을 확인). 이 DB는 Supabase의 `auth`·`storage` 중 필요한 일부만 흉내 낸다.
- Storage와 Auth에 실제로 요청하는 부분(버킷, 서명 키)은 가짜 응답으로만 시험했다. 응답 꼴은 Supabase 문서를 따랐다.
- 팀 프로젝트의 실제 상태(`profiles` 구성, 이미 있는 이름)는 점검 SQL 결과를 받아야 안다.
