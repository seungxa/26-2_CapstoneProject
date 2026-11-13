import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('persistent incruit access covers the reported suhyup application page', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.ok(manifest.host_permissions.includes('https://*.incruit.com/*'));
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
});
