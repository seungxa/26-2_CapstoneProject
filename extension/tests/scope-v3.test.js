import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('no generic click/scan/submit/navigation; bounded field/option/address capabilities',async()=>{
  const code=await readFile(new URL('../content.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/case\s+['"]JS_(CLICK|ACTIONS|SCAN)['"]/);
  assert.doesNotMatch(code,/\.(submit|requestSubmit|focus|blur)\s*\(/);
  assert.doesNotMatch(code,/(?:location\.(?:href|assign|replace)|history\.(?:go|back|forward))\s*[=(]/);
  assert.match(code,/addressButton\(entry.root\)!==entry.addressButton/);assert.match(code,/function clickSelection/);
});
