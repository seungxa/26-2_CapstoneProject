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
    {"key": "specificity", "label": "구체성",
     "checks": "막연한 다짐이나 일반론이 아니라 확인할 수 있는 상황·행동·결과로 답하는가",
     "anchors": {"충분": "주장마다 본인이 겪은 구체적인 상황·행동·결과가 붙어 있다. 과거 경험 질문이면 아래 세 가지가 모두 드러난다",
                 "보완": "'열심히 했다', '좋아졌다'처럼 막연하거나, 과거 경험 질문에서 아래 세 가지 중 하나라도 빠졌다"},
     # 과거 경험 질문의 행동 앵커(STAR)
     "star": {"when": "과거 경험을 묻는 질문",
              "anchors": ["상황·과제: 언제, 어떤 상황에서 무엇을 해내야 했는지 분명한가",
                          "본인 몫과 판단 근거: 팀 맥락 속에서 본인이 직접 맡은 몫과 그렇게 판단한 근거가 드러나는가",
                          "결과와 배운 점: 확인 가능한 결과·수치와 배운 점을 말하는가"]}},
    {"key": "relevance", "label": "질문 적합성",
     "checks": "질문이 묻는 것에 바로 답하고, 끝까지 질문 범위 안에서 말하는가",
     "anchors": {"충분": "첫머리에서 질문에 바로 답하고, 끝까지 질문이 묻는 범위 안에서 근거를 댄다",
                 "보완": "결론이 늦거나, 질문과 다른 이야기가 섞였거나, 무엇을 말하려는지 드러나지 않는다"}},
    {"key": "consistency", "label": "제출본 연결",
     "checks": "답변이 고정된 자소서에 쓴 경험·역할·수치와 이어지는가",
     "anchors": {"충분": "자소서에 쓴 경험·역할·수치와 같은 내용을 말하거나 더 자세히 설명한다(자소서 인용이 있어야 한다)",
                 "보완": "자소서와 역할·수치·시기를 다르게 말하거나 자소서의 핵심 근거를 빠뜨렸다. "
                         "다른 상황이거나 전사 오류일 수 있으니 확인할 사항으로 적는다"}},
]
STATUSES = {"충분": "기준의 '충분' 앵커를 만족하고, 이번 답변에서 그대로 인용할 근거가 있다",
            "보완": "기준의 '보완' 앵커에 해당하고, 이번 답변 인용으로 무엇이 부족한지 보여 줄 수 있다",
            "판단유보": "근거가 부족하거나 비교할 자료가 없어 판단하지 않는다"}
RUBRIC = {"version": RUBRIC_VERSION, "statuses": STATUSES, "criteria": CRITERIA,
          "note": "AI 코칭은 참고용이에요. 연구에서 LLM 채점과 전문가 채점의 일치도는 높지 않았어요(Kendall's τ=.19–.44). "
                  "말한 내용이 맞는지(정답 여부)는 채점하지 않아요."}
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


def _basic(transcript: str, context: dict) -> dict:
    quote = transcript.strip()[:180]
    source = next((e for e in context.get("essays", []) if e["content"].strip()), None)
    source_quote = source["content"][:180] if source else ""
    numeric = bool(re.search(r"\d", transcript))
    needs_measurement = bool(not numeric and source and re.search(r"\d", source_quote))
    if needs_measurement:
        detail = "개선 전후의 측정 지표와 비교 조건을 설명해 주세요."
        reason = "기준 자료에는 수치가 있지만 이번 답변에는 수치가 없어 측정 과정을 더 묻습니다."
    else:
        detail = "그때 선택한 방법의 이유와 결과를 확인한 과정을 설명해 주세요."
        reason = "답변에 나온 경험의 선택 근거와 결과를 더 자세히 확인합니다."
    return {"method": "basic", "rubric_version": RUBRIC_VERSION,
            "summary": "답변에서 확인되는 표현을 바탕으로 다음 연습을 준비했어요. 의미의 정확성은 직접 확인해 주세요.",
            "next_action": detail,
            "criteria": [
                {"key": "specificity", "label": LABELS["specificity"], "status": "보완" if needs_measurement else "판단유보",
                 "reason": "수치가 포함되어 있어요. 측정 조건까지 설명했는지 확인해 보세요." if numeric else
                           ("기준 자료에는 수치가 있어요. 그 결과를 확인한 조건을 설명하는 연습을 해 보세요." if needs_measurement else
                            "수치 표현만으로 구체성을 판단할 수 없어요. 본인의 역할과 상황을 충분히 설명했는지 확인해 보세요."),
                 "answer_quote": quote},
                {"key": "relevance", "label": LABELS["relevance"], "status": "판단유보",
                 "reason": "기본 점검은 질문에 맞는 답변인지 의미를 판정하지 않아요.", "answer_quote": quote},
                {"key": "consistency", "label": LABELS["consistency"], "status": "판단유보",
                 "reason": "아래 기준 자료와 답변을 직접 대조해 보세요. 표현이 달라도 다른 상황을 설명한 것일 수 있어요." if source else
                           "연결된 자소서가 없어 제출본과 비교할 수 없어요.",
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
