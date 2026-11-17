// Cross-site structures + the AI layer, with a local mock of the Anthropic Messages API.
// Run: PW_CHANNEL=chromium node tests/generic-browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const root = path.resolve(__dirname, '..');

const asked = { map: [], pick: [] };
function mockModel(body) {
  const user = body.messages[0].content;
  if (/판단 모듈/.test(body.system)) {
    const { fields, archive } = JSON.parse(user);
    const by = (k, v) => archive.find(a => a.path.endsWith(k) && (v === undefined || a.value === v))?.path;
    const results = fields.map(f => {
      asked.map.push(f.label);
      if (f.label === '최종학력') return { id: f.id, sourcePath: by('.tier', '대학교'), option: '대졸(4년)', confidence: 0.9, reason: '대학교 졸업' };
      if (f.label === '출신고교 소재지') return { id: f.id, sourcePath: by('.location'), value: '경기', confidence: 0.92, reason: '고등학교 소재지' };
      if (f.label === '출신대학') return { id: f.id, sourcePath: f.knownSource || by('.school', '예시대학교'), value: '예시대', confidence: 0.88, reason: '약칭 안내' };
      if (f.label === '희망연봉') return { id: f.id, sourcePath: null, value: null, option: null, confidence: 0, reason: '아카이브에 없는 정보' };
      // An injected / invented answer must be rejected by validation.
      if (f.label === '근무부서') return { id: f.id, sourcePath: by('.department'), value: '지어낸 부서', confidence: 0.99, reason: 'x' };
      return { id: f.id, sourcePath: null, confidence: 0, reason: '모름' };
    });
    return { results };
  }
  if (/검색 결과나 선택 목록/.test(body.system)) {
    const { stored, candidates } = JSON.parse(user);
    asked.pick.push(stored + ' <- ' + candidates.map(c => c.text).join(' | '));
    const i = candidates.findIndex(c => /본교/.test(c.text));
    return { index: i, confidence: i >= 0 ? 0.9 : 0, reason: '본교' };
  }
  return { ok: true };
}

(async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
        const answer = mockModel(JSON.parse(raw));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }] }));
      });
      return;
    }
    const name = url.pathname.slice(1);
    if (!/^demo-[a-z]+\.(html|js)$/.test(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('js') ? 'text/javascript' : 'text/html;charset=utf-8');
    res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const ctx = await chromium.launchPersistentContext('', { headless: true, channel: process.env.PW_CHANNEL || undefined, executablePath: process.env.CHROME_EXECUTABLE,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-features=DisableLoadExtensionCommandLineSwitch', '--load-extension=' + root] });
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const panel = await ctx.newPage();
    await panel.goto('chrome-extension://' + new URL(worker.url()).host + '/panel.html');
    const archive = { revision: 1,
      profile: { name: '김예시', nameEnglish: 'Yesi Kim', gender: '남성', veteran: '비대상' },
      military: [{ branch: '육군', serviceStatus: '만기전역' }],
      education: [{ tier: '고등학교', school: '동탄국제고등학교', location: '경기' }, { tier: '대학교', school: '예시대학교', major: '컴퓨터공학과', status: '졸업' }],
      experience: [{ company: '가상데이터랩', department: '서비스기획팀', status: '퇴사' }] };
    const run = async (ai) => {
      await panel.evaluate(([archive, ai, base]) => chrome.storage.local.set({ 'jobseeker.archive.v1': archive, 'jobseeker.llm.v1': { enabled: ai, provider: 'anthropic', base: base + '/v1', model: 'mock-model', apiKey: 'test-key' } }), [archive, ai, base]);
      const page = ctx.pages()[0];
      await page.goto(base + '/demo-generic.html');
      await page.frameLocator('#career').locator('#company').waitFor();
      await page.bringToFront();
      await panel.evaluate(() => document.querySelector('#stage').click());
      await panel.waitForFunction(() => !document.querySelector('#stage').disabled && /입력 완료/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
      console.log('[' + (ai ? 'AI on' : 'rules only') + '] ' + await panel.locator('#status').textContent());
      console.log((await panel.locator('#results').innerText()).split('\n').map(l => '   ' + l).join('\n'));
      return page;
    };

    // 1) Rules only: everything structural works; judgment-only fields stay blank.
    let page = await run(false);
    const v = id => page.locator('#' + id).inputValue();
    assert.equal(await v('nm'), '김예시');
    assert.equal(await page.locator('name-box input').inputValue(), 'Yesi Kim', 'open shadow DOM');
    assert.equal(await page.locator('#tg-m').getAttribute('class'), 'tg on', 'toggle button group');
    assert.equal(await page.locator('#v2').isChecked(), true, 'hidden radio via label');
    assert.equal(await v('branch'), 'A'); assert.equal(await page.locator('#branch-ui').textContent(), '육군', 'select2-like mirror');
    assert.equal(await page.locator('#svc .txt').textContent(), '군필', 'div dropdown + 만기전역→군필 equivalence');
    assert.equal(await v('hs'), '동탄국제', 'printed 고등학교 suffix');
    assert.equal(await v('major'), '컴퓨터공학', 'layer search: retried with 컴퓨터공학, skipped 야간');
    assert.equal(await v('uni'), '', 'two campus results stay for the user without AI');
    assert.equal(await page.frameLocator('#career').locator('#company').inputValue(), '가상데이터랩', 'iframe');
    assert.equal(await page.frameLocator('#career').locator('#dept').inputValue(), '서비스기획팀');
    assert.equal(await page.frameLocator('#career').locator('#cur').isChecked(), false, '퇴사 keeps 재직중 unchecked');
    for (const id of ['final', 'hs-loc', 'uni-short', 'pay']) assert.equal(await v(id), '', id + ' needs judgment');
    assert.equal(asked.map.length + asked.pick.length, 0);
    assert.equal(await page.evaluate(() => window.stageActions), 0);
    console.log('PASS rules-only: div grid, shadow DOM, toggles, hidden radios, select2 mirror, div dropdown, suffix rule, layer search retry, iframe');

    // 2) AI on: only the leftovers go to the model; answers are validated and wait for the user's OK.
    page = await run(true);
    assert.equal(await v('final'), '', 'AI suggestions are not applied before confirmation');
    const cards = await panel.$$eval('#review .suggestion h3', els => els.map(e => e.textContent));
    assert.deepEqual(cards.sort(), ['최종학력', '출신고교 소재지', '출신대학'].sort());
    assert.match(await panel.locator('#review').innerText(), /희망연봉/, 'unresolved blank is listed for the user');
    await panel.evaluate(() => [...document.querySelectorAll('#review button')].find(b => b.textContent === '모두 적용').click());
    await panel.waitForFunction(() => [...document.querySelectorAll('#review .suggestion')].every(c => c.querySelector('.actions span')), null, { timeout: 30000 });
    console.log('   cards:', (await panel.locator('#review .suggestion').allInnerTexts()).join(' / ').replace(/\n/g,' '));
    assert.equal(await page.locator('#final').inputValue(), '3', 'AI chose 대졸(4년)');
    assert.equal(await v('hs-loc'), '경기');
    assert.equal(await v('uni-short'), '예시대', 'AI shortened, derived from 예시대학교');
    assert.equal(await v('uni'), '', 'AI only recommends a campus; the user picks it');
    assert.match(await panel.locator('#results').innerText(), /AI 추천: "예시대학교" → "예시대학교\(본교\)"/);
    assert.equal(await v('pay'), '', 'not in archive');
    assert.equal(await v('hs'), '동탄국제'); assert.equal(await v('nm'), '김예시');
    assert.ok(!asked.map.includes('이름') && !asked.map.includes('군별'), 'rule-resolved fields are not sent: ' + asked.map.join(','));
    assert.equal(await page.evaluate(() => window.stageActions), 0);
    console.log('   model was asked about: ' + [...new Set(asked.map)].join(', ') + ' | picks: ' + asked.pick.length);
    console.log('PASS AI: suggestions wait for confirmation, then apply; campus pick is a recommendation; blanks listed');
  } finally { await ctx.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
