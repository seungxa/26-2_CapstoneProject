"""Frozen sources and evidence-grounded coaching. No truth or hiring scores."""
import hashlib
import json
import re

from .models import Application, transcript_hash
from .taxonomy import classification_hash
from .schemas import CoachingReport

# 채점 기준 버전. PR #2의 첫 기준(2026-10-15)에 구체성의 STAR 앵커와 판단 규칙(엄격하게, 지어내지 않기 등)을 더했다.
# 새 보고서와 GET /practice/rubric이 이 값을 쓴다. 예전 보고서는 찍힌 버전 그대로 두고 다시 채점하지 않는다
RUBRIC_VERSION = "2026-10-16-star"
# 세 기준의 정의(무엇을 보는지와 충분/보완 앵커). 기본 점검과 GET /practice/rubric이 함께 쓴다
CRITERIA = [
    {"key": "specificity", "label": "Specificity",
     "checks": "Does the answer give a checkable situation, action, and result instead of vague resolve or generalities?",
     "anchors": {"충분": "Every claim comes with a concrete situation, action, and result from the speaker's own experience. For past-experience questions, all three items below show up.",
                 "보완": "The answer is vague ('I worked hard', 'it got better'), or a past-experience answer misses at least one of the three items below."},
     # Behavioral anchors for past-experience questions (STAR)
     "star": {"when": "Questions about past experience",
              "anchors": ["Situation and task: is it clear when it happened and what had to be achieved?",
                          "Own role and reasoning: does it show what the speaker personally owned in the team and why they decided that way?",
                          "Result and lesson: does it state a checkable result or number and what was learned?"]}},
    {"key": "relevance", "label": "Relevance",
     "checks": "Does the answer respond to the question right away and stay within what was asked?",
     "anchors": {"충분": "It answers the question in the first sentence and supports it within the scope of the question to the end.",
                 "보완": "The conclusion comes late, the story drifts from the question, or the point is unclear."}},
    {"key": "consistency", "label": "Match With Submitted Essay",
     "checks": "Does the answer connect to the experience, role, and numbers in the pinned essay?",
     "anchors": {"충분": "It repeats or expands on the experience, role, and numbers in the essay (an essay quote is required).",
                 "보완": "It gives a different role, number, or time than the essay, or leaves out the essay's key evidence. "
                         "This may be a different situation or a transcription error, so it is listed as something to check."}},
]
STATUSES = {"충분": "Meets the criterion's Meets anchor, with evidence in this answer that can be quoted as is.",
            "보완": "Matches the criterion's Needs Work anchor, and a quote from this answer shows what is missing.",
            "판단유보": "Not judged: there is not enough evidence or nothing to compare against."}
RUBRIC = {"version": RUBRIC_VERSION, "statuses": STATUSES, "criteria": CRITERIA,
          "note": "Rule-based checks for practice. They do not judge whether what you said is correct."}
LABELS = {c["key"]: c["label"] for c in CRITERIA}


def snapshot(application: Application | None, basis: str = "submitted", job_description: str = "") -> dict:
    essays = []
    if application:
        for item in application.essay_items:
            if not item.versions:
                continue
            submitted_id = item.submitted_version_id
            selected = next((v for v in item.versions if v.id == submitted_id), None)
            version = selected if basis == "submitted" and selected else item.versions[-1]
            selection = "submitted" if basis == "submitted" and selected else "latest"
            essays.append({"item_id": item.id, "question_text": item.question_text,
                           "version_id": version.id, "version_no": version.version_no,
                           "content": version.content, "selection": selection,
                           "is_submitted": version.is_submitted,
                           "submission_confirmation": item.submission_confirmation if selection == "submitted" else "none"})
    return {"company": application.company if application else "", "position": application.position if application else "",
            "job_category": application.job_category if application else "", "essay_basis": basis,
            "job_description": job_description, "essays": essays}


def essay_text(context: dict) -> str:
    return "\n\n".join(f"Q. {e['question_text']}\nA. {e['content']}" for e in context.get("essays", []))


def input_fingerprint(question: str, transcript: str | None, context: dict, history: list[dict]) -> str:
    """Core identity excludes optional tags so feature rollback preserves coaching."""
    payload = {"question": question, "answer": transcript, "context": context,
               "history": history, "rubric_version": RUBRIC_VERSION}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


# The template follow-up quotes the answer, then asks one of these (Korean: interview follow-up content).
# The local follow-up model is given the same request as what to ask (followup_ask)
_ASK_MEASURE = "개선 전후의 측정 지표와 비교 조건을 설명해 주세요."
_ASK_REASON = "그때 선택한 방법의 이유와 결과를 확인한 과정을 설명해 주세요."


def followup_ask(followup: dict) -> str:
    """The request part of a report's template follow-up, or "" for a report written with other wording."""
    text = followup.get("text") or ""
    return next((ask for ask in (_ASK_MEASURE, _ASK_REASON) if text.endswith(ask)), "")


def _basic(transcript: str, context: dict) -> dict:
    quote = transcript.strip()[:180]
    source = next((e for e in context.get("essays", []) if e["content"].strip()), None)
    source_quote = source["content"][:180] if source else ""
    numeric = bool(re.search(r"\d", transcript))
    needs_measurement = bool(not numeric and source and re.search(r"\d", source_quote))
    if needs_measurement:
        detail = _ASK_MEASURE
        next_action = "Explain the measures and comparison conditions from before and after the improvement."
        reason = "The essay has numbers but this answer has none, so the follow-up asks how it was measured."
    else:
        detail = _ASK_REASON
        next_action = "Explain why you chose that approach and how you checked the result."
        reason = "The follow-up asks for the reasoning behind the choice and how the result was checked."
    return {"method": "basic", "rubric_version": RUBRIC_VERSION,
            "summary": "Next practice is based on the wording in your answer. Check the accuracy of what you said yourself.",
            "next_action": next_action,
            "criteria": [
                {"key": "specificity", "label": LABELS["specificity"], "status": "보완" if needs_measurement else "판단유보",
                 "reason": "The answer includes numbers. Check that you also explained how they were measured." if numeric else
                           ("The essay has numbers. Practice explaining the conditions under which you checked the result." if needs_measurement else
                            "Specificity cannot be judged from wording alone. Check that you explained your role and the situation."),
                 "answer_quote": quote},
                {"key": "relevance", "label": LABELS["relevance"], "status": "판단유보",
                 "reason": "The basic check does not judge whether the answer fits the question.", "answer_quote": quote},
                {"key": "consistency", "label": LABELS["consistency"], "status": "판단유보",
                 "reason": "Compare your answer with the essay below yourself. Different wording may still describe a different situation." if source else
                           "No essay is linked, so there is nothing to compare with.",
                 "answer_quote": quote, "source_quote": source_quote,
                 "source_version_id": source["version_id"] if source else None}],
            "followup": {"text": f'“{quote}”라고 말씀하셨는데, {detail}', "focus": "specificity", "reason": reason,
                         "answer_quote": quote, "source_quote": source_quote,
                         "source_version_id": source["version_id"] if source else None}}


def build_report(question: str, transcript: str, context: dict, history: list[dict], classification: dict | None = None) -> dict:
    """답변 코칭 보고서(규칙 기반 기본 점검). 입력 지문과 전사문 지문을 함께 남긴다. 저장 서비스는 미답변 이전 질문까지
    포함한 보수적인 대화 지문을 저장하고, 읽기·저장 시 일치 여부를 확인한다. 외부 서비스를 부르지 않는다."""
    stamp = {"input_status": "current", "input_sha256": input_fingerprint(question, transcript, context, history),
             "transcript_sha256": transcript_hash(transcript), "question_classification_sha256": classification_hash(classification)}
    basic = CoachingReport.model_validate(_basic(transcript, context)).model_dump()
    return {**basic, **stamp}
