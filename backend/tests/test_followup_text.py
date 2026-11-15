import pytest

from app.followup_text import MAX_QUESTION_CHARS, MAX_TRANSCRIPT_CHARS, build_messages, validate_followup


def test_valid_korean_question_is_cleaned():
    text, reason = validate_followup('꼬리질문: "그 일정 조정에서 본인이 맡은 역할은 무엇이었나요?"\n다음 줄', "갈등 경험", "일정을 다시 나눴습니다")
    assert reason is None and text == "그 일정 조정에서 본인이 맡은 역할은 무엇이었나요?"


@pytest.mark.parametrize("raw,code", [
    ("", "empty"),
    ("What was your role in that project?", "not_korean"),
    ("왜요?", "length"),
    ("그 프로젝트에서 본인이 맡은 역할을 설명했습니다.", "not_question"),
    ("그때 기분은 어떠셨나요?", "forbidden"),
    ("매출을 37% 올렸다고 하셨는데 어떻게 측정했나요?", "invented_number"),
])
def test_bad_outputs_are_rejected(raw, code):
    assert validate_followup(raw, "성과를 말해 주세요", "매출을 올렸습니다") == (None, code)


def test_numbers_from_the_answer_are_allowed():
    text, reason = validate_followup("마감 2일 전에 끝낸 방법을 구체적으로 설명해 주세요.", "q", "마감 2일 전에 완성했습니다")
    assert reason is None and text.endswith("주세요.")


def test_long_transcript_is_truncated():
    msgs = build_messages("질문", "가" * 20000, "specificity")
    assert len(msgs) == 2 and msgs[0]["role"] == "system"
    assert msgs[1]["content"].count("가") <= MAX_TRANSCRIPT_CHARS


def test_prompt_states_the_rules():
    system = build_messages("q", "a", "specificity")[0]["content"]
    for rule in ("한 문장", "지어내지", "감정"):
        assert rule in system


GOOD_Q = "그때 본인이 맡은 역할은 무엇이었나요?"


@pytest.mark.parametrize("marker", ["- ", "* ", "• ", "1. ", "2) ", "(1) ", "  -  "])
def test_leading_bullet_or_number_is_removed(marker):
    assert validate_followup(f"{marker}{GOOD_Q}", "q", "a") == (GOOD_Q, None)


def test_short_leading_label_is_removed():
    raw = "답습: 당신의 끈기가 어떻게 프로젝트 진행에 도움이 되었는지 구체적으로 설명해 주세요."
    assert validate_followup(raw, "q", "a") == (raw.removeprefix("답습: "), None)


def test_bullet_label_and_quotes_together_are_removed():
    assert validate_followup(f'- 꼬리질문: "{GOOD_Q}"', "q", "a") == (GOOD_Q, None)
    assert validate_followup(f"1. 예시: {GOOD_Q}", "q", "a") == (GOOD_Q, None)


def test_only_one_short_label_is_removed():
    assert validate_followup(f"답습: 참고: {GOOD_Q}", "q", "a") == (f"참고: {GOOD_Q}", None)


@pytest.mark.parametrize("raw", [
    "발표 자료의 '결론: 일정 조정' 부분을 더 설명해 주세요.",  # ":" later in the sentence
    "일정조정과정에서는: 어떤 역할을 맡으셨나요?",  # label longer than 6 characters
    "10:30 회의에서 정한 내용을 더 설명해 주세요.",  # no space after ":"
    "3.5초에서 0.8초로 줄인 방법을 설명해 주세요.",  # a number, not a list marker
    "-5도에서 시험한 이유는 무엇인가요?",  # no space after "-"
])
def test_normal_questions_are_unchanged(raw):
    assert validate_followup(raw, "q", "3.5초에서 0.8초로, 10:30 회의, -5도") == (raw, None)


# ───────── final review fixes ─────────

PARENT = "팀원과 의견이 충돌했던 경험이 있나요?"


@pytest.mark.parametrize("raw", [
    PARENT,  # the parent question itself
    "팀원과 의견이 충돌했던 경험이 있나요",  # only the punctuation differs
    "팀원과 의견이  충돌했던 경험이 있나요 ?",  # only the spacing differs
    "인턴 때 팀원과 의견이 충돌했던 경험이 있나요?",  # a near copy with a few words in front
])
def test_repeating_the_question_is_rejected(raw):
    assert validate_followup(raw, PARENT, "인턴 때 디자이너분과 의견이 달랐습니다") == (None, "repeats_question")


def test_a_question_that_only_shares_words_with_the_parent_passes():
    raw = "팀원과 의견이 충돌했을 때 어떻게 해결했는지 구체적으로 설명해 주세요."
    assert validate_followup(raw, PARENT, "의견이 달랐습니다") == (raw, None)


def test_quotes_inside_the_question_are_kept():
    raw = "“응답 시간을 40% 줄였습니다”라고 하셨는데, 어떻게 측정하셨나요?"
    assert validate_followup(raw, "q", "응답 시간을 40% 줄였습니다") == (raw, None)
    raw = "'캐시'를 넣기로 한 이유는 무엇이었나요?"
    assert validate_followup(raw, "q", "a") == (raw, None)


@pytest.mark.parametrize("raw", [f'"{GOOD_Q}"', f"“{GOOD_Q}”", f"‘{GOOD_Q}’", f"「{GOOD_Q}」", f"'{GOOD_Q}'"])
def test_quotes_wrapping_the_whole_question_are_removed(raw):
    assert validate_followup(raw, "q", "a") == (GOOD_Q, None)


@pytest.mark.parametrize("raw", [
    f"**{GOOD_Q}**",
    f"__{GOOD_Q}__",
    f"*{GOOD_Q}*",
    f"_{GOOD_Q}_",
    f"**꼬리질문:** {GOOD_Q}",
    f"**꼬리질문**: {GOOD_Q}",
    f"*꼬리질문:* {GOOD_Q}",
    f"_꼬리질문_: {GOOD_Q}",
    f"__답습:__ {GOOD_Q}",
    f'- **꼬리질문:** "{GOOD_Q}"',
    f'"**{GOOD_Q}**"',
])
def test_markdown_emphasis_is_removed(raw):
    assert validate_followup(raw, "q", "a") == (GOOD_Q, None)


def test_underscores_in_a_name_are_kept():
    raw = "user_id 필드를 따로 둔 이유는 무엇인가요?"
    assert validate_followup(raw, "q", "a") == (raw, None)


@pytest.mark.parametrize("raw", [
    f"<think>\n답변에서 역할이 빠져 있다.\n</think>\n\n{GOOD_Q}",
    f"<think></think>{GOOD_Q}",
    f"  <think>짧게 생각</think> {GOOD_Q}",
])
def test_a_leading_think_block_is_removed(raw):
    assert validate_followup(raw, "q", "a") == (GOOD_Q, None)


def test_an_unfinished_think_block_is_empty():
    assert validate_followup("<think>\n답변에서 역할이 빠져 있다. 무엇을 물을까", "q", "a") == (None, "empty")


@pytest.mark.parametrize("raw", [
    "그때 맡은 역할은 무엇이었나요? 결과는 어땠나요?",
    "좋은 답변입니다. 그때 맡은 역할은 무엇이었나요?",
    "정말요! 그때 맡은 역할은 무엇이었나요?",
])
def test_two_sentences_on_one_line_are_rejected(raw):
    assert validate_followup(raw, "q", "a") == (None, "not_one_sentence")


@pytest.mark.parametrize("raw", ["그때 어떤 느낌이 드셨나요?", "그 순간의 심정은 어떠셨나요?"])
def test_feeling_questions_are_forbidden(raw):
    assert validate_followup(raw, "q", "a") == (None, "forbidden")


def test_long_question_is_truncated():
    msgs = build_messages("나" * 5000, "답변", "specificity")
    assert msgs[1]["content"].count("나") == MAX_QUESTION_CHARS == 300


def test_a_very_short_question_is_rejected_only_when_repeated_exactly():
    # Custom questions can be two characters long: containing "자기소개" alone does not make a repeat
    raw = "자기소개에서 말씀하신 웹사이트 관리 경험을 더 설명해 주세요."
    assert validate_followup(raw, "자기소개", "웹사이트를 관리했습니다") == (raw, None)
    assert validate_followup("자기소개를 해 주시겠어요?", "자기소개를 해 주시겠어요", "a") == (None, "repeats_question")


@pytest.mark.parametrize("raw", [
    "React vs. Vue 중에서 Vue를 고른 이유는 무엇인가요?",  # a Latin abbreviation, not a sentence end
    "Python의 __init__ 메서드에서 처리한 일을 설명해 주세요.",  # dunder names keep their underscores
])
def test_code_like_words_are_unchanged(raw):
    assert validate_followup(raw, "q", "a") == (raw, None)


@pytest.mark.parametrize("raw", [f"**꼬리질문:**\n{GOOD_Q}", f"꼬리질문:\n\n{GOOD_Q}", f"- 질문:\n{GOOD_Q}"])
def test_a_label_alone_on_the_first_line_is_skipped(raw):
    assert validate_followup(raw, "q", "a") == (GOOD_Q, None)


def test_a_statement_on_the_first_line_is_not_skipped():
    assert validate_followup(f"구체적인 과정이 들어 있어 좋은 답변입니다.\n{GOOD_Q}", "q", "a") == (None, "not_question")
