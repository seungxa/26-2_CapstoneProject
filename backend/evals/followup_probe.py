"""꼬리질문 모델 시험(사람이 읽는 표). 서버와 같은 방식으로 모델을 불러, 고정 샘플 10개에 꼬리질문을 만들고 검증한다.

  cd backend && .venv/bin/python evals/followup_probe.py --repo <repo> --file <file> --threads 2

- 불러오기: app.followup_model._loader 그대로(캐시 먼저, 없을 때만 Hugging Face에서 한 번 내려받기).
  내려받기 시간은 따로 재서 첫 로딩 시간에 섞지 않는다.
- 생성: 서버와 같은 build_messages(초점 specificity), N_CTX·MAX_TOKENS·TEMPERATURE, validate_followup.
- 결과는 마크다운으로 stdout에 낸다. 통과 수는 형식 검증(한국어·길이·질문 꼴·금지어·지어낸 숫자)만 뜻한다.
  질문이 쓸 만한지는 사람이 원문을 읽고 판단한다(표의 빈 칸).
- 한 번 실행에 모델 하나만 올린다. 다음 후보는 새로 실행한다(메모리가 작은 기계 기준).
"""
import argparse
import os
import platform
import resource
import statistics
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app import followup_model  # noqa: E402
from app.followup_model import MAX_TOKENS, N_CTX, TEMPERATURE  # noqa: E402
from app.followup_text import MAX_TRANSCRIPT_CHARS, build_messages, validate_followup  # noqa: E402

FOCUS = "specificity"  # 엔드포인트가 넘기는 값(coaching.build_report의 followup.focus)
PASS_MIN = 7
AVG_MAX_SEC = 20.0

_LONG = (
    "음, 제가 가장 힘들었던 경험은 대학교 3학년 때 했던 캡스톤 프로젝트였습니다. 그때 저희 팀은 다섯 명이었는데, "
    "학기 초에 주제를 정하는 데만 한 달 가까이 걸렸어요. 처음에는 다들 의욕이 넘쳐서 이것저것 기능을 많이 넣자고 했는데, "
    "막상 개발을 시작해 보니까 일정이 전혀 맞지 않았습니다. 저는 백엔드를 맡았고, 데이터베이스 설계랑 서버 API를 만드는 일을 "
    "했습니다. 문제는 중간 발표를 2주 앞두고 생겼는데요, 팀원 한 명이 개인 사정으로 휴학을 하게 되면서 그 친구가 맡고 있던 "
    "프런트엔드 화면 절반이 그대로 비어 버렸습니다. 그때 솔직히 많이 당황했고, 팀 분위기도 꽤 가라앉았어요. 누가 그 일을 "
    "맡을지를 두고 서로 눈치만 보는 상황이 며칠 이어졌습니다. 저는 이대로 가면 중간 발표 자체를 못 할 수도 있겠다는 생각이 "
    "들어서, 먼저 남은 일을 전부 목록으로 적어 봤습니다. 화면 하나하나를 적고, 각 화면에 필요한 API가 이미 준비됐는지, "
    "디자인이 나왔는지를 표로 정리했어요. 그렇게 보니까 생각보다 정말 급한 건 로그인, 메인 목록, 상세 화면 이렇게 세 개였고, "
    "나머지는 중간 발표 뒤로 미뤄도 되는 것들이었습니다. 그래서 팀 회의 때 그 표를 보여 주면서, 중간 발표에서는 핵심 흐름 "
    "하나만 제대로 보여 주자고 제안했습니다. 처음에는 기능을 줄이는 걸 아쉬워하는 팀원도 있었는데, 표를 같이 보면서 하나씩 "
    "이야기하다 보니 다들 동의해 줬어요. 그리고 제가 백엔드 일이 어느 정도 끝나 있었기 때문에, 프런트엔드 화면 중 상세 화면은 "
    "제가 직접 맡겠다고 했습니다. 사실 저는 리액트를 거의 써 본 적이 없어서, 그 주에는 밤마다 공식 문서랑 예제를 보면서 따라 "
    "만들었습니다. 다른 팀원이 만든 컴포넌트 코드를 읽으면서 스타일을 맞추려고 했고, 모르는 부분은 그 친구한테 바로바로 "
    "물어봤어요. 그렇게 해서 중간 발표 전날 밤에 겨우 세 화면을 연결할 수 있었습니다. 발표 당일에는 시연이 한 번 멈추는 일이 "
    "있었는데, 미리 녹화해 둔 영상으로 대신 보여 줘서 큰 문제 없이 넘어갔습니다. 교수님께서는 기능이 적은 대신 흐름이 "
    "분명하다고 평가해 주셨고, 저희 팀은 그 피드백을 바탕으로 남은 기능의 우선순위를 다시 정했습니다. 기말 발표 때는 처음 "
    "계획했던 기능의 70% 정도를 완성했고, 학기 말에는 실제로 학과 친구들 30명 정도에게 써 보게 해서 의견을 받았습니다. "
    "이 경험을 통해서 제가 배운 건, 일이 막혔을 때 누가 해 주기를 기다리기보다는 남은 일을 눈에 보이게 정리하는 게 먼저라는 "
    "점이었습니다. 그리고 제 역할이 아니더라도 팀에 꼭 필요한 일이면 먼저 손을 드는 게 결국 저한테도 성장이 된다는 걸 "
    "느꼈습니다. 그 뒤로는 다른 프로젝트를 할 때도 처음부터 일의 목록과 우선순위를 표로 만들어 두고, 매주 한 번씩 팀원들과 "
    "같이 확인하는 습관을 들였습니다. 그 프로젝트는 나중에 학과 전시회에도 나가게 됐는데, 전시회 날에는 제가 직접 부스를 "
    "지키면서 찾아오신 분들께 서비스를 설명해 드렸고, 그때 받은 질문과 개선 의견을 문서로 정리해서 다음 학기에 같은 주제를 "
    "이어받은 후배들에게 넘겨주었습니다. 지금 생각해 보면 그때가 가장 힘들었지만, 동시에 가장 많이 배운 시기였다고 생각합니다."
)

# (유형, 질문, 답변 전사문). 유형 이름은 계획이 요구한 경우(수치 있음·수치 없음·아주 짧음·1,500자 초과·팀 경험)를 드러낸다.
SAMPLES: list[tuple[str, str, str]] = [
    ("수치 있음", "가장 성과가 좋았던 프로젝트를 말씀해 주세요.",
     "졸업 프로젝트로 학교 도서관 좌석 예약 앱을 만들었습니다. 처음에는 예약 페이지가 뜨는 데 평균 3.5초가 걸렸는데, "
     "쿼리를 다시 짜고 캐시를 넣어서 0.8초까지 줄였습니다. 한 학기 동안 사용자가 800명 정도 생겼고, 예약해 놓고 오지 않는 "
     "비율도 18%에서 7%로 떨어졌습니다."),
    ("수치 없음", "팀원과 의견이 충돌했던 경험이 있나요?",
     "인턴 때 디자이너분과 화면 구성을 두고 의견이 달랐습니다. 저는 기능을 한 화면에 모으자고 했고 디자이너분은 단계를 "
     "나누자고 했습니다. 서로 주장만 하다가는 결론이 안 날 것 같아서, 실제 사용자 몇 분께 두 안을 보여 드리고 반응을 같이 "
     "보자고 제안했습니다. 결과적으로 단계를 나누는 쪽이 더 이해하기 쉽다는 의견이 많아서 그 안으로 정했고, 저도 그 과정에서 "
     "제 생각만 고집하지 않는 법을 배웠습니다."),
    ("아주 짧음", "본인의 강점은 무엇이라고 생각하나요?", "끈기입니다."),
    ("1,500자 초과", "지금까지 가장 힘들었던 경험과 어떻게 극복했는지 말씀해 주세요.", _LONG),
    ("팀 경험(우리)", "팀 프로젝트에서 맡은 역할을 말씀해 주세요.",
     "우리 팀은 네 명이었고 우리는 동아리 행사 신청 사이트를 만들었습니다. 우리가 제일 고생한 건 마감 직전에 결제 연동이 "
     "안 됐던 일인데, 우리 모두 밤을 새워서 결국 해결했습니다. 발표도 우리가 같이 준비했고 좋은 평가를 받았습니다."),
    ("지원 동기(수치 없음)", "우리 회사에 지원한 이유는 무엇인가요?",
     "평소에 이 회사 앱을 자주 썼는데, 결제 과정이 정말 간단하다고 느꼈습니다. 저도 사용자가 고민하지 않고 쓸 수 있는 "
     "서비스를 만들고 싶어서 지원했습니다. 특히 최근에 공개하신 기술 블로그에서 결제 오류를 줄인 과정을 읽고, 이런 문제를 "
     "같이 풀어 보고 싶다고 생각했습니다."),
    ("실패 경험", "실패했던 경험을 말씀해 주세요.",
     "공모전에 나가서 본선에 못 올라간 적이 있습니다. 아이디어는 좋았는데 시연 영상을 마감 하루 전에야 만들기 시작해서 "
     "완성도가 떨어졌습니다. 그 뒤로는 일정을 거꾸로 계산해서 결과물을 먼저 만들고 다듬는 습관을 들였습니다."),
    ("기술 질문(영어 용어)", "REST API와 GraphQL의 차이를 설명해 주세요.",
     "REST는 자원마다 URL을 두고 GET, POST 같은 HTTP 메서드로 다루는 방식이고, GraphQL은 엔드포인트 하나에 클라이언트가 "
     "필요한 필드를 쿼리로 골라서 요청하는 방식입니다. 그래서 GraphQL은 over-fetching을 줄일 수 있지만, 캐싱이 REST보다 "
     "까다롭다고 알고 있습니다. 프로젝트에서는 REST만 써 봤습니다."),
    ("말하기 전사(군말, 수치 있음)", "일정이 늦어졌을 때 어떻게 대처했나요?",
     "어... 그 학교 축제 앱을 만들 때였는데요, 음, 디자인이 늦게 나와서 개발 일정이 한 2주 정도 밀렸었어요. 그래서 그, "
     "꼭 필요한 기능만 먼저 정리해서 축제 전에 내보내고, 나머지는 축제 끝나고 업데이트했습니다. 어, 그때 교수님께도 미리 "
     "말씀드려서 일정을 조정했고요."),
    ("자기소개(수치 있음)", "1분 자기소개 해 주세요.",
     "안녕하세요, 컴퓨터공학을 전공한 지원자입니다. 3년 동안 학과 학생회에서 웹사이트를 관리하면서, 사람들이 실제로 쓰는 "
     "서비스를 만드는 재미를 알게 됐습니다. 백엔드 개발에 관심이 많아서 Spring과 FastAPI로 프로젝트를 네 개 진행했고, "
     "그중 하나는 교내 해커톤에서 2등을 했습니다."),
]
assert len(SAMPLES) == 10 and len(_LONG) > 1500


def _cell(text: str) -> str:
    """원문을 표 한 칸에 넣는다. 줄바꿈은 ⏎로 보이게 하고 |는 이스케이프한다."""
    return (text or "").replace("|", "\\|").replace("\r", "").replace("\n", " ⏎ ").strip() or "(빈 출력)"


def _samples_markdown() -> str:
    """사람이 출력을 판단할 때 볼 입력. 1,500자 넘는 답변도 모두 싣고, 모델에 들어간 범위를 적는다."""
    lines = ["| # | 유형 | 질문 | 답변 전사문 |", "|---|---|---|---|"]
    for i, (kind, question, transcript) in enumerate(SAMPLES, 1):
        cut = (f" **(전체 {len(transcript)}자 중 앞 {MAX_TRANSCRIPT_CHARS}자만 모델에 들어감)**"
               if len(transcript) > MAX_TRANSCRIPT_CHARS else "")
        lines.append(f"| {i} | {kind} | {_cell(question)} | {_cell(transcript)}{cut} |")
    return "\n".join(lines)


def _environment(threads: int, temperature: float) -> list[str]:
    cpu = next((ln.split(":", 1)[1].strip() for ln in Path("/proc/cpuinfo").read_text().splitlines()
                if ln.startswith("model name")), platform.processor() or "?")
    mem = next((ln.split()[1] for ln in Path("/proc/meminfo").read_text().splitlines() if ln.startswith("MemTotal")), "0")
    avail = next((ln.split()[1] for ln in Path("/proc/meminfo").read_text().splitlines()
                  if ln.startswith("MemAvailable")), "0")
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=BACKEND_DIR, capture_output=True,
                             text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=BACKEND_DIR, capture_output=True,
                               text=True, check=True).stdout.strip()
        sha += " (작업 중 변경 있음)" if dirty else ""
    except (OSError, subprocess.CalledProcessError):
        sha = "?"
    import llama_cpp
    return [f"- CPU: {cpu}, 논리 코어 {os.cpu_count()}개 중 {threads}스레드 사용",
            f"- RAM: 전체 {int(mem) / 1048576:.1f} GB, 시작 때 사용 가능 {int(avail) / 1048576:.1f} GB",
            f"- OS: {platform.platform()}, Python {platform.python_version()}, llama-cpp-python {llama_cpp.__version__}",
            f"- Git: {sha}",
            f"- 생성 조건: n_ctx {N_CTX}, max_tokens {MAX_TOKENS}, temperature {temperature}, "
            f"전사문 앞 {MAX_TRANSCRIPT_CHARS}자, 초점 {FOCUS}"]


def _fetch(repo: str, name: str, cache: str | None) -> tuple[str, float | None]:
    """모델 파일 경로와 내려받는 데 걸린 초(캐시에 있었으면 None). 서버 _loader와 같은 hf_hub_download 호출."""
    from huggingface_hub import hf_hub_download
    try:
        return hf_hub_download(repo_id=repo, filename=name, cache_dir=cache, local_files_only=True), None
    except OSError:
        started = time.perf_counter()
        path = hf_hub_download(repo_id=repo, filename=name, cache_dir=cache)
        return path, time.perf_counter() - started


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo", help="Hugging Face 저장소(repo_id)")
    p.add_argument("--file", help="저장소 안의 GGUF 파일 이름")
    p.add_argument("--threads", type=int, default=2, help="CPU 스레드 수(n_threads와 n_threads_batch)")
    p.add_argument("--cache-dir", default="", help="모델 캐시 폴더(비우면 Hugging Face 기본 캐시)")
    p.add_argument("--samples", action="store_true", help="모델 없이 샘플 입력만 마크다운으로 낸다")
    p.add_argument("--seed", type=int, default=None,
                   help="샘플마다 이 시드로 생성(출력 흔들림을 볼 때). 비우면 서버처럼 시드를 주지 않는다: "
                        "llama-cpp-python이 호출마다 앞 시드에서 다음 시드를 만들므로 출력이 호출 순서에 달린다")
    p.add_argument("--temperature", type=float, default=TEMPERATURE,
                   help=f"비교 실험용. 비우면 서버 값 {TEMPERATURE}")
    args = p.parse_args()
    if args.samples:
        print(_samples_markdown())
        return 0
    if not (args.repo and args.file):
        p.error("--repo and --file are required")

    seed_note = f"샘플마다 seed={args.seed}" if args.seed is not None else "시드 지정 없음(서버와 같음)"
    out = [f"## {args.repo} / {args.file}", "", "### 시험 환경", "", *_environment(args.threads, args.temperature),
           f"- 시드: {seed_note}"]
    if args.temperature != TEMPERATURE:
        out.append(f"- **비교 실험: temperature {args.temperature}(서버 값 {TEMPERATURE}과 다름)**")
    out.append("")
    cfg = SimpleNamespace(followup_model_repo=args.repo, followup_model_file=args.file,
                          followup_model_dir=args.cache_dir, followup_threads=args.threads,
                          followup_allow_download=True)
    try:
        path, download_s = _fetch(args.repo, args.file, args.cache_dir or None)
        started = time.perf_counter()
        model = followup_model._loader(cfg)  # 서버와 같은 불러오기(이제 캐시에 있으므로 내려받지 않는다)
        load_s = time.perf_counter() - started
    except Exception as e:  # 불러오기 실패도 결과다: 표에 남기고 실패로 끝낸다
        out += ["### 결과", "", f"- 불러오기 실패: `{type(e).__name__}: {_cell(str(e))[:300]}`",
                "- 판정: **실패**(불러오기)", ""]
        print("\n".join(out))
        return 1
    size_mb = Path(path).stat().st_size / 1048576
    rss_after_load = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

    rows, times, passed, prompt_tokens = [], [], 0, []
    for i, (kind, question, transcript) in enumerate(SAMPLES, 1):
        started = time.perf_counter()
        finish, usage = "", {}
        try:
            reply = model.create_chat_completion(messages=build_messages(question, transcript, FOCUS),
                                                 max_tokens=MAX_TOKENS, temperature=args.temperature, seed=args.seed)
            raw = reply["choices"][0]["message"]["content"] or ""
            finish, usage = reply["choices"][0].get("finish_reason") or "", reply.get("usage") or {}
            text, reason = validate_followup(raw, question, transcript)
        except Exception as e:  # 한 샘플의 실패(예: 문맥 초과)는 그 줄의 결과로 남긴다
            raw, text, reason = "", None, f"error ({type(e).__name__}: {str(e)[:120]})"
        sec = time.perf_counter() - started
        times.append(sec)
        passed += text is not None
        if usage.get("prompt_tokens"):
            prompt_tokens.append(usage["prompt_tokens"])
        tokens = f"{usage.get('prompt_tokens', '?')}+{usage.get('completion_tokens', '?')}"
        verdict = f"통과: {_cell(text)}" if text else f"실패: `{reason}`"
        rows.append(f"| {i} | {kind} | {len(transcript)} | {_cell(raw)} | {verdict} | {sec * 1000:.0f} | "
                    f"{tokens} | {finish or '?'} |  |")

    avg_s, max_s = statistics.mean(times), max(times)
    ok = passed >= PASS_MIN and avg_s <= AVG_MAX_SEC
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    longest = max(prompt_tokens) if prompt_tokens else None
    budget = (f"{longest} + {MAX_TOKENS} = {longest + MAX_TOKENS} / n_ctx {N_CTX} "
              f"({'들어감' if longest + MAX_TOKENS <= N_CTX else '넘침'})") if longest else "측정 못 함"
    out += ["### 요약", "",
            f"- 모델 파일: {size_mb:.0f} MB" + (f", 내려받기 {download_s:.1f}초(처음 한 번)" if download_s else ", 캐시에 있음"),
            f"- 첫 로딩: {load_s:.1f}초, 로딩 직후 최대 RSS {rss_after_load:.0f} MB, 시험 끝 최대 RSS {peak_rss:.0f} MB",
            f"- 생성 시간: 평균 {avg_s:.1f}초, 최대 {max_s:.1f}초, 합계 {sum(times):.1f}초",
            f"- 검증 통과: {passed}/{len(SAMPLES)}",
            f"- 가장 긴 입력 토큰 + 출력 상한: {budget}",
            f"- 판정: **{'통과' if ok else '실패'}** (불러오기 성공, {PASS_MIN}개 이상 통과, 평균 {AVG_MAX_SEC:.0f}초 이하)",
            "",
            "### 샘플별 결과", "",
            "통과 수는 형식 검증만 뜻한다. 질문이 쓸 만한지는 마지막 칸에 사람이 적는다.", "",
            "| # | 유형 | 답변 글자 수 | 원문 출력 | 검증 | 시간(ms) | 토큰(입력+출력) | 끝난 이유 | 사람 판단(쓸 만함/아님, 메모) |",
            "|---|---|---|---|---|---|---|---|---|", *rows, ""]
    print("\n".join(out))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
