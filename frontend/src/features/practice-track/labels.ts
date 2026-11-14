// Stored values stay Korean (DB/API); the UI shows these English names.
export type LabelKind =
  | "category"
  | "stage"
  | "status"
  | "result"
  | "verdict"
  | "criterion"
  | "job"
  | "questionType"
  | "competency";

const LABELS: Record<LabelKind, Record<string, string>> = {
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

export function label(kind: LabelKind, stored: string | null | undefined): string {
  if (stored == null) return "";
  const table = LABELS[kind];
  return Object.prototype.hasOwnProperty.call(table, stored) ? table[stored] : stored;
}
