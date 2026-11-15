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
