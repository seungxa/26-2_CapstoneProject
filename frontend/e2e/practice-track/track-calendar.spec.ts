import { expect, test, type APIRequestContext } from "@playwright/test";
import { API } from "./env";

// Month calendar of applied dates, deadlines, next steps and results.

function plus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const monthName = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
};

async function newApp(request: APIRequestContext, company: string, extra: Record<string, unknown>) {
  const r = await request.post(`${API}/track/applications`, { data: { company, position: "백엔드", job_category: "개발", ...extra } });
  expect(r.status()).toBe(201);
  return r.json();
}

test("a deadline shows on its day and opens the application", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "month grid");
  const company = `달력${Date.now()}`;
  const app = await newApp(request, company, { deadline: plus(0) });
  await page.goto("/track/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  const today = page.locator(`td[data-date="${plus(0)}"]`);
  await expect(today).toHaveAttribute("aria-current", "date");
  const chip = today.getByRole("link", { name: `Deadline ${company}` });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/track/${app.id}$`));
});

test("Previous, Next and Today change the month", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "flow check");
  await page.goto("/track/calendar");
  const title = page.getByTestId("calendar-title");
  await expect(title).toHaveText(monthName(0));
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(title).toHaveText(monthName(1));
  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(title).toHaveText(monthName(-1));
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(title).toHaveText(monthName(0));
});

test("an empty month says so", async ({ page }) => {
  await page.route("**/track/calendar?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/track/calendar");
  await expect(page.getByText("Nothing this month")).toBeVisible();
});

test("on a phone the month is a list of days", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "narrow screen layout");
  const company = `목록${Date.now()}`;
  await newApp(request, company, { next_step_on: plus(0), next_step: "과제" });
  await page.goto("/track/calendar");
  await expect(page.locator("table.calendar")).toBeHidden();
  const list = page.getByRole("list", { name: "Days with items" });
  await expect(list.getByRole("link", { name: `Next ${company}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("result and next-step names are visible on the chip, and the month change is announced", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "month grid");
  const company = `결과${Date.now()}`;
  const app = await newApp(request, company, { next_step_on: plus(0), next_step: "과제 제출" });
  await request.post(`${API}/track/applications/${app.id}/events`, { data: { stage: "서류", result: "합격", event_date: plus(0) } });
  await page.goto("/track/calendar");
  const today = page.locator(`td[data-date="${plus(0)}"]`);
  await expect(today.getByRole("link", { name: new RegExp(`Next ${company}`) })).toContainText("과제 제출");
  await expect(today.getByRole("link", { name: new RegExp(`Result ${company}`) })).toContainText("Application Passed");
  await expect(page.getByTestId("calendar-title")).toHaveAttribute("aria-live", "polite");
});
