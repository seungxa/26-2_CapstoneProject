# 남은 일과 순서

2026-11-29 기준. 끝난 것: 팀 Supabase 적용·확인, PR #3 머지, DuckDNS `team-api.duckdns.org`.

## 1. Azure 서버 (정우)
- [deploy-azure.md](deploy-azure.md)를 2절부터 따라 한다.
- 설정값은 이 PC의 `~/jobseeker-team.env`에 모두 있다. `CORS_ORIGINS`에는 팀 웹 주소를 이미 넣어 두었다.
- 설치가 끝나면 점검 두 가지를 돌린다.
  - `check_server.py --domain team-api.duckdns.org --origin https://jobseeker-topaz-three.vercel.app`
  - `check_supabase.py --env-file /etc/jobseeker/api.env`
- 이어서 꼬리질문 속도 재기(deploy-azure.md 10절).

## 2. 팀 웹 설정 (프런트 담당에게 부탁)
- 팀 웹 주소: **https://jobseeker-topaz-three.vercel.app** (GitHub 저장소 소개란의 홈페이지 주소, Vercel 배포).
- 지금 배포본은 API 주소가 `http://localhost:8000`으로 빌드되어 있어서, 다른 사람 컴퓨터에서는 연습 기능이 서버를 찾지 못한다.
- 서버가 뜬 뒤 부탁할 것: Vercel 프로젝트 → Settings → Environment Variables에 다음을 넣고 다시 배포.
  - `VITE_API_URL=https://team-api.duckdns.org`
  - (시선 실측을 통과하면) `VITE_GAZE_DIRECTION=true`
- Supabase 담당에게 부탁할 것: Authentication → URL Configuration의 Site URL·Redirect URLs에 팀 웹 주소가 있는지 확인.
- 다 되면 deploy-azure.md 9절(첫 실사용 점검)을 팀 웹에서 한다.

## 3. 시선 실측 3회 (정우, 카메라 있는 노트북)
- 시선 방향 기능은 코드에 들어 있지만 `VITE_GAZE_DIRECTION`이 꺼져 있어 화면에 나오지 않는다. 실측을 통과하면 켠다.
- 노트북에서 한 번: 저장소를 받고 `cd frontend && npm ci`.
- 잴 때: 저장소 루트에서 `node scripts/practice-track/start-gaze-lab.mjs` → 노트북 크롬에서 `http://localhost:5181/src/features/practice-track/dev/gaze-lab.html`.
  - 카메라는 `localhost`나 https 주소에서만 켜진다. 데스크톱에서 띄우고 노트북으로 접속하는 방식은 안 된다.
  - 서버·로그인·파이썬은 필요 없다. 영상과 좌표는 브라우저 밖으로 나가지 않는다.
- 결과는 [gaze-direction-protocol.md](gaze-direction-protocol.md) 기록표에 적는다.
- **3회 중 2회 이상 통과:** 2절의 `VITE_GAZE_DIRECTION=true`를 부탁한다.
- **통과 못 함:** 꺼 둔 채로 두고, 실패 항목을 보고 기준값을 다시 정한다.

## 4. 시연이 끝나면
- Azure 리소스 그룹 `jobseeker`를 삭제한다(deploy-azure.md 12절).
- Supabase secret key와 DB 비밀번호를 바꾼다(대화에 노출된 적이 있다).
