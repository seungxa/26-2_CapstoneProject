import { expect, test } from "@playwright/test";
import { focusLabel, label, langOf, needsWorkReason, reasonLabel, sessionKind, type LabelKind } from "../../../src/features/practice-track/labels";

const TABLE: Record<LabelKind, Record<string, string>> = {
  category: { 인성: "Personality", 직무: "Job Fit", 기업: "Company", 상황: "Situational", 인적성: "Aptitude" },
  stage: { 서류: "Application", 인적성: "Aptitude Test", "1차면접": "1st Interview", "2차면접": "2nd Interview", 최종: "Final" },
  status: { 진행중: "In Progress", 합격: "Passed", 불합격: "Rejected", 보류: "On Hold" },
  result: { 대기: "Pending", 합격: "Passed", 불합격: "Rejected" },
  verdict: { 충분: "Meets", 보완: "Needs Work", 판단유보: "Not Judged" },
  criterion: { specificity: "Specificity", relevance: "Relevance", consistency: "Matches Your Essay" },
  job: { 개발: "Engineering", 기획: "Product", 마케팅: "Marketing", 데이터: "Data", 디자인: "Design", 기타: "Other", 공통: "General" },
  questionType: {
    self_description: "Self-Introduction",
    motivation: "Motivation & Goals",
    behavioral: "Behavioral",
    situational: "Situational Judgment",
    project_deep_dive: "Project Deep Dive",
    knowledge: "Knowledge & Reasoning",
  },
  competency: {
    problem_solving: "Problem Solving",
    communication: "Communication",
    collaboration: "Collaboration",
    leadership: "Leadership",
    technical_expertise: "Job Expertise",
    adaptability: "Adaptability & Learning",
    analytical_thinking: "Analytical Thinking",
  },
};

test("maps every stored value in the design table", () => {
  for (const [kind, pairs] of Object.entries(TABLE)) {
    for (const [stored, english] of Object.entries(pairs)) {
      expect(label(kind as LabelKind, stored), `${kind}:${stored}`).toBe(english);
    }
  }
});

test("unknown values fall back to the stored value", () => {
  expect(label("job", "보안")).toBe("보안");
  expect(label("stage", null)).toBe("");
  expect(label("stage", undefined)).toBe("");
  expect(label("verdict", "toString")).toBe("toString");
});

test("re-drill reasons and focus names show in English for new and old records", () => {
  // Stored reasons stay "{label} 보완" / "자기평가 N점" (backend debrief.py); only the screen name changes
  expect(reasonLabel("Specificity 보완")).toBe("Specificity: Needs Work");
  expect(reasonLabel("구체성 보완")).toBe("Specificity: Needs Work");
  expect(reasonLabel("AI · 질문 적합성 보완")).toBe("AI · Relevance: Needs Work");
  expect(reasonLabel("Match With Submitted Essay 보완")).toBe("Matches Your Essay: Needs Work");
  expect(reasonLabel("제출본 연결 보완")).toBe("Matches Your Essay: Needs Work");
  expect(reasonLabel("자기평가 2점")).toBe("Self-rating 2");
  expect(reasonLabel("새 기준 보완")).toBe("새 기준: Needs Work");
  expect(reasonLabel("알 수 없는 이유")).toBe("알 수 없는 이유");
  expect(needsWorkReason("구체성 보완")).toBe(true);
  expect(needsWorkReason("Specificity 보완")).toBe(true);
  expect(needsWorkReason("자기평가 1점")).toBe(false);
  expect(focusLabel("구체성")).toBe("Specificity");
  expect(focusLabel("Relevance")).toBe("Relevance");
  expect(focusLabel("자기평가 1점")).toBe("Self-rating 1");
  expect(focusLabel("기타 초점")).toBe("기타 초점");
});

test("langOf marks only text with Hangul as Korean", () => {
  expect(langOf("결과를 확인한 방법")).toBe("ko");
  expect(langOf("Explain how you measured it.")).toBeUndefined();
  expect(langOf(null)).toBeUndefined();
});

test("session kinds come from the mode and the stored title prefix", () => {
  // Stored titles stay Korean (backend practice.py); History shows the kind in English
  expect(sessionKind({ mode: "free", title: "자유 연습 11/14 18:04" })).toBe("Practice");
  expect(sessionKind({ mode: "mock", title: "모의 면접 11/14 18:04" })).toBe("Mock Interview");
  expect(sessionKind({ mode: "free", title: "보완 연습 · 자유 연습 11/14 18:04" })).toBe("Practice Again");
  expect(sessionKind({ mode: "free", title: "Custom title" })).toBe("Practice");
});
