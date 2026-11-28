# Azure 서버에 연습 API 배포하기

연습 API(녹음 전사, 꼬리질문, 연습 기록)를 **Azure for Students** 크레딧으로 만든 Ubuntu 서버에 올리는 순서다. 다 하면 팀 웹이 `https://team-api.duckdns.org`로 API를 부른다.

- 전사와 꼬리질문은 이 서버의 CPU에서 돈다. 녹음이나 답변을 외부 AI 서비스로 보내지 않는다.
- 설치는 스크립트 하나(`scripts/practice-track/deploy/install.sh`)가 한다. 사람이 할 일은 구독 만들기, VM 만들기, 설정값 채우기, 점검이다.
- 시연할 때만 쓰고 끝나면 지운다(11절). 연습 기록과 녹음은 Supabase에 있어서 서버를 지워도 남는다.
- 처음 계획은 Oracle 무료 서버였다: [2026-11-16-oracle-deploy-plan.md](2026-11-16-oracle-deploy-plan.md). 가입이 되지 않아 Azure로 바꿨다. 설치 스크립트는 그대로 쓴다.

## 1. 준비물

- **Azure for Students 구독:** 학교 계정(`@g.skku.edu`)으로 학생 인증을 하면 카드 없이 크레딧 $100을 받는다. 크레딧이 다 떨어지면 과금되지 않고 서버가 멈춘다.
- **DuckDNS:** `team-api.duckdns.org`(만들어 둠).
- **Supabase 값:** 이 PC의 `~/jobseeker-team.env`에 있다(팀 Supabase에 이미 적용·확인함).
- **팀 웹 주소:** `https://jobseeker-topaz-three.vercel.app`(GitHub 저장소 소개란의 홈페이지, Vercel 배포). `CORS_ORIGINS`에 넣는다.

## 2. 구독 만들기 (처음 한 번)

1. https://portal.azure.com 홈의 **Microsoft Azure for Students → 시작**을 누른다.
2. 학교 메일로 학생 인증을 한다. 휴대폰 인증을 요구하면 한다. 카드를 묻는 화면이 나오면 진행하지 말고 멈춘다(학생 구독이 아닌 평가판이다).
3. 끝나면 포털 위 검색창에 **구독**을 쳐서 `Azure for Students` 구독이 보이는지 확인한다. **비용 관리**에서 남은 크레딧을 볼 수 있다.

## 3. VM 만들기

포털 검색창 → **가상 머신** → **만들기 → Azure 가상 머신**.

**기본 사항 탭**
| 항목 | 값 |
|---|---|
| 구독 | Azure for Students |
| 리소스 그룹 | 새로 만들기 → `jobseeker` (나중에 이 그룹째 지우면 깔끔하다) |
| 가상 머신 이름 | `jobseeker-api` |
| 지역 | **(Asia Pacific) Korea Central**. "이 지역은 허용되지 않음" 오류가 나면 오류에 나온 허용 목록에서 가까운 곳(Japan East, East Asia 등)을 고른다 |
| 가용성 옵션 | 인프라 중복 필요 없음 |
| 보안 유형 | 표준 |
| 이미지 | **Ubuntu Server 24.04 LTS - x64 Gen2** |
| 크기 | **Standard_B2s (2 vCPU, 4 GiB)**. 없거나 할당량 오류면 `Standard_B2as_v2` 또는 `Standard_B2als_v2`(둘 다 2 vCPU·4 GiB 이상) |
| 인증 형식 | SSH 공개 키 |
| 사용자 이름 | `azureuser` |
| SSH 공개 키 원본 | 새 키 쌍 생성, 키 쌍 이름 `jobseeker-key` |
| 공용 인바운드 포트 | 선택한 포트 허용 → **SSH (22), HTTP (80), HTTPS (443)** |

- 메모리 4 GiB가 필요한 이유: 두 모델을 올린 API가 약 1.2 GB, OS까지 약 1.6 GB를 쓴다. 2 GiB(B1ms 등)는 빠듯하다.

**디스크 탭**
- OS 디스크 유형: **표준 SSD**(프리미엄보다 싸다). 크기는 기본값(30 GiB)이면 된다.

**네트워킹 탭**
- 공용 IP는 새로 만들어지는 기본값 그대로 둔다(Standard, 고정 IP라 서버를 껐다 켜도 바뀌지 않는다).
- "VM이 삭제되면 공용 IP 및 NIC 삭제"를 켠다.

**관리 탭**
- **자동 종료**는 끈다(시연 중 꺼지면 안 된다). 비용은 11절처럼 직접 관리한다.

**검토 + 만들기 → 만들기**를 누르면 개인 키 내려받기 창이 뜬다. **키 다운로드 및 리소스 만들기**를 누른다. `jobseeker-key.pem`을 잃으면 서버에 들어갈 수 없다.

만든 뒤 VM 개요 화면에서 **공용 IP 주소**를 적어 둔다.

## 4. 도메인 연결 (DuckDNS)

1. https://www.duckdns.org 에서 `team-api`의 **current ip**에 3절의 공용 IP를 넣고 **update ip**를 누른다.
2. 내 컴퓨터에서 `nslookup team-api.duckdns.org`가 그 IP를 보여 주면 된다(몇 분 걸릴 수 있다).

## 5. 설치

내려받은 키를 WSL로 옮기고 접속한다(Windows 다운로드 폴더 기준).

```bash
mkdir -p ~/.ssh && cp /mnt/c/Users/<윈도우 사용자>/Downloads/jobseeker-key.pem ~/.ssh/ && chmod 600 ~/.ssh/jobseeker-key.pem
ssh -i ~/.ssh/jobseeker-key.pem azureuser@<공용 IP>
```

서버 안에서:

```bash
sudo git clone https://github.com/seungxa/26-2_CapstoneProject.git /opt/jobseeker
sudo /opt/jobseeker/scripts/practice-track/deploy/install.sh team-api.duckdns.org
```

스크립트가 하는 일(처음에는 10~20분):
1. 시스템 패키지와 Caddy(https 프록시, 공식 저장소)를 설치한다.
2. `jobseeker` 서비스 사용자와 `/var/lib/jobseeker` 폴더를 만든다.
3. `/etc/jobseeker/api.env`(설정 파일)를 틀에서 만든다. 이미 있으면 건드리지 않는다.
4. 파이썬 가상환경에 검증한 버전(`requirements-lock.txt`)을 설치한다.
5. API 서비스(`jobseeker-api`)와 Caddy를 등록한다. 재부팅해도 둘 다 다시 뜬다.
6. 서버 안 방화벽에서 80·443을 연다(Azure 이미지는 원래 열려 있어서 바뀌는 것이 없다. 바깥 방화벽은 3절의 인바운드 포트다).
7. 전사 모델(Whisper base, 약 145 MB)과 꼬리질문 모델(EXAONE 1.2B, 약 775 MB)을 Hugging Face에서 한 번 받는다.
8. 설정 파일에 아직 `<…>` 칸이 남아 있으면 API를 시작하지 않고 그렇다고 알려 준다.

## 6. 설정값 채우기

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
- 팀 Supabase에 앱 테이블을 넣는 순서와, 값을 채운 뒤 Supabase 연결만 따로 확인하는 도구(`check_supabase.py`)는 [supabase-apply.md](supabase-apply.md)에 있다.
- 이 PC의 `~/jobseeker-team.env`에 같은 값이 있다. 그 파일 내용을 옮겨 적으면 된다.
- 채운 파일은 저장소에 올리지 않는다. 비밀번호 관리자 같은 안전한 곳에 사본을 하나 둔다(서버를 다시 만들 때 쓴다).

저장한 뒤:

```bash
sudo systemctl restart jobseeker-api
```

## 7. 점검

```bash
python3 /opt/jobseeker/scripts/practice-track/deploy/check_server.py --domain team-api.duckdns.org --origin <팀 웹 주소>
```

정상이면 모든 줄이 `PASS`다.

```
PASS  http://127.0.0.1:8000/health: answers
PASS  https://team-api.duckdns.org/health: answers
PASS  CORS: https://jobseeker-topaz-three.vercel.app may call the API
PASS  sign-in: required
PASS  speech model: loaded (base)
PASS  follow-up model: loaded (LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF/EXAONE-4.0-1.2B-Q4_K_M.gguf)
PASS  memory: 40% of 3.8 GB in use
```

- 서비스를 막 시작했으면 모델 줄이 `WARN … still loading`일 수 있다. 1분 뒤 다시 돌린다.
- `FAIL` 줄에는 원인 짐작과 볼 곳이 함께 나온다. 아래 14절도 본다.

## 8. 팀에 알릴 것

- **팀 웹 배포 설정(Vercel 환경 변수):** `VITE_API_URL=https://team-api.duckdns.org`. 지금 배포본은 `http://localhost:8000`으로 빌드되어 있다. 넣은 뒤 다시 배포해야 반영된다.
- 시선 실측을 통과하면 `VITE_GAZE_DIRECTION=true`도 넣는다([waiting-checklist.md](waiting-checklist.md) 3절).
- **크롬 확장:** 지금 팀 확장(seungxa 0.7.0)은 이 API를 부르지 않는다. 할 일 없음.

## 9. 첫 실사용 점검 (사람이 한다)

팀 웹에서 로컬 전용이 아닌 실제 팀 계정으로 로그인한다. 다음을 한 번 끝까지 해 본다.
1. 연습을 시작하고 답변 하나를 녹음한다.
2. 전사문이 나오는지 본다.
3. "Ask a Follow-up"을 눌러 꼬리질문이 나오는지 본다.
4. 연습을 끝내고 회고 화면이 열리는지 본다.

막히는 곳이 있으면 그 단계와 `sudo journalctl -u jobseeker-api --since "10 min ago"` 출력을 알려 준다.

## 10. 서버에서 꼬리질문 속도 다시 재기

이 PC(Intel i7, 2스레드)에서 잰 값은 평균 약 6초, 최대 19초였다. 서버에서도 한 번 잰다. 예시 답변 10개로 2~3분 걸린다.

```bash
cd /opt/jobseeker/backend
sudo -u jobseeker HF_HOME=/var/lib/jobseeker/hf .venv/bin/python evals/followup_probe.py \
  --repo LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF --file EXAONE-4.0-1.2B-Q4_K_M.gguf --threads 2 > /tmp/probe.md
grep -A6 "### 요약" /tmp/probe.md
```

- 요약을 [followup-model-check.md](followup-model-check.md)에 붙인다.
- API 서비스가 도는 동안 재면, 모델이 메모리에 두 번 올라와 약 1 GB를 더 쓴다. 4 GiB 서버에서는 견딜 만하다.
- 평균이 20초를 넘거나 최대가 45초(꼬리질문 시간 상한)에 가까우면 알려 준다. 그때는 상한이나 모델을 다시 정한다.

## 11. 코드 업데이트

```bash
sudo git -C /opt/jobseeker pull
sudo /opt/jobseeker/scripts/practice-track/deploy/install.sh team-api.duckdns.org
```

다시 실행해도 `/etc/jobseeker/api.env`는 그대로 두고, 패키지·서비스 파일·Caddy 설정만 맞춘 뒤 API를 다시 시작한다.

## 12. 비용과 정리

- **대략의 비용:** B2s VM + 표준 SSD 30 GiB + 고정 공용 IP로 한 달 $40 안팎이다(지역마다 다르다). 정확한 값은 포털 **비용 관리 → 비용 분석**에서 본다.
- **며칠 안 쓸 때:** VM 화면의 **중지**를 누른다. "할당 취소됨"이 되면 VM 요금은 멈추고, 디스크·공용 IP 요금만 조금 나간다. 다시 **시작**하면 같은 IP로 돌아온다(서비스도 자동으로 뜬다).
- **시연이 끝나면:** 리소스 그룹 `jobseeker`를 통째로 **삭제**한다. VM, 디스크, IP가 함께 지워져 더는 크레딧이 나가지 않는다.
- **다시 만들 때:** 3절부터 다시 하고, DuckDNS IP를 새 공용 IP로 바꾸고, `~/jobseeker-team.env` 값으로 6절을 채운다.
- 크레딧($100)을 다 쓰면 구독이 멈춘다. 카드를 등록하지 않았으므로 자동으로 청구되지 않는다.

## 13. 동시 사용

- 전사와 꼬리질문은 각각 한 번에 하나씩 처리한다. 다른 요청은 차례를 기다린다. 전사는 60초, 꼬리질문은 45초를 넘게 기다리면 실패로 답하거나 고정 문장을 쓴다.
- 전사와 꼬리질문이 겹치면 2코어를 나눠 써서 둘 다 느려진다.
- B 시리즈 VM은 평소 CPU를 덜 쓰다가 몰릴 때 크레딧을 꺼내 쓰는 방식이다. 시연 정도의 사용에는 문제가 없다.
- 동시 사용자 부하 시험은 하지 않았다. 많은 사람이 동시에 쓰는 서비스로는 맞지 않는다(설계에서 받아들인 한계).

## 14. 문제 해결

| 증상 | 볼 곳과 할 일 |
|---|---|
| https 줄이 FAIL, 인증서 발급 실패 | DuckDNS IP가 맞는지, VM의 **네트워킹 → 네트워크 설정**(네트워크 보안 그룹)에 80·443 인바운드 규칙이 있는지 확인한다. `sudo journalctl -u caddy --since "30 min ago"`를 본다. 80번이 열려 있어야 인증서가 나온다 |
| https는 되는데 502 | API가 꺼져 있다. `sudo systemctl status jobseeker-api`, `sudo journalctl -u jobseeker-api -n 100` |
| API가 시작하자마자 꺼짐 | 설정 오류다. 로그 첫 줄에 어떤 설정이 문제인지 나온다(예: `SUPABASE_URL`) |
| DB 연결 실패 | `DATABASE_URL`이 **세션 풀러** 주소(`…pooler.supabase.com:5432`)인지, 비밀번호를 바꿔 넣었는지 확인한다 |
| `import llama_cpp`가 "Illegal instruction"으로 실패 | 미리 빌드된 패키지가 이 CPU와 맞지 않는 경우다. 아래 명령으로 서버에서 직접 빌드한다(10분 안팎) |
| 모델 줄이 FAIL(내려받기) | 서버에서 Hugging Face에 접속할 수 있는지 확인하고 `install.sh`를 다시 실행한다 |

```bash
sudo apt-get install -y build-essential cmake
sudo CMAKE_ARGS="-DGGML_NATIVE=ON" /opt/jobseeker/backend/.venv/bin/pip install --no-binary llama-cpp-python \
  --force-reinstall --no-deps llama-cpp-python==0.3.36
sudo systemctl restart jobseeker-api
```

## 15. 라이선스 표기

꼬리질문 모델 EXAONE 4.0 1.2B는 **EXAONE AI Model License 1.2 - NC**(연구·교육용, 상업 사용 금지)다.
- 학교 과제와 발표에는 쓸 수 있다.
- 발표 자료에 모델 출처(LG AI Research, EXAONE)를 표기한다.
- 실제 서비스로 운영하려면 모델을 바꿔야 한다.
- 자세한 내용: [followup-model-check.md](followup-model-check.md)의 라이선스 절.

## 16. 이번에 확인하지 못한 것

- **실제 Azure VM에서 설치 스크립트를 끝까지 돌려 보지 않았다.** 스크립트는 문법 검사와 설정 파일 배치 시험만 거쳤다. 처음 설치에서 막히면 그 출력을 알려 준다.
- 서버에서의 전사·꼬리질문 속도(10절에서 잰다).
- 동시 사용자 부하.
