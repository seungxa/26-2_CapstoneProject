# 기다리는 것이 오면 할 일

지금 바깥에서 기다리는 것 다섯 가지와, 각각 왔을 때 할 일을 모았다. 오는 순서는 상관없다.

## 1. 팀 Supabase의 precheck 결과 (`supabase/precheck.sql`)
- 첫 줄 `verdict`를 본다. 자세한 것은 [supabase-apply.md](supabase-apply.md) 3절.
  - **NEW:** 그 팀원에게 `schema.sql` 한 번, 이어서 `supabase/migrations/` 7개를 파일 이름 순서대로 실행해 달라고 한다.
  - **UPGRADE:** migration 7개만 실행해 달라고 한다.
  - **STOP:** 실행하지 말고 결과 표를 그대로 공유받는다. 이름 충돌을 같이 정한다.
- 테이블 줄에 `RLS off`가 있으면 그 줄에 적힌 `alter table … enable row level security;`를 실행해 달라고 한다.

## 2. Supabase 접속 값 3개 (개인 톡으로)
- 받을 값: Project URL, secret key(`sb_secret_…`), Session pooler 주소(DB 비밀번호 포함).
- **Oracle 서버가 아직 없어도** PC에서 먼저 확인할 수 있다.
  1. 저장소 **밖**에 `~/jobseeker-team.env`를 만든다. 형식은 [`api.env.example`](../../scripts/practice-track/deploy/api.env.example)과 같다. 만든 뒤 `chmod 600`.
  2. 실행: `cd backend && .venv/bin/python ../scripts/practice-track/check_supabase.py --env-file ~/jobseeker-team.env`
  3. 팀 웹에 로그인해 토큰을 복사했다면 `--token '<access_token>'`도 붙인다. 로그인 서명 방식까지 확인된다([supabase-apply.md](supabase-apply.md) 6절).

## 3. 팀 웹 배포 주소
1. **확장을 다시 빌드해 올린다.** 이걸 해야 그 주소의 웹과 확장이 연결된다.
   ```bash
   node scripts/practice-track/build-extension.mjs --web-origin https://<팀 웹 주소>
   git add frontend/public/downloads && git commit -m "build(extension): connect to the team web address"
   ```
2. 서버 설정 파일(`/etc/jobseeker/api.env`, 서버가 없으면 위 `~/jobseeker-team.env`)의 `CORS_ORIGINS`에 그 주소를 넣는다.
3. Supabase 팀원에게 부탁한다: Authentication → URL Configuration에 그 주소를 넣어 달라고.
4. 프런트 팀원에게 부탁한다: 웹 배포 설정에 `VITE_API_URL=https://team-api.duckdns.org`를 넣어 달라고.

## 4. Oracle 가입 완료
- [deploy-oracle.md](deploy-oracle.md)를 2절부터 따라 한다. 도메인은 `team-api.duckdns.org`다.
- DuckDNS의 IP를 새 서버의 공인 IP로 바꾸고 **update ip**를 누른다.
- 설치가 끝나면 점검 두 가지를 돌린다.
  - `check_server.py`(서버 상태)
  - `check_supabase.py --env-file /etc/jobseeker/api.env`(Supabase 연결)
- 이어서 꼬리질문 속도 재기(deploy-oracle.md 9절)와 첫 실사용 점검(8절)을 한다.

## 5. 시선 실측 3회 결과
- 노트북에서 `node scripts/practice-track/start-gaze-lab.mjs`를 실행하고, `http://localhost:5181/src/features/practice-track/dev/gaze-lab.html`에서 3회 잰다.
- 결과는 [gaze-direction-protocol.md](gaze-direction-protocol.md) 기록표에 적는다.
- **3회 중 2회 이상 통과:** 웹 배포 설정에 `VITE_GAZE_DIRECTION=true`를 넣는다. 연습 화면에 10초 기준 잡기가 생기고, 회고에 시선 방향이 나온다.
- **통과 못 함:** 꺼 둔 채로 두고, 실패 항목을 보고 기준값을 같이 정한다.

## 팀원 답을 기다리는 확인 (A3)
- seungxa가 [extension-contract.md](extension-contract.md) 6절에 답하면, 그 결정에 맞춰 확장을 고친다.
  - 예: 제출 감지 → 지원 관리 기록을 넣을지
- 고친 뒤에는 zip을 다시 빌드한다.
