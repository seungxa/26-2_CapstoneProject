# Oracle 무료 서버에 연습 API 배포하기

연습 API(녹음 전사, 꼬리질문, 연습 기록)를 Oracle Cloud 상시 무료 ARM 서버에 올리는 순서다. 다 하면 팀 웹과 크롬 확장이 `https://<이름>.duckdns.org`로 API를 부른다.

- 전사와 꼬리질문은 이 서버의 CPU에서 돈다. 녹음이나 답변을 외부 AI 서비스로 보내지 않는다.
- 설치는 스크립트 하나(`scripts/practice-track/deploy/install.sh`)가 한다. 사람이 할 일은 계정 만들기, 서버 만들기, 설정값 채우기, 점검이다.
- 계획과 결정 근거: [2026-11-16-oracle-deploy-plan.md](2026-11-16-oracle-deploy-plan.md)

## 1. 준비물

- **Oracle Cloud 계정:** 가입할 때 카드 인증이 필요하다. 상시 무료 범위 안에서는 요금이 나가지 않는다.
- **DuckDNS 계정:** https://www.duckdns.org 에서 GitHub나 Google 계정으로 로그인한다.
- **팀에게서 받을 값:** 이 값을 받기 전에는 설치까지만 하고 API는 시작하지 않는다.
  - Supabase 프로젝트 주소: `https://<ref>.supabase.co`
  - secret key(`sb_secret_…`) 또는 예전 service_role key
  - DB의 **세션 풀러** 주소
  - 팀 웹 주소(예: `https://team-app.vercel.app`)

## 2. 서버 만들기 (Oracle 콘솔)

1. **Compute → Instances → Create instance**를 연다.
2. **Image:** Canonical Ubuntu 24.04를 고른다. Shape를 Ampere로 고르면 aarch64 판이 잡힌다.
3. **Shape:** Ampere `VM.Standard.A1.Flex`, **OCPU 2, Memory 4 GB**로 둔다.
   - 메모리를 4 GB로 두는 이유: 7일 동안 CPU·네트워크·메모리 사용률이 모두 20% 미만이면 Oracle이 서버를 회수할 수 있다(Oracle 공식 문서).
   - 사용자가 없을 때 CPU·네트워크는 거의 0%라서, 메모리가 회수를 막는다.
   - 두 모델을 올린 API는 약 1.2 GB를 쓰고(이 PC에서 잼), OS까지 더하면 약 1.6 GB다. 4 GB의 약 40%다. 12 GB로 만들면 13%라 회수 기준에 걸린다.
4. **Networking:** 공인 서브넷이 있는 VCN을 고르거나 새로 만든다. "Assign a public IPv4 address"를 켠다.
5. **SSH keys:** 키를 만들어 개인 키를 내려받는다. 이 파일을 잃으면 서버에 들어갈 수 없다.
6. 만든 뒤 인스턴스 화면에서 **공인 IP**를 적어 둔다.
7. **80·443 열기 (콘솔 쪽):** Networking → Virtual cloud networks → 그 VCN → Security Lists → Default Security List → **Add Ingress Rules**에서 두 줄을 넣는다.
   - Source `0.0.0.0/0`, IP Protocol TCP, Destination Port `80`
   - Source `0.0.0.0/0`, IP Protocol TCP, Destination Port `443`
   - 서버 안의 방화벽(iptables)은 설치 스크립트가 연다.

"Out of capacity" 오류가 나면 그 지역에 남은 ARM 자리가 없는 것이다. 몇 시간 뒤나 다른 가용 도메인(AD)으로 다시 시도한다.

## 3. 도메인 (DuckDNS)

1. DuckDNS에서 하위 도메인을 하나 만든다. 예: `jobseeker-practice` → `jobseeker-practice.duckdns.org`.
2. "current ip"에 2단계의 공인 IP를 넣고 **update ip**를 누른다.
3. 내 컴퓨터에서 `nslookup jobseeker-practice.duckdns.org`가 그 IP를 보여 주면 된다(몇 분 걸릴 수 있다).

sslip.io 같은 IP 기반 무료 도메인은 쓰지 않는다. 모든 사용자가 인증서 발급 한도를 함께 써서 발급이 자주 막힌다. DuckDNS는 하위 도메인마다 한도가 따로다.

## 4. 설치

```bash
ssh -i <개인 키 파일> ubuntu@<공인 IP>
sudo git clone -b feature/local-ai-gaze-direction https://github.com/seungxa/26-2_CapstoneProject.git /opt/jobseeker
sudo /opt/jobseeker/scripts/practice-track/deploy/install.sh <이름>.duckdns.org
```

스크립트가 하는 일(처음에는 10~20분):
1. 시스템 패키지와 Caddy(https 프록시, 공식 저장소)를 설치한다.
2. `jobseeker` 서비스 사용자와 `/var/lib/jobseeker` 폴더를 만든다.
3. `/etc/jobseeker/api.env`(설정 파일)를 틀에서 만든다. 이미 있으면 건드리지 않는다.
4. 파이썬 가상환경에 검증한 버전(`requirements-lock.txt`)을 설치한다. ARM용 패키지가 모두 있어 컴파일하지 않는다.
5. API 서비스(`jobseeker-api`)와 Caddy를 등록한다. 재부팅해도 둘 다 다시 뜬다.
6. 서버 방화벽에서 80·443을 연다.
7. 전사 모델(Whisper base, 약 145 MB)과 꼬리질문 모델(EXAONE 1.2B, 약 775 MB)을 Hugging Face에서 한 번 받는다.
8. 설정 파일에 아직 `<…>` 칸이 남아 있으면 API를 시작하지 않고 그렇다고 알려 준다.

## 5. 설정값 채우기

```bash
sudo nano /etc/jobseeker/api.env
```

`<…>`로 표시한 네 줄을 채운다.

| 설정 | 어디서 찾나 |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API의 Project URL. `https://<ref>.supabase.co` 꼴 |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys의 secret key(`sb_secret_…`) 또는 예전 service_role key. **비밀값이다** |
| `DATABASE_URL` | 대시보드 위쪽 **Connect** → **Session pooler**의 주소. 비밀번호 칸을 DB 비밀번호로 바꾼다. 직결 주소(`db.<ref>.supabase.co`)는 무료 플랜에서 IPv6 전용이라 이 서버에서 연결되지 않는다 |
| `CORS_ORIGINS` | 팀 웹 주소. 여러 개면 쉼표로 잇는다. 끝에 `/`를 붙이지 않는다 |

- 프로젝트가 예전 JWT secret 방식이면 `SUPABASE_JWT_MODE=hs256`으로 바꾸고 `SUPABASE_JWT_SECRET`에 그 값을 넣는다. 새 프로젝트는 기본값 `jwks` 그대로 둔다.
- `PRACTICE_INSIGHTS_ENABLED`는 팀 Supabase에 migration을 적용한 뒤(A2 작업)에만 `true`로 바꾼다.
- 채운 파일은 저장소에 올리지 않는다. 비밀번호 관리자 같은 안전한 곳에 사본을 하나 둔다(서버를 다시 만들 때 쓴다).

저장한 뒤:

```bash
sudo systemctl restart jobseeker-api
```

## 6. 점검

```bash
python3 /opt/jobseeker/scripts/practice-track/deploy/check_server.py --domain <이름>.duckdns.org --origin <팀 웹 주소>
```

정상이면 모든 줄이 `PASS`다.

```
PASS  http://127.0.0.1:8000/health: answers
PASS  https://<이름>.duckdns.org/health: answers
PASS  CORS: https://team-app.vercel.app may call the API
PASS  sign-in: required
PASS  speech model: loaded (base)
PASS  follow-up model: loaded (LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF/EXAONE-4.0-1.2B-Q4_K_M.gguf)
PASS  memory: 40% of 3.8 GB in use
```

- 서비스를 막 시작했으면 모델 줄이 `WARN … still loading`일 수 있다. 1분 뒤 다시 돌린다.
- `FAIL` 줄에는 원인 짐작과 볼 곳이 함께 나온다. 아래 13절도 본다.
- 이 PC에서 개발 모드로 돌려 본 결과: 로컬 API, 두 모델, 메모리 줄은 PASS였다. https·CORS(도메인 없음)와 sign-in(개발 모드)은 예상대로 FAIL이었다.

## 7. 팀에 알릴 것

- **팀 웹 배포 설정:** `VITE_API_URL=https://<이름>.duckdns.org`
- **크롬 확장:** 앱이 이미 모든 `chrome-extension://` 출처를 허용한다(`backend/app/main.py`). 확장 쪽에서는 API 주소만 바꾸면 된다.

## 8. 첫 실사용 점검 (사람이 한다)

팀 웹에서 로컬 전용이 아닌 실제 팀 계정으로 로그인한다. 다음을 한 번 끝까지 해 본다.
1. 연습을 시작하고 답변 하나를 녹음한다.
2. 전사문이 나오는지 본다.
3. "Ask a Follow-up"을 눌러 꼬리질문이 나오는지 본다.
4. 연습을 끝내고 회고 화면이 열리는지 본다.

막히는 곳이 있으면 그 단계와 `sudo journalctl -u jobseeker-api --since "10 min ago"` 출력을 알려 준다.

## 9. ARM 서버에서 꼬리질문 속도 다시 재기

이 PC(Intel i7, 2스레드)에서 잰 값은 평균 약 6초, 최대 19초였다. 서버에서도 한 번 잰다. 예시 답변 10개로 2~3분 걸린다.

```bash
cd /opt/jobseeker/backend
sudo -u jobseeker HF_HOME=/var/lib/jobseeker/hf .venv/bin/python evals/followup_probe.py \
  --repo LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF --file EXAONE-4.0-1.2B-Q4_K_M.gguf --threads 2 > /tmp/probe.md
grep -A6 "### 요약" /tmp/probe.md
```

- 요약을 [followup-model-check.md](followup-model-check.md)에 붙인다.
- API 서비스가 도는 동안 재면, 모델이 메모리에 두 번 올라와 약 1 GB를 더 쓴다. 4 GB 서버에서는 견딜 만하다.
- 평균이 20초를 넘거나 최대가 45초(꼬리질문 시간 상한)에 가까우면 알려 준다. 그때는 상한이나 모델을 다시 정한다.

## 10. 코드 업데이트

```bash
sudo git -C /opt/jobseeker pull
sudo /opt/jobseeker/scripts/practice-track/deploy/install.sh <이름>.duckdns.org
```

다시 실행해도 `/etc/jobseeker/api.env`는 그대로 두고, 패키지·서비스 파일·Caddy 설정만 맞춘 뒤 API를 다시 시작한다.

## 11. 회수 방지와 다시 만들기

- **회수 기준:** 7일 동안 CPU(95번째 백분위수)·네트워크·메모리가 모두 20% 미만이면 회수될 수 있다(Oracle "Always Free Resources" 문서).
- **이 배포가 기준을 넘기는 방법:** 두 모델을 시작할 때 메모리에 올려 둔다(`LOCAL_STT_PRELOAD`, `FOLLOWUP_PRELOAD`). 꼬리질문 모델은 파일을 매핑하지 않고 메모리로 읽어서, 사용 중 메모리로 잡힌다.
- **확인:** 점검 도구의 `memory` 줄이 20% 미만이면 WARN이 나온다. 모델 하나가 불러와지지 않았을 때가 대부분이다.
- **그래도 회수되면:**
  1. 2단계부터 새 인스턴스를 만든다.
  2. DuckDNS의 IP를 새 공인 IP로 바꾼다.
  3. 4단계 설치를 다시 한다.
  4. 보관해 둔 `api.env` 사본을 `/etc/jobseeker/api.env`에 넣는다.
- **데이터:** 연습 기록과 녹음은 Supabase에 있어서 서버를 다시 만들어도 남는다.

## 12. 동시 사용

- 전사와 꼬리질문은 각각 한 번에 하나씩 처리한다. 다른 요청은 차례를 기다린다. 전사는 60초, 꼬리질문은 45초를 넘게 기다리면 실패로 답하거나 고정 문장을 쓴다.
- 전사와 꼬리질문이 겹치면 2코어를 나눠 써서 둘 다 느려진다.
- 동시 사용자 부하 시험은 하지 않았다. 많은 사람이 동시에 쓰는 서비스로는 맞지 않는다(설계에서 받아들인 한계).

## 13. 문제 해결

| 증상 | 볼 곳과 할 일 |
|---|---|
| https 줄이 FAIL, 인증서 발급 실패 | DuckDNS IP가 맞는지, 콘솔 보안 목록에 80·443이 있는지 확인한다. `sudo journalctl -u caddy --since "30 min ago"`를 본다. 80번이 열려 있어야 인증서가 나온다 |
| https는 되는데 502 | API가 꺼져 있다. `sudo systemctl status jobseeker-api`, `sudo journalctl -u jobseeker-api -n 100` |
| API가 시작하자마자 꺼짐 | 설정 오류다. 로그 첫 줄에 어떤 설정이 문제인지 나온다(예: `SUPABASE_URL`) |
| DB 연결 실패 | `DATABASE_URL`이 **세션 풀러** 주소(`…pooler.supabase.com:5432`)인지, 비밀번호를 바꿔 넣었는지 확인한다 |
| `import llama_cpp`가 "Illegal instruction"으로 실패 | 미리 빌드된 패키지가 이 CPU와 맞지 않는 경우다. 아래 명령으로 서버에서 직접 빌드한다(10분 안팎) |
| 모델 줄이 FAIL(내려받기) | 서버에서 Hugging Face에 접속할 수 있는지 확인하고 `install.sh`를 다시 실행한다 |

```bash
sudo apt-get install -y build-essential cmake
sudo CMAKE_ARGS="-DGGML_NATIVE=ON" /opt/jobseeker/backend/.venv/bin/pip install --no-binary llama-cpp-python \
  --force-reinstall llama-cpp-python==0.3.36
sudo systemctl restart jobseeker-api
```

## 14. 라이선스 표기

꼬리질문 모델 EXAONE 4.0 1.2B는 **EXAONE AI Model License 1.2 - NC**(연구·교육용, 상업 사용 금지)다.
- 학교 과제와 발표에는 쓸 수 있다.
- 발표 자료에 모델 출처(LG AI Research, EXAONE)를 표기한다.
- 실제 서비스로 운영하려면 모델을 바꿔야 한다.
- 자세한 내용: [followup-model-check.md](followup-model-check.md)의 라이선스 절.

## 15. 이번에 확인하지 못한 것

- **실제 Oracle ARM 서버에서 설치 스크립트를 끝까지 돌려 보지 않았다.** 스크립트는 문법 검사, shellcheck, 설정 파일 배치 시험만 거쳤다. Caddy 설정은 Caddy 2.11.9로 읽어 확인했다. 처음 설치에서 막히면 그 출력을 알려 준다.
- ARM 서버에서의 전사·꼬리질문 속도(9절에서 잰다).
- 팀 Supabase 실제 연결(접속 정보를 받은 뒤).
- 동시 사용자 부하.
