import { expect, test } from '@playwright/test';
import { questionsForApplication } from '../../../src/features/practice-track/practice/questions';
import { essayPreview, essaySourceLabel } from '../../../src/features/practice-track/practice/essays';

const questions = [
  { id: 'own', application_id: 'application-a', source: 'generated' },
  { id: 'public', application_id: null, source: 'bank' },
  { id: 'other', application_id: 'application-b', source: 'generated' },
  { id: 'unlinked', application_id: null, source: 'custom' },
];

test('linked practice includes its own and unlinked questions in the original order', () => {
  expect(questionsForApplication(questions, 'application-a').map(q => q.id)).toEqual(['own', 'public', 'unlinked']);
  expect(questionsForApplication(questions, 'application-b').map(q => q.id)).toEqual(['public', 'other', 'unlinked']);
});

test('unlinked practice preserves all questions without changing the source list', () => {
  const before = structuredClone(questions);
  for (const application of [null, undefined, '']) {
    expect(questionsForApplication(questions, application)).toEqual(questions);
  }
  expect(questions).toEqual(before);
});

test('an empty question list remains empty for every application', () => {
  expect(questionsForApplication([], 'application-a')).toEqual([]);
});

const version = (id: string, version_no: number) => ({ id, version_no, content: '합성', char_count: 2, source: 'web' as const, is_submitted: false, created_at: '' });
const essay = (id: string, versions: ReturnType<typeof version>[], submitted?: string, confirmation?: 'confirmed' | 'legacy_unverified' | 'none') =>
  ({ id, question_text: `문항 ${id}`, char_limit: null, versions, submitted_version_id: submitted ?? null, submission_confirmation: confirmation });

test('essay sources get distinct English names for each confirmation state', () => {
  expect(essaySourceLabel('latest')).toBe('Latest');
  expect(essaySourceLabel('latest', 'confirmed')).toBe('Latest');
  expect(essaySourceLabel('submitted', 'confirmed')).toBe('Submitted');
  expect(essaySourceLabel('submitted', 'legacy_unverified')).toBe('Marked Submitted, Unconfirmed');
  expect(essaySourceLabel('submitted', 'none')).toBe('Submitted, No Confirmation');
  expect(essaySourceLabel('submitted')).toBe('Submitted, No Confirmation');
});

test('the essay preview picks the submitted version first and falls back to the latest', () => {
  const items = [
    essay('a', [version('a1', 1), version('a2', 2)], 'a1', 'confirmed'),
    essay('b', [version('b1', 1), version('b2', 2)], 'b2', 'legacy_unverified'),
    essay('c', [version('c1', 1), version('c2', 2), version('c3', 3)], undefined, 'none'),
    essay('empty', []),
  ];
  expect(essayPreview(items, 'submitted')).toEqual([
    { id: 'a', question_text: '문항 a', version_no: 1, label: 'Submitted' },
    { id: 'b', question_text: '문항 b', version_no: 2, label: 'Marked Submitted, Unconfirmed' },
    { id: 'c', question_text: '문항 c', version_no: 3, label: 'Latest' },
  ]);
  expect(essayPreview(items, 'latest').map(item => [item.id, item.version_no, item.label])).toEqual([['a', 2, 'Latest'], ['b', 2, 'Latest'], ['c', 3, 'Latest']]);
  expect(essayPreview([], 'submitted')).toEqual([]);
});

test('essay source names contain no Korean', () => {
  for (const selection of ['submitted', 'latest'] as const)
    for (const confirmation of ['confirmed', 'legacy_unverified', 'none', undefined] as const)
      expect(essaySourceLabel(selection, confirmation)).not.toMatch(/[가-힣]/);
});
