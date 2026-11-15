"""Prompt messages and output validation for the local follow-up question model."""
import re

MAX_TRANSCRIPT_CHARS = 1200
FORBIDDEN = ("감정", "기분", "외모", "성격", "자신감", "표정")

_FOCUS_LINES = {
    "specificity": "답변 속 상황·본인 행동·결과 중 빠진 것을 더 묻는다.",
}
_DEFAULT_FOCUS = "답변에서 더 알고 싶은 부분을 구체적으로 묻는다."

_SYSTEM = (
    "당신은 한국어로 면접을 진행하는 면접관입니다.\n"
    "지원자의 답변을 읽고 꼬리질문을 한 문장만 출력하세요.\n"
    "- 존댓말을 쓰고, 물음표나 \"~해 주세요\"로 끝냅니다.\n"
    "- 설명, 머리말, 번호 없이 질문 한 문장만 씁니다.\n"
    "- 답변과 질문에 없는 사실이나 수치를 지어내지 않습니다.\n"
    "- 감정, 외모, 성격, 자신감을 묻지 않습니다.\n"
    "- 초점: {focus}"
)

_ENDING = re.compile(r"(주세요|주시겠어요|나요|까요|습니까)[.?]?$")
_PREFIX = re.compile(r"^\s*(꼬리\s*질문|추가\s*질문|질문)\s*[:：]\s*")
_QUOTES = "\"'“”‘’`「」『』"


def build_messages(question: str, transcript: str, focus: str) -> list[dict]:
    system = _SYSTEM.format(focus=_FOCUS_LINES.get(focus, _DEFAULT_FOCUS))
    user = f"질문: {question}\n답변: {transcript[:MAX_TRANSCRIPT_CHARS]}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _clean(raw: str) -> str:
    lines = [ln.strip() for ln in (raw or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    text = lines[0]
    for _ in range(2):
        text = _PREFIX.sub("", text).strip().strip(_QUOTES).strip()
    return text


def validate_followup(raw: str, question: str, transcript: str) -> tuple[str | None, str | None]:
    text = _clean(raw)
    if not text:
        return None, "empty"
    letters = [c for c in text if c.isalpha()]
    hangul = [c for c in letters if "가" <= c <= "힣"]
    if not letters or len(hangul) / len(letters) < 0.5:
        return None, "not_korean"
    if not 10 <= len(text) <= 120:
        return None, "length"
    if not (text.endswith("?") or _ENDING.search(text)):
        return None, "not_question"
    if any(word in text for word in FORBIDDEN):
        return None, "forbidden"
    known = set(re.findall(r"\d+", f"{question} {transcript}"))
    if any(n not in known for n in re.findall(r"\d+", text)):
        return None, "invented_number"
    return text, None
