// The popup on its own: autofill must work with no JobSeeker server or web page, and the Track part only appears once
// the server answers. The extension folder is served on a fake origin and chrome APIs are stand-ins.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../../../extension/", import.meta.url);
const ORIGIN = "http://ext.test";
const API = "http://localhost:8000";

async function openPopup(page: Page, api: "down" | "401" | "up" | "silent", tabUrl = "https://jobs.example.com/apply") {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1) || "popup.html";
    const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
    await route.fulfill({ body: await readFile(new URL(path, ROOT)), contentType: type });
  });
  await page.route(`${API}/**`, async (route) => {
    if (api === "down") return route.abort("connectionrefused");
    if (api === "silent") return; // never answers, like a firewall that drops packets
    if (api === "401") return route.fulfill({ status: 401, json: { detail: "Not authenticated" } });
    const path = new URL(route.request().url()).pathname;
    const body = path === "/track/stats" ? { total: 1, status: { 진행중: 1, 합격: 0, 불합격: 0 } }
      : [{ id: 1, company: "토스", position: "서버 개발자", status: "진행중", stage: "서류", url: "https://other.example.com" }];
    return route.fulfill({ json: body });
  });
  await page.addInitScript((url) => {
    const area = () => ({ get: async () => ({}), set: async () => undefined, remove: async () => undefined });
    const sent: unknown[] = [];
    (window as unknown as { sent: unknown[] }).sent = sent;
    (window as unknown as { chrome: unknown }).chrome = {
      storage: { sync: area(), local: area(), session: area(), onChanged: { addListener: () => undefined } },
      tabs: { query: async () => [{ id: 7, windowId: 3, url, title: "채용" }], get: async () => ({ id: 7, windowId: 3, url }),
        create: async () => undefined },
      sidePanel: { open: async (a: unknown) => { sent.push({ sidePanel: a }); } },
      runtime: { sendMessage: async (m: unknown) => { sent.push(m); return { ok: true }; } },
      scripting: { executeScript: async () => [{ result: {} }] },
    };
  }, tabUrl);
  await page.goto(`${ORIGIN}/popup.html`);
}

test("with no server the popup shows autofill only, quietly", async ({ page }) => {
  await openPopup(page, "down");
  await expect(page.locator("#track-off")).toBeVisible();
  await expect(page.locator("#track-off")).toContainText("자동입력은 서버 없이");
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#track")).toBeHidden();
  await expect(page.locator("#fill")).toBeEnabled();
  await page.locator("#fill").click();
  expect(await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent))
    .toContainEqual({ type: "JS_CONNECT_TAB", tabId: 7 });
});

test("signed out of a server with sign-in: the Track part stays folded with a sign-in button, no red error", async ({ page }) => {
  await openPopup(page, "401");
  await expect(page.locator("#track-off")).toContainText("로그인");
  await expect(page.locator("#relogin")).toBeVisible();
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#track")).toBeHidden();
});

test("with the server up the Track part appears", async ({ page }) => {
  await openPopup(page, "up");
  await expect(page.locator("#track")).toBeVisible();
  await expect(page.locator("#recent")).toContainText("토스 · 서버 개발자");
  await expect(page.locator("#track-off")).toBeHidden();
});

test("the prayer beads and interview practice links are gone", async ({ page }) => {
  await openPopup(page, "up");
  await expect(page.locator("#track")).toBeVisible();
  for (const id of ["#beads-box", "#bead", "#open-practice", "#ex-practice"]) await expect(page.locator(id)).toHaveCount(0);
  await expect(page.getByText("면접")).toHaveCount(0);
  await expect(page.getByText("염주")).toHaveCount(0);
  await expect(page.locator("#open-track")).toBeVisible();
});

test("a server that never answers folds the Track part within a few seconds", async ({ page }) => {
  await openPopup(page, "silent");
  await expect(page.locator("#track-off")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#fill")).toBeEnabled();
});
