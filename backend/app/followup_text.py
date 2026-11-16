"""Prompt messages and output validation for the local follow-up question model."""
import re

MAX_TRANSCRIPT_CHARS = 1200
# A custom question can be long; with the 1,200-character answer it must still fit the model's n_ctx
MAX_QUESTION_CHARS = 300
FORBIDDEN = ("감정", "기분", "외모", "성격", "자신감", "표정", "느낌", "심정")

# The template follow-up's request (coaching.followup_ask) tells the model what to ask. Older reports have none
_DEFAULT_ASK = "답변에서 빠진 상황이나 본인 행동, 결과를 구체적으로 설명해 주세요."

_SYSTEM = (
    "당신은 한국어로 면접을 진행하는 면접관입니다.\n"
    "지원자의 답변을 읽고, 면접관이 지원자에게 던질 꼬리질문을 한 문장만 출력하세요.\n"
    "- 답변을 요약하거나 이어 쓰지 않습니다. 원래 면접 질문을 되풀이하지 않습니다.\n"
    "- 답변에 나온 구체적인 행동이나 결과 하나를 짚어서 묻습니다.\n"
    "- 존댓말을 쓰고, 물음표나 \"~해 주세요\"로 끝냅니다.\n"
    "- 설명, 머리말, 번호 없이 질문 한 문장만 씁니다.\n"
    "- 답변과 질문에 없는 사실이나 수치를 지어내지 않습니다.\n"
    "- 감정, 외모, 성격, 자신감을 묻지 않습니다."
)
# What a second try is told about the first one, by validate_followup reason code
_RETRY_HINT = {
    "empty": "비어 있습니다",
    "not_korean": "한국어가 아닙니다",
    "length": "꼬리질문으로 쓰기에 너무 짧거나 깁니다",
    "not_question": "질문이 아니라 답변을 요약하거나 이어 쓴 문장입니다",
    "not_one_sentence": "한 문장이 아닙니다",
    "repeats_question": "원래 면접 질문을 되풀이했습니다",
    "repeats_ask": "물어볼 것을 그대로 옮겨 적었습니다",
    "forbidden": "감정이나 성격처럼 묻지 않기로 한 내용을 물었습니다",
    "invented_number": "답변에 없는 숫자를 넣었습니다",
}
# The failed reply shown back to the model is cut to this length, so a retry still fits the model's n_ctx
MAX_RETRY_ECHO_CHARS = 160

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


def _turn(question: str, transcript: str, ask: str) -> str:
    # "꼬리질문:" at the end asks for the question itself; _PREFIX removes it when the model writes it again
    return (f"면접 질문: {question[:MAX_QUESTION_CHARS]}\n지원자 답변: {transcript[:MAX_TRANSCRIPT_CHARS]}\n"
            f"물어볼 것: {ask or _DEFAULT_ASK}\n꼬리질문:")


def build_messages(question: str, transcript: str, ask: str) -> list[dict]:
    """The model's messages: the rules, then this answer. `ask` is what to ask about (the template follow-up's
    request); empty uses a general request. There is no worked example on purpose: with one, the 1.2B model copied
    its details into unrelated answers (docs/practice-track/followup-model-check.md)."""
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": _turn(question, transcript, ask)}]


def retry_messages(messages: list[dict], raw: str, reason: str) -> list[dict]:
    """The messages for a second try: the failed reply and what was wrong with it."""
    hint = _RETRY_HINT.get(reason, "꼬리질문으로 쓸 수 없습니다")
    return [*messages,
            {"role": "assistant", "content": (raw or "").strip()[:MAX_RETRY_ECHO_CHARS]},
            {"role": "user", "content": f"방금 쓴 문장은 {hint}. 위 답변의 내용을 짚어, 면접관이 지원자에게 묻는 "
                                        "꼬리질문 한 문장만 다시 쓰세요."}]


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


def validate_followup(raw: str, question: str, transcript: str, ask: str = "") -> tuple[str | None, str | None]:
    """The cleaned question, or None and a reason code. `ask` is the request the model was given (build_messages)."""
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
    if bare == _bare(ask or _DEFAULT_ASK):
        return None, "repeats_ask"  # the request alone: the template question (with the answer quoted) says more
    if any(word in text for word in FORBIDDEN):
        return None, "forbidden"
    known = set(re.findall(r"\d+", f"{question} {transcript}"))
    if any(n not in known for n in re.findall(r"\d+", text)):
        return None, "invented_number"
    return text, None
