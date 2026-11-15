import { label } from "../../labels";

/** Status or result chip. `status` is the stored value (합격·불합격·진행중·보류·대기); the chip shows its English name */
export function StatusChip({ status, kind = "status", testId }: { status: string; kind?: "status" | "result"; testId?: string }) {
  const cls = status === "합격" ? "good" : status === "불합격" ? "bad" : status === "진행중" ? "accent" : "";
  return <span className={`chip ${cls}`} data-testid={testId}>{label(kind, status)}</span>;
}
