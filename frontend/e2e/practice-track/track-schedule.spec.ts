import { expect, test, type APIRequestContext } from "@playwright/test";
import { API } from "./env";

// Deadlines and next steps: edited on the application page, shown as D-day chips, sorted by the nearest date.
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "flow check: same on every screen size"));

/** YYYY-MM-DD n days from today in local time (the server and the browser run on this machine) */
function plus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function newApp(request: APIRequestContext, company: string, extra: Record<string, unknown> = {}) {
  const r = await request.post(`${API}/track/applications`, { data: { company, position: "백엔드", job_category: "개발", ...extra } });
  expect(r.status()).toBe(201);
  return r.json();
}

test("deadlines and next steps show as D-day chips and can be cleared", async ({ page, request }) => {
  const tok = `일정${Date.now()}`;
  const app = await newApp(request, `${tok} 회사`);
  await page.goto(`/track/${app.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Deadline", { exact: true }).fill(plus(5));
  await page.getByLabel("Next step", { exact: true }).fill("1차 면접");
  await page.getByLabel("Next step date", { exact: true }).fill(plus(2));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const facts = page.locator("dl.facts");
  await expect(facts).toContainText("Deadline");
  await expect(facts).toContainText("1차 면접");
  await expect(page.locator(".app-head .chip.due")).toHaveText(/^D-2/);

  await page.goto("/track");
  await page.getByPlaceholder("Search company or role").fill(tok);
  const row = page.getByRole("row").filter({ hasText: `${tok} 회사` });
  await expect(row.locator(".chip.due")).toHaveText(/^D-2/);

  await page.goto(`/track/${app.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Deadline", { exact: true }).fill("");
  await page.getByLabel("Next step", { exact: true }).fill("");
  await page.getByLabel("Next step date", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(facts).not.toContainText("Deadline");
  await expect(page.locator(".app-head .chip.due")).toHaveCount(0);
  const saved = await (await request.get(`${API}/track/applications/${app.id}`)).json();
  expect([saved.deadline, saved.next_step, saved.next_step_on]).toEqual([null, null, null]);
});

test("Due soon puts the nearest date first", async ({ page, request }) => {
  const tok = `정렬${Date.now()}`;
  await newApp(request, `${tok} 늦음`, { deadline: plus(9) });
  await newApp(request, `${tok} 곧`, { deadline: plus(1) });
  await newApp(request, `${tok} 없음`);
  await page.goto("/track");
  await page.getByPlaceholder("Search company or role").fill(tok);
  const companies = page.locator("tbody tr td:first-child a");
  await expect(companies).toHaveText([`${tok} 없음`, `${tok} 곧`, `${tok} 늦음`]);
  await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("due");
  await expect(companies).toHaveText([`${tok} 곧`, `${tok} 늦음`, `${tok} 없음`]);
  await expect(page.getByRole("row").filter({ hasText: `${tok} 곧` }).locator(".chip.due")).toHaveText(/^D-1/);
});
