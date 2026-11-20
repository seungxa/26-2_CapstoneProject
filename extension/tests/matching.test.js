import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten, suggest } from '../matching.js';
test('maps education status using section instead of employment status', () => {
  const sources = flatten({ education: [{ status: '졸업예정' }], experience: [{ status: '재직' }] });
  assert.equal(suggest({ label: '졸업구분', section: '학력' }, sources)?.value, '졸업예정');
});
test('does not silently choose one of multiple education records', () => {
  const sources = flatten({ education: [{ school: 'A' }, { school: 'B' }] });
  assert.equal(suggest({ label: '학교명', section: '학력' }, sources), null);
});
test('does not invent missing information or map unknown fields', () => {
  const sources = flatten({ profile: { name: '지원자', email: '' } });
  assert.equal(sources.length, 1);
  assert.equal(suggest({ label: '추천인', section: '' }, sources), null);
});
