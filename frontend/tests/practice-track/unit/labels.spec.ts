import { expect, test } from "@playwright/test";
import { label, type LabelKind } from "../../../src/features/practice-track/labels";

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
