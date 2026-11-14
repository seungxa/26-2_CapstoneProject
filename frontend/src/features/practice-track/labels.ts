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

/** Criterion names as they appear inside stored text: old Korean labels and the backend's English labels. */
const CRITERION_BY_NAME: Record<string, string> = {
  구체성: "specificity", Specificity: "specificity",
  "질문 적합성": "relevance", Relevance: "relevance",
  "제출본 연결": "consistency", "Match With Submitted Essay": "consistency",
};

/** A criterion name from stored text → English name. Unknown names stay as stored. */
export function criterionName(stored: string): string {
  return Object.prototype.hasOwnProperty.call(CRITERION_BY_NAME, stored) ? label("criterion", CRITERION_BY_NAME[stored]) : stored;
}

/** Re-drill reasons are stored as "{criterion} 보완" (old AI reports add "AI · " first) or "자기평가 N점". */
export const needsWorkReason = (reason: string) => reason.endsWith("보완");

/** Re-drill focus names (drill_targets): a criterion name or "자기평가 N점". */
export function focusLabel(focus: string): string {
  const rated = /^자기평가 (\d+)점$/.exec(focus);
  return rated ? `Self-rating ${rated[1]}` : criterionName(focus);
}

/** A re-drill reason → English, e.g. "Specificity 보완" → "Specificity: Needs Work". */
export function reasonLabel(reason: string): string {
  const weak = /^(AI · )?(.+) 보완$/.exec(reason);
  return weak ? `${weak[1] ?? ""}${criterionName(weak[2])}: ${label("verdict", "보완")}` : focusLabel(reason);
}

/** lang for stored text that may be Korean (old records) or English (new app sentences). */
export const langOf = (text: string | null | undefined): "ko" | undefined => (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text ?? "") ? "ko" : undefined);
