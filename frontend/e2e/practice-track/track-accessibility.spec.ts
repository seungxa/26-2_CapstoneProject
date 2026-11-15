import { expect, test } from "@playwright/test";
import { API } from "./env";

test('Track links and essay editor fit the viewport and have keyboard labels', async ({ page, request }) => {
  const app = await (await request.post(`${API}/track/applications`, { data: { company: `키보드${Date.now()}`, position: '개발자' } })).json();
  await request.post(`${API}/track/applications/${app.id}/essays`, { data: { question_text: '지원 동기', content: '첫 답변' } });
  await page.goto('/track');
  await page.getByPlaceholder('Search company or role').fill(app.company);
  const link = page.getByRole('link', { name: app.company, exact: true });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: `${app.company} · 개발자` })).toBeVisible();
  await expect(page.getByLabel('Answer to 지원 동기', { exact: true })).toHaveValue('첫 답변');
  await expect(page.getByLabel('Answer to 지원 동기', { exact: true })).toHaveAttribute('lang', 'ko');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('stats show applied dates and separate hold from waiting', async ({ page }) => {
  const row = { stage: '서류', reached: 3, passed: 0, failed: 0, pending: 3, hold: 1, pass_rate: null };
  await page.route((url) => url.port === '8011' && url.pathname === '/track/stats', (route) => route.fulfill({ json: {
    total: 3, status: { 진행중: 2, 보류: 1, 합격: 0, 불합격: 0 }, funnel: [row], by_job_category: [],
    monthly: [{ month: '2026-11', count: 3 }], applied_monthly: [{ month: '2026-10', count: 2 }], undated_count: 1,
  } }));
  await page.goto('/track/stats');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['By Stage', 'By Month', 'By Job']);
  await expect(page.locator('.bar-row')).toContainText('Application');
  await expect(page.getByText('By date applied · 1 with no date', { exact: true })).toBeVisible();
  await expect(page.getByText('2026-10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show Table', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'On Hold', exact: true })).toBeVisible();
  await expect(page.locator('tbody').first().locator('tr').getByRole('cell')).toHaveText(['Application', '3', '0', '0', '2', '1', '–']);
  await page.getByRole('button', { name: 'Show Chart', exact: true }).click();
  await expect(page.locator('.bar-row')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('creating an application prevents duplicate clicks and keeps failed form values', async ({ page }) => {
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/track/applications', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    count++;
    await gate;
    await route.fulfill({ status: 500, json: { detail: 'Could not add the application.' } });
  });
  await page.goto('/track');
  await page.getByRole('button', { name: 'Add Application', exact: true }).click();
  await page.getByLabel('Company', { exact: true }).fill('실패 후 보존');
  await page.getByLabel('Role', { exact: true }).fill('개발');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  expect(count).toBe(1);
  release();
  await expect(page.getByRole('alert')).toHaveText('Could not add the application.');
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('실패 후 보존');
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Company', { exact: true })).toHaveCount(0);
});
