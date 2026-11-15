import pytest

from app.followup_text import MAX_TRANSCRIPT_CHARS, build_messages, validate_followup


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
