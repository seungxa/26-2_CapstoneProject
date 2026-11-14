"""규칙 기반 도우미: 맞춤 질문 템플릿과 인용 확인. 외부 서비스를 부르지 않는다.

모듈 이름은 예전 OpenAI 호출 모듈(llm)을 그대로 쓴다. 맞춤 질문은 템플릿으로만 만들고, 답변 코칭은 coaching._basic이 한다.
"""
import re

from .config import settings


# ───────── 맞춤 질문(템플릿) ─────────

_EXPERIENCE_HINT = re.compile(r"(경험|프로젝트|담당|개선|해결|협업|리더|성과|달성|극복|도전)")


def template_questions(company: str, position: str, essay: str, count: int) -> list[dict]:
    """규칙 기반 맞춤 질문. 자소서 문장 중 경험 서술을 골라 꼬리질문을 만들고, 나머지는 회사·직무 템플릿으로 채운다."""
    company = company or "저희 회사"
    position = position or "해당 직무"
    qs: list[dict] = []
    def template(category, text, question_type, keys):
        item={"category":category,"text":text}
        if settings.practice_insights_enabled:
            item.update(question_type=question_type,competency_keys=keys,tagging_source="rule")
        return item
    sentences = [s.strip() for s in re.split(r"(?<=[.!?。])\s+|\n+", essay or "") if len(s.strip()) >= 15]
    for s in sentences:
        if _EXPERIENCE_HINT.search(s):
            quote = s if len(s) <= 60 else s[:57] + "…"
            qs.append(template("직무", f"자기소개서에 \"{quote}\"라고 쓰셨는데, 그때 본인의 역할과 결과를 구체적으로 설명해 주세요.", "behavioral", []))
        if len(qs) >= max(1, count // 2):
            break
    base = [
        template("기업", f"{company}에 지원한 이유와, 입사 후 {position}로서 이루고 싶은 목표를 말씀해 주세요.","motivation",[]),
        template("직무", f"{position} 직무에 필요한 역량은 무엇이라고 생각하며, 본인은 그 역량을 어떻게 갖췄나요?","self_description",["technical_expertise"]),
        template("상황", "팀원과 의견이 크게 엇갈렸던 상황에서 어떻게 조율했는지 말씀해 주세요.","behavioral",["communication","collaboration"]),
        template("인성", "가장 크게 실패했던 경험과 그 경험에서 배운 점을 말씀해 주세요.","behavioral",["adaptability"]),
        template("기업", f"{company}의 최근 사업이나 서비스 중 관심 있게 본 것과, 개선하고 싶은 점이 있다면 말씀해 주세요.","knowledge",["analytical_thinking"]),
        template("직무", f"입사 후 3년 안에 {position}로서 어떤 전문성을 쌓고 싶은지 말씀해 주세요.","motivation",[]),
    ]
    for q in base:
        if len(qs) >= count:
            break
        qs.append(q)
    return qs[:count]


# ───────── 인용 확인 ─────────

# 인용 앞뒤에 붙는 따옴표·말줄임표
_QUOTE_EDGES = re.compile(r"^(?:[\s\"'“”‘’「」『』…]|\.{2,})+|(?:[\s\"'“”‘’「」『』…]|\.{2,})+$")
# 느슨한 인용 비교: 문장부호·따옴표로 끊고, 홀로 쓰인 말버릇은 뺀다
_WORD = re.compile(r"[^\s.,!?…~·\"'“”‘’「」『』()\[\]]+")
_FILLERS = {"음", "어", "그"}
MIN_QUOTE_CHARS = 4  # 근거로 인정하는 인용의 최소 글자 수(공백·문장부호·말버릇 제외)


def _squash(text: str) -> str:
    return " ".join(text.split())


def _loose(text: str) -> tuple[str, list[int]]:
    """문장부호·말버릇을 뺀 비교용 문자열과, 그 글자마다 원래 문자열에서의 위치."""
    out: list[str] = []
    pos: list[int] = []
    for m in _WORD.finditer(text or ""):
        if m.group() in _FILLERS:
            continue
        if out:
            out.append(" ")
            pos.append(m.start())
        out.extend(m.group())
        pos.extend(range(m.start(), m.end()))
    return "".join(out), pos


def verify_quote(quote, transcript: str) -> tuple[str | None, bool | None]:
    """인용이 전사문의 실제 구간인지 확인한다. (인용, 확인 여부) — 비었으면 (None, None), 지어냈으면 (None, False).

    문장부호나 말버릇(음·어·그)만 다르면 같은 구간으로 보고, 화면에는 전사문의 그 구간을 그대로 보여준다.
    """
    if not isinstance(quote, str):
        return None, None
    q = _squash(_QUOTE_EDGES.sub("", quote))
    if not q:
        return None, None
    lq, _ = _loose(q)
    if not lq:  # 말버릇·문장부호뿐인 인용은 빈 인용으로 본다
        return None, None
    if len(lq.replace(" ", "")) < MIN_QUOTE_CHARS:  # '네', '저는'처럼 짧은 인용은 근거로 치지 않는다
        return None, False
    if q in _squash(transcript or ""):
        return q, True
    lt, pos = _loose(transcript or "")
    i = lt.find(lq)
    if i < 0:
        return None, False
    return _squash((transcript or "")[pos[i]: pos[i + len(lq) - 1] + 1]), True
