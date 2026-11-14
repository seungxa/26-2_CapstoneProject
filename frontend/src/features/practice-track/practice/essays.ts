import type { EssayItem } from "../types";

export type EssayBasis = "submitted" | "latest";
type Confirmation = EssayItem["submission_confirmation"];

/** English name for the essay version a practice uses. Old snapshots may lack the confirmation field. */
export function essaySourceLabel(selection: EssayBasis, confirmation?: Confirmation): string {
  if (selection === "latest") return "Latest";
  if (confirmation === "confirmed") return "Submitted";
  if (confirmation === "legacy_unverified") return "Marked Submitted, Unconfirmed";
  return "Submitted, No Confirmation";
}

/** Which version of each essay a new practice would use: the submitted one first, else the latest (same rule as the server snapshot). */
export function essayPreview(items: readonly EssayItem[], basis: EssayBasis) {
  return items.flatMap(item => {
    const submitted = item.versions.find(v => v.id === item.submitted_version_id);
    const useSubmitted = basis === "submitted" && !!submitted;
    const version = useSubmitted ? submitted : item.versions[item.versions.length - 1];
    if (!version) return [];
    return [{ id: item.id, question_text: item.question_text, version_no: version.version_no,
      label: essaySourceLabel(useSubmitted ? "submitted" : "latest", item.submission_confirmation) }];
  });
}
