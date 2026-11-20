import test from 'node:test';
import assert from 'node:assert/strict';
import { connectToTab } from '../tab-connection.js';
test('missing tab URL does not prevent an authorized injection', async () => {
  const calls = [];
  const tab = await connectToTab({ tabs: { query: async () => [{ id: 9 }] }, scripting: { executeScript: async args => { calls.push(args); return [{ result: { url: 'https://example.com/apply' } }]; } } });
  assert.equal(tab.url, 'https://example.com/apply'); assert.equal(calls.length, 2);
});
test('missing host permission gives actionable toolbar instruction', async () => {
  await assert.rejects(connectToTab({ tabs: { query: async () => [{ id: 9 }] }, scripting: { executeScript: async () => { throw Error('Cannot access contents'); } } }), /Site access blocked.*Cannot access contents/);
});
test('script loading failure is not disguised as missing permission', async () => {
  await assert.rejects(connectToTab({ tabs: { query: async () => [{ id: 9, url: 'https://example.com' }] }, scripting: { executeScript: async args => { if (args.files) throw Error('Could not load file: content.js'); return [{ result: { url: 'https://example.com' } }]; } } }), /load scripts.*Could not load file/);
});
test('restricted Chrome pages are rejected without injection', async () => {
  await assert.rejects(connectToTab({ tabs: { query: async () => [{ id: 9, url: 'chrome://extensions' }] } }), /job application page/);
});
