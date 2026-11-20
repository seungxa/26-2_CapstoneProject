/** A stored calendar day ("YYYY-MM-DD") in English, e.g. "Nov 4, 2026". Built from its parts so no time zone shifts the day. */
export function dayLabel(day: string | null | undefined): string {
  if (!day) return "";
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return day;
  return new Date(+parts[1], +parts[2] - 1, +parts[3]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** When a row last changed, e.g. "Nov 12"; the year shows only when it is not this year. */
export function updatedLabel(timestamp: string, now = new Date()): string {
  const at = new Date(timestamp);
  return at.toLocaleDateString("en-US", at.getFullYear() === now.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}
