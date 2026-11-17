// 실제 Chrome 확장 설치 대신 Chrome API 대역을 사용한 팝업 수명주기 검사.
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "popup lifecycle"));

function plus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function popup(page: import('@playwright/test').Page, existing = false, due: object[] = []) {
  await page.addInitScript(() => {
    const listeners: ((changes: object, area: string) => void)[] = [];
    const session: Record<string, string> = { accessToken: "account-a-test" };
    let reads = 0;
    const calls: unknown[] = [];
    (window as any).extensionCalls = () => calls;
    (window as any).chrome = {
      tabs: { query: async () => [{ id: 1, windowId: 9, url: "https://example.com/job/1", title: "[회사] 개발자" }], create: async () => {} },
      sidePanel: { open: async (options: unknown) => { calls.push({ sidePanel: options }); } },
      runtime: { sendMessage: async (message: unknown) => { calls.push({ message }); return { ok: true }; } },
      scripting: { executeScript: async () => { reads++; return [{ result: { url: "https://example.com/job/1", title: "[회사] 개발자", ogTitle: "", siteName: "", h1: "" } }]; } },
      storage: {
        sync: { get: async () => ({ apiUrl: location.origin + "/fake-api" }) },
        session: {
          get: async () => ({ ...session }),
          set: async (values: Record<string, string>) => { const oldValue = session.accessToken; Object.assign(session, values); listeners.forEach((f) => f({ accessToken: { oldValue, newValue: session.accessToken } }, "session")); },
          remove: async () => { const oldValue = session.accessToken; delete session.accessToken; listeners.forEach((f) => f({ accessToken: { oldValue } }, "session")); },
        },
        onChanged: { addListener: (f: typeof listeners[number]) => listeners.push(f), removeListener: () => {} },
        local: {
          get: async (key: string) => { const raw = sessionStorage.getItem(key); return raw ? { [key]: JSON.parse(raw) } : {}; },
          set: async (values: Record<string, unknown>) => { for (const [k, v] of Object.entries(values)) sessionStorage.setItem(k, JSON.stringify(v)); },
        },
      },
    };
    (window as any).pageReads = () => reads;
  });
  const saved = { id: "example-id", company: "회사", position: "개발자", job_category: "개발", url: "https://example.com/job/1", stage: "서류", status: "진행중" };
  await page.route("**/extension-fixture/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() || "popup.html";
    await route.fulfill({ body: await readFile(resolve('../extension', name)), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.route("**/fake-api/track/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (url.searchParams.get('sort') === 'due') return route.fulfill({ json: due });
    await route.fulfill({ json: path.endsWith('/stats') ? { total: existing ? 1 : 0, status: { 진행중: 1, 합격: 0 } } : path.endsWith('/sync') ? { created: false } : existing ? [saved] : [] });
  });
  await page.goto('/extension-fixture/popup.html');
  return saved;
}

test("popup reads page metadata only after a user gesture", async ({ page }) => {
  await popup(page);
  await expect(page.locator('#save-form')).toBeVisible();
  expect(await page.evaluate(() => (window as any).pageReads())).toBe(0);
  await page.getByRole('button', { name: '페이지 제목으로 채우기' }).click();
  await expect(page.locator('#company')).toHaveValue('회사');
  expect(await page.evaluate(() => (window as any).pageReads())).toBe(1);
});

test("existing posting can be confirmed as submitted by an explicit click", async ({ page }) => {
  await popup(page, true);
  const body = page.waitForRequest((r) => r.url().endsWith('/track/sync'));
  await page.getByRole('button', { name: '지원 완료로 표시' }).click();
  expect((await body).postDataJSON()).toMatchObject({ submitted: true, essays: [] });
});

test("account switching clears stale recent rows and old request results", async ({ page }) => {
  await popup(page, true);
  await expect(page.locator('#recent')).toContainText('회사');
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/fake-api/track/**', async (route) => { await gate; await route.fulfill({ json: [] }); });
  await page.evaluate(() => (window as any).chrome.storage.session.set({ accessToken: 'account-b-test' }));
  await expect(page.locator('#recent')).toBeEmpty();
  await expect(page.locator('#existing')).toBeHidden();
  release();
});

test("401 clears session and offers login again", async ({ page }) => {
  await popup(page, true);
  await page.route('**/fake-api/track/**', (route) => route.fulfill({ status: 401, json: { detail: '세션이 만료되었습니다' } }));
  await page.getByRole('button', { name: '지원 완료로 표시' }).click();
  await expect(page.getByRole('button', { name: '다시 로그인' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).chrome.storage.session.get())).toEqual({});
  await expect(page.locator('#recent')).toBeEmpty();
});

test("login CTA requires configured team URL instead of assuming a web login route", async ({ page }) => {
  await popup(page, true);
  await page.route('**/fake-api/track/**', (route) => route.fulfill({ status: 401, json: { detail: 'expired' } }));
  await page.getByRole('button', { name: '지원 완료로 표시' }).click();
  await page.getByRole('button', { name: '다시 로그인' }).click();
  await expect(page.getByRole('alert')).toContainText('팀 로그인 주소');
});

test("Fill this application opens the side panel and asks the background to connect the tab", async ({ page }) => {
  await popup(page);
  const fill = page.getByRole('button', { name: '이 지원서 채우기' });
  await expect(fill).toBeEnabled();
  await page.evaluate(() => { window.close = () => {}; });
  await fill.click();
  await expect.poll(() => page.evaluate(() => (window as any).extensionCalls())).toEqual([
    { sidePanel: { windowId: 9 } },
    { message: { type: 'JS_CONNECT_TAB', tabId: 1 } },
  ]);
});

test("upcoming deadlines and today's tasks show with D-day", async ({ page }) => {
  const app = (id: string, company: string, extra: object) => ({ id, company, position: "개발자", stage: "서류", status: "진행중", applied_at: null, deadline: null, next_step_on: null, next_step: null, ...extra });
  await popup(page, false, [
    app("a", "오늘회사", { deadline: plus(0) }),
    app("b", "닷새회사", { applied_at: plus(-3), next_step_on: plus(5), next_step: "1차 면접" }),
    app("c", "먼회사", { deadline: plus(20) }),
  ]);
  const today = page.getByRole("region", { name: "오늘 할 일" });
  await expect(today.getByRole("listitem")).toHaveCount(1);
  await expect(today).toContainText("D-day");
  await expect(today).toContainText("오늘회사");
  const soon = page.getByRole("region", { name: "다가오는 일정" });
  await expect(soon.getByRole("listitem")).toHaveCount(1); // today's item is not repeated here
  await expect(soon.getByRole("listitem").first()).toContainText("D-5");
  await expect(soon.getByRole("listitem").first()).toContainText("1차 면접");
  await expect(soon).not.toContainText("먼회사");
});

test("saving a posting sends its deadline", async ({ page }) => {
  await popup(page);
  await page.locator('#company').fill('회사');
  await page.locator('#position').fill('개발자');
  await page.getByLabel('마감일').fill(plus(7));
  const body = page.waitForRequest((r) => r.url().endsWith('/track/sync'));
  await page.getByRole('button', { name: '지원 관리에 저장' }).click();
  expect((await body).postDataJSON()).toMatchObject({ deadline: plus(7) });
});

test("the cyber prayer beads count presses and keep them after reopening", async ({ page }) => {
  await popup(page);
  const bead = page.getByRole('button', { name: '한 알 넘기기' });
  for (let i = 0; i < 3; i++) await bead.click();
  await expect(page.getByTestId('beads-count')).toHaveText('오늘 3번 · 모두 3번');
  await expect(page.locator('.bead.lit')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('beads-count')).toHaveText('오늘 3번 · 모두 3번');
  await page.getByRole('button', { name: '한 알 넘기기' }).press('Space');
  await expect(page.getByTestId('beads-count')).toHaveText('오늘 4번 · 모두 4번');
});
