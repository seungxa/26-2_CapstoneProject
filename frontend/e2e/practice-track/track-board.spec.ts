import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./env";

// Stage board: one column per stage; cards move by buttons or by dragging, and a failed move puts the card back.

async function newApp(request: APIRequestContext, company: string, stage = "서류") {
  const r = await request.post(`${API}/track/applications`, { data: { company, position: "백엔드", job_category: "개발", stage } });
  expect(r.status()).toBe(201);
  return r.json();
}

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const card = (page: Page, company: string) => page.getByRole("article", { name: new RegExp(`^${company}`) });

test("buttons move a card to the next stage and it stays there", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "flow check");
  const company = `보드${Date.now()}`;
  const app = await newApp(request, company);
  await page.goto("/track/board");
  await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
  await expect(column(page, "Application").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
  await expect(card(page, company).getByRole("button", { name: "Move to previous stage" })).toHaveCount(0);
  await card(page, company).getByRole("button", { name: "Move to next stage" }).click();
  await expect(column(page, "Aptitude Test").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
  await page.reload();
  await expect(column(page, "Aptitude Test").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
  expect((await (await request.get(`${API}/track/applications/${app.id}`)).json()).stage).toBe("인적성");
});

test("dragging a card onto a column moves it", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "mouse drag");
  const company = `끌기${Date.now()}`;
  const app = await newApp(request, company);
  await page.goto("/track/board");
  // Drop near the column's heading: other runs leave cards in this column, so its middle can be below the screen
  await card(page, company).dragTo(column(page, "2nd Interview"), { targetPosition: { x: 40, y: 16 } });
  await expect(column(page, "2nd Interview").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${API}/track/applications/${app.id}`)).json()).stage).toBe("2차면접");
});

test("a passed card is hidden until Show closed", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "flow check");
  const company = `합격${Date.now()}`;
  await newApp(request, company, "최종");
  await page.goto("/track/board");
  await card(page, company).getByRole("combobox", { name: "Status" }).selectOption("합격");
  await expect(card(page, company)).toHaveCount(0);
  await page.getByRole("button", { name: /^Show closed \(\d+\)$/ }).click();
  await expect(column(page, "Final").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
});

test("board move failure restores the card", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "flow check");
  const company = `실패${Date.now()}`;
  await newApp(request, company);
  await page.goto("/track/board");
  await page.route("**/track/applications/*", (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Server unavailable." }) })
    : route.fallback());
  await card(page, company).getByRole("button", { name: "Move to next stage" }).click();
  await expect(page.getByRole("alert")).toContainText("Server unavailable.");
  await expect(column(page, "Application").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
  await expect(column(page, "Aptitude Test").getByRole("article", { name: new RegExp(`^${company}`) })).toHaveCount(0);
});

test("an empty board points to adding an application", async ({ page }) => {
  await page.route("**/track/applications?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/track/applications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/track/board");
  await expect(page.getByText("Add an application first")).toBeVisible();
  await expect(page.getByRole("link", { name: "Applications", exact: true }).last()).toBeVisible();
});

test("on a phone the columns stack in stage order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "narrow screen layout");
  await page.goto("/track/board");
  const boxes = [];
  for (const name of ["Application", "Aptitude Test", "1st Interview", "2nd Interview", "Final"]) {
    boxes.push(await column(page, name).boundingBox());
  }
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y);
  const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(width).toBe(true);
});

test("a keyboard move keeps focus on the card and announces it", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "keyboard flow");
  const company = `키보드${Date.now()}`;
  await newApp(request, company);
  await page.goto("/track/board");
  await card(page, company).getByRole("button", { name: "Move to next stage" }).focus();
  await page.keyboard.press("Enter");
  await expect(column(page, "Aptitude Test").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(`Moved ${company} to Aptitude Test`);
  const focused = card(page, company).getByRole("button", { name: "Move to next stage" });
  await expect(focused).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(column(page, "1st Interview").getByRole("article", { name: new RegExp(`^${company}`) })).toBeVisible();
  await expect(card(page, company).getByRole("button", { name: "Move to next stage" })).toBeFocused();
});
