import { expect, test, type Page } from '@playwright/test';
import { API } from './env';

const choice = (page: Page, text: string) => page.getByRole('checkbox', { name: `Select question: ${text}`, exact: true });
const startButton = (page: Page) => page.getByRole('button', { name: /^Start Practice \(\d+\)$/ });
// Playwright's exact getByLabel also reads the option text of a wrapped <select>, so selects are found by role.
const applicationField = (page: Page) => page.getByRole('combobox', { name: 'Application', exact: true });
const fold = (page: Page, summary: string) => page.locator('details').filter({ has: page.locator('summary', { hasText: new RegExp(`^${summary}$`) }) });

test('linked practice offers compatible questions and resets selection when the application changes', async ({ page, request }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const applications = [];
  const linkedQuestions = [];
  for (const name of ['기준 A', '기준 B']) {
    const response = await request.post(`${API}/track/applications`, { data: { company: `${name} ${suffix}`, position: '제품 개발자' } });
    expect(response.status()).toBe(201);
    const application = await response.json();
    applications.push(application);
    const generated = await request.post(`${API}/practice/questions/generate`, { data: { application_id: application.id, count: 1 } });
    expect(generated.status()).toBe(201);
    const questions = await generated.json();
    expect(questions).toHaveLength(1);
    linkedQuestions.push(questions[0]);
  }
  const unlinked = await (await request.post(`${API}/practice/questions`, { data: { category: '직무', text: `공통 선택 ${suffix}` } })).json();
  const start = startButton(page);

  await page.goto(`/practice?application=${applications[0].id}`);
  await expect(choice(page, linkedQuestions[0].text)).toBeVisible();
  await expect(choice(page, unlinked.text)).toBeVisible();
  await expect(choice(page, linkedQuestions[1].text)).toHaveCount(0);
  await choice(page, linkedQuestions[0].text).check();
  await expect(start).toHaveText('Start Practice (1)');
  await expect(start).toBeEnabled();

  await applicationField(page).selectOption(applications[1].id);
  await expect(choice(page, linkedQuestions[0].text)).toHaveCount(0);
  await expect(choice(page, linkedQuestions[1].text)).toBeVisible();
  await expect(start).toHaveText('Start Practice (0)');
  await expect(start).toBeDisabled();
  await choice(page, linkedQuestions[1].text).check();
  await expect(start).toBeEnabled();

  await applicationField(page).selectOption('');
  await expect(choice(page, linkedQuestions[0].text)).toBeVisible();
  await expect(choice(page, linkedQuestions[1].text)).toBeVisible();
  await expect(start).toBeDisabled();
  await applicationField(page).selectOption(applications[1].id);
  await choice(page, linkedQuestions[1].text).check();
  const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/practice/sessions'));
  await start.click();
  const response = await created;
  expect(response.status()).toBe(201);
  const session = await response.json();
  await expect(page).toHaveURL(new RegExp(`/practice/sessions/${session.id}/run$`));
  expect(session.application_id).toBe(applications[1].id);
  expect(session.answers.map((answer: { question: { id: string } }) => answer.question.id)).toEqual([linkedQuestions[1].id]);
});

test('the shared application source cannot change while question generation is saving', async ({ page, request }) => {
  const response = await request.post(`${API}/track/applications`, { data: { company: `대기 기준 ${test.info().project.name} ${Date.now()}`, position: '제품 개발자' } });
  const application = await response.json();
  const question = await (await request.post(`${API}/practice/questions`, { data: { category: '직무', text: `동시 삭제 확인 ${test.info().project.name} ${Date.now()}` } })).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/practice/questions/generate', async route => {
    entered();
    await gate;
    await route.continue();
  });
  await page.goto(`/practice?application=${application.id}`);
  const source = applicationField(page);
  const row = page.locator('.qlist li').filter({ has: choice(page, question.text) });
  const remove = row.getByRole('button', { name: 'Delete', exact: true });
  const generate = page.getByRole('button', { name: 'Generate Questions', exact: true });
  await expect(source).toHaveValue(application.id);
  await page.getByText('Generate Questions from an Essay', { exact: true }).click();
  await generate.click();
  await pending;
  try {
    await expect(source).toBeDisabled();
    const deletion = page.waitForResponse(result => result.request().method() === 'DELETE' && result.url().endsWith(`/practice/questions/${question.id}`), { timeout: 750 }).catch(() => null);
    // Native click must not start a second writer while generation owns the source.
    await remove.evaluate(element => (element as HTMLButtonElement).click());
    expect(await deletion).toBeNull();
    await expect(remove).toBeDisabled();
    await expect(source).toBeDisabled();
  } finally {
    release();
  }
  await expect(generate).toBeEnabled();
  await expect(source).toBeEnabled();
  await expect(source).toHaveValue(application.id);
  const questions = await (await request.get(`${API}/practice/questions`)).json();
  expect(questions.some((item: { id: string }) => item.id === question.id)).toBe(true);
  await expect(startButton(page)).toBeEnabled();
});

test('start screen leads with questions and one primary action', async ({ page }) => {
  await page.goto('/practice');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Practice');
  const questions = page.getByRole('region', { name: 'Questions', exact: true });
  await expect(questions.getByPlaceholder('Search questions', { exact: true })).toBeVisible();
  await expect(questions.getByRole('combobox')).toHaveCount(1); // the category filter; the rest is folded
  await expect(questions.getByRole('button', { name: 'Add a Question', exact: true })).toBeVisible();
  await expect(questions.locator('.qlist li').first()).toBeVisible();

  // The Questions card comes first, then only the Application field before Start Practice.
  await expect(page.locator('h1 + section h2')).toHaveText('Questions');
  const start = startButton(page);
  await expect(start).toHaveText('Start Practice (0)');
  const card = (await questions.boundingBox())!;
  const app = (await applicationField(page).boundingBox())!;
  const button = (await start.boundingBox())!;
  expect(app.y).toBeGreaterThanOrEqual(card.y + card.height);
  expect(button.y).toBeGreaterThan(app.y);
  expect(button.y - (card.y + card.height)).toBeLessThan(120);
  await expect(page.getByRole('button', { name: 'Mock Interview', exact: true })).toBeVisible();

  // Rarely used options start folded.
  for (const summary of ['More Options', 'Generate Questions from an Essay']) {
    await expect(fold(page, summary)).toHaveCount(1);
    expect(await fold(page, summary).evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  }
  await expect(page.getByRole('group', { name: 'Mock Interview', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Generate Questions', exact: true })).toBeHidden();

  // One primary action on the whole screen, even counting folded controls.
  await expect(page.locator('.practice-track button.primary')).toHaveCount(1);
  await expect(page.locator('.practice-track button.primary')).toHaveText(/^Start Practice/);

  // Every screen word is English; Korean interview content is marked lang="ko".
  await page.getByText('More Options', { exact: true }).click();
  await page.getByText('Generate Questions from an Essay', { exact: true }).click();
  const korean = await page.locator('.practice-track').evaluate(root => {
    const found: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/[가-힣]/.test(node.textContent ?? '') && !node.parentElement?.closest('[lang="ko"]')) found.push(node.textContent ?? '');
    }
    for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
      for (const name of ['placeholder', 'aria-label', 'title']) {
        const value = element.getAttribute(name) ?? '';
        if (/[가-힣]/.test(value) && !(name === 'aria-label' && value.startsWith('Select question: '))) found.push(value);
      }
    }
    return found;
  });
  expect(korean).toEqual([]);
});

test('folded options reach the mock interview and the custom question form', async ({ page, request }) => {
  const app = await (await request.post(`${API}/track/applications`, { data: { company: `모의 설정 ${Date.now()}`, position: '데이터 분석' } })).json();
  await page.goto(`/practice?application=${app.id}`);
  await expect(applicationField(page)).toHaveValue(app.id);

  // Custom question: Add a Question opens a small form, the new row shows its English category.
  const text = `직접 추가 확인 ${test.info().project.name} ${Date.now()}`;
  await page.getByRole('button', { name: 'Add a Question', exact: true }).click();
  const form = page.getByRole('group', { name: 'New Question', exact: true });
  await form.getByRole('combobox', { name: 'Category', exact: true }).selectOption('기업');
  await form.getByLabel('Question', { exact: true }).fill(text);
  const added = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/practice/questions'));
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await added).request().postDataJSON()).toMatchObject({ category: '기업', text });
  const row = page.locator('.qlist li').filter({ has: choice(page, text) });
  await expect(row).toContainText('Company');
  await expect(row.locator('[lang="ko"]')).toHaveText(text);

  // Search and the category filter narrow the list.
  const questions = page.getByRole('region', { name: 'Questions', exact: true });
  await questions.getByPlaceholder('Search questions').fill(text);
  await expect(questions.locator('.qlist li')).toHaveCount(1);
  await questions.getByLabel('Filter by category').selectOption('인성');
  await expect(choice(page, text)).toHaveCount(0);
  await questions.getByLabel('Filter by category').selectOption('기업');
  await expect(choice(page, text)).toBeVisible();

  // Mock interview settings, job posting, essay version and follow-ups live in More Options.
  await page.getByText('More Options', { exact: true }).click();
  const mock = page.getByRole('group', { name: 'Mock Interview', exact: true });
  await mock.getByLabel('Number of questions').fill('2');
  await mock.getByLabel('Prep time (sec)').fill('0');
  await mock.getByLabel('Answer time (sec)').fill('30');
  for (const name of ['Company', 'Situational']) await mock.getByLabel(name, { exact: true }).uncheck();
  await mock.getByRole('combobox', { name: 'Job', exact: true }).selectOption('데이터');
  await page.getByLabel('Job posting (optional)').fill('데이터 파이프라인 운영');
  await page.getByRole('combobox', { name: 'Essay version', exact: true }).selectOption('latest');
  await page.getByLabel('Offer follow-up questions').uncheck();
  const sent = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/practice/sessions'));
  await page.getByRole('button', { name: 'Mock Interview', exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    mode: 'mock', count: 2, prep_sec: 0, answer_sec: 30, categories: ['인성', '직무'], job_category: '데이터',
    application_id: app.id, essay_basis: 'latest', job_description: '데이터 파이프라인 운영', followups_enabled: false,
  });
  await expect(page).toHaveURL(/\/practice\/sessions\/[\w-]+\/run$/);
});

test('no horizontal scroll', async ({ page, request }) => {
  test.skip(test.info().project.name !== 'mobile', 'checks the 390px layout');
  const app = await (await request.post(`${API}/track/applications`, { data: { company: `아주 긴 이름을 가진 합성 회사 주식회사 ${Date.now()}`, position: '데이터 플랫폼 백엔드 엔지니어(대용량 처리)' } })).json();
  await request.post(`${API}/track/applications/${app.id}/essays`, { data: { question_text: '지원 동기와 입사 후 이루고 싶은 목표를 구체적으로 적어 주세요', content: '합성 자소서 본문' } });
  await page.goto(`/practice?application=${app.id}`);
  await expect(applicationField(page)).toHaveValue(app.id);
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(await noScroll()).toBe(true);
  await page.getByText('More Options', { exact: true }).click();
  await expect(page.getByRole('group', { name: 'Mock Interview', exact: true })).toBeVisible();
  await expect(page.getByTestId('practice-context-preview')).toContainText('v1 · Latest');
  expect(await noScroll()).toBe(true);
  await page.getByText('Generate Questions from an Essay', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate Questions', exact: true })).toBeVisible();
  expect(await noScroll()).toBe(true);
  await page.getByRole('button', { name: 'Add a Question', exact: true }).click();
  await expect(page.getByRole('group', { name: 'New Question', exact: true })).toBeVisible();
  expect(await noScroll()).toBe(true);
});
