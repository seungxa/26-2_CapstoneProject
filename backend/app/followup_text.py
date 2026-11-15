"""Prompt messages and output validation for the local follow-up question model."""
import re

MAX_TRANSCRIPT_CHARS = 1200
# A custom question can be long; with the 1,200-character answer it must still fit the model's n_ctx
MAX_QUESTION_CHARS = 300
FORBIDDEN = ("감정", "기분", "외모", "성격", "자신감", "표정", "느낌", "심정")

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
# A list marker ("- ", "* ", "• ", "1. ", "2) ", "(1) "); the space after it keeps "-5도" and "3.5초" intact
_MARKER = re.compile(r"^\s*(?:[-*•·–]|\d{1,2}[.)]|\(\d{1,2}\))\s+")
# One short label such as "답습: " (up to 6 characters, a space or the line end after the colon keeps "10:30" intact)
_LABEL = re.compile(r"^[^\s:：]{1,6}[:：](?:\s+|$)")
# A reasoning block some models write before the answer ("<think>…</think>"), and one cut off by max_tokens
_THINK = re.compile(r"^\s*<think>.*?</think>", re.S)
_OPEN_THINK = re.compile(r"^\s*<think>")
# Markdown emphasis: "**…**" anywhere; "__…__", "*…*", "_…_" only around the whole text or a short leading label
# ("**꼬리질문:**", "_답습_:"), so "__init__" and "user_id" keep their underscores
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_EM_WHOLE = re.compile(r"^(__|[*_])(.+)\1$")
_EM_LABEL = re.compile(r"^(__|[*_])([^*_:：]{1,8}[:：])\1|^(__|[*_])([^*_:：]{1,8})\3(?=\s*[:：])")
# Quotes are removed only as a pair around the whole text: “40%”라고 하셨는데 … keeps its quotes
_QUOTE_PAIRS = {'"': '"', "'": "'", "“": "”", "‘": "’", "`": "`", "「": "」", "『": "』"}
# A sentence end: ? ! (also full width), or a period after Hangul before a space ("입니다. 그때").
# "3.5초", "Node.js" and "vs. " are not sentence ends
_SENTENCE_END = re.compile(r"[?？!！]|(?<=[가-힣])\.(?=\s)")
# A question shorter than this (letters and digits) is a repeat only when the output is the same text:
# a custom question can be "자기소개", and a good follow-up may name it
MIN_CONTAINED_QUESTION = 8


def build_messages(question: str, transcript: str, focus: str) -> list[dict]:
    system = _SYSTEM.format(focus=_FOCUS_LINES.get(focus, _DEFAULT_FOCUS))
    user = f"질문: {question[:MAX_QUESTION_CHARS]}\n답변: {transcript[:MAX_TRANSCRIPT_CHARS]}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _unquote(text: str) -> str:
    while len(text) >= 2 and _QUOTE_PAIRS.get(text[0]) == text[-1] and text[-1] not in text[1:-1]:
        text = text[1:-1].strip()
    return text


def _unemphasize(text: str) -> str:
    text = _BOLD.sub(r"\1", text)
    text = _EM_WHOLE.sub(r"\2", text)
    return _EM_LABEL.sub(lambda m: m.group(2) or m.group(4), text, count=1).strip()


def _clean_line(line: str) -> str:
    text = _unemphasize(_MARKER.sub("", line.strip(), count=1))
    for _ in range(2):
        text = _unquote(_PREFIX.sub("", text).strip())
    return _unquote(_LABEL.sub("", text, count=1).strip())


def _clean(raw: str) -> str:
    """The first line with content, without a leading reasoning block, list marker, emphasis, label or quotes."""
    raw = _THINK.sub("", raw or "", count=1)
    if _OPEN_THINK.match(raw):  # the reasoning never ended: there is no answer
        return ""
    for line in raw.splitlines():
        text = _clean_line(line)
        if text:  # a line that held only a label ("**꼬리질문:**") is skipped; any other first line is used
            return text
    return ""


def _bare(text: str) -> str:
    """Letters and digits only: spaces and punctuation do not make a different question."""
    return re.sub(r"[\W_]+", "", text).casefold()


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
    if _SENTENCE_END.search(text.rstrip("?？!！.")):  # two questions or sentences on one line
        return None, "not_one_sentence"
    parent, bare = _bare(question), _bare(text)
    if parent and (bare == parent or (len(parent) >= MIN_CONTAINED_QUESTION and parent in bare)):
        return None, "repeats_question"  # the question again, maybe with a few words around it
    if any(word in text for word in FORBIDDEN):
        return None, "forbidden"
    known = set(re.findall(r"\d+", f"{question} {transcript}"))
    if any(n not in known for n in re.findall(r"\d+", text)):
        return None, "invented_number"
    return text, None
