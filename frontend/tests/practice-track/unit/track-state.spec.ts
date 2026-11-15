import { expect, test } from "@playwright/test";
import type { ApplicationDetail, EssayItem } from "../../../src/features/practice-track/types";
import { mergeApplicationDetail, mergeEssayItem } from "../../../src/features/practice-track/components/track/state";
import { dayLabel, updatedLabel } from "../../../src/features/practice-track/components/track/format";

const version = (number: number, submitted = false) => ({ id: `v${number}`, version_no: number, content: "같은 답변", char_count: 5, source: "web" as const, is_submitted: submitted, created_at: "2026-11-01" });
const essay = (versions: number, revision: number, submitted: number | null): EssayItem => ({
  id: "essay", question_text: "지원 동기", char_limit: null,
  versions: Array.from({ length: versions }, (_, index) => version(index + 1, index + 1 === submitted)),
  submission_revision: revision, submitted_version_id: submitted ? `v${submitted}` : null, submission_confirmation: submitted ? "confirmed" : "none",
});

for (const reversed of [false, true]) {
  test(`version and submission revisions merge independently in ${reversed ? 'reverse' : 'forward'} arrival order`, () => {
    const moreVersions = essay(3, 1, 2);
    const newerSubmission = essay(2, 2, 1);
    const merged = mergeEssayItem(reversed ? newerSubmission : moreVersions, reversed ? moreVersions : newerSubmission);
    expect(merged.versions.map((v) => v.version_no)).toEqual([1, 2, 3]);
    expect(merged.submitted_version_id).toBe('v1');
    expect(merged.submission_revision).toBe(2);
    expect(merged.versions.filter((v) => v.is_submitted).map((v) => v.id)).toEqual(['v1', 'v2']);
  });
}

test('full snapshots preserve new local items but explicit deletion removes them', () => {
  const old = { id: "app", essay_items: [essay(1, 0, null)] } as ApplicationDetail;
  const added = { ...essay(1, 0, null), id: "new-essay" };
  const current = { ...old, essay_items: [...old.essay_items, added] };
  expect(mergeApplicationDetail(current, old, new Set()).essay_items.map((item) => item.id)).toEqual(['essay', 'new-essay']);
  expect(mergeApplicationDetail(current, old, new Set(['new-essay'])).essay_items.map((item) => item.id)).toEqual(['essay']);
});

test('stored dates show in English without shifting the calendar day', () => {
  // "YYYY-MM-DD" is a calendar day: parsing it as UTC would show the day before west of UTC
  expect(dayLabel('2026-11-04')).toBe('Nov 4, 2026');
  expect(dayLabel('2026-01-31')).toBe('Jan 31, 2026');
  expect(dayLabel(null)).toBe('');
  expect(dayLabel('not a date')).toBe('not a date');
});

test('the list shows the update day, with the year only when it is not this year', () => {
  const now = new Date(2026, 10, 15, 12);
  expect(updatedLabel(new Date(2026, 10, 12, 9).toISOString(), now)).toBe('Nov 12');
  expect(updatedLabel(new Date(2025, 11, 30, 9).toISOString(), now)).toBe('Dec 30, 2025');
});
