import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./env";

// Gaze direction in practice (behind a flag). The fake detector's virtual user follows the calibration dots.
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "camera flow"));
test.setTimeout(120_000);

async function seed(request: APIRequestContext) {
  const q = await (await request.post(`${API}/practice/questions`, { data: { category: "인성", text: `시선 방향 질문 ${Date.now()}-${Math.random()}` } })).json();
  return (await request.post(`${API}/practice/sessions`, { data: { mode: "free", question_ids: [q.id], prep_sec: 0, answer_sec: 10 } })).json();
}

async function open(page: Page, request: APIRequestContext, flag: boolean) {
  await page.addInitScript((on) => {
    localStorage.setItem("e2e-face-detector", "gaze");
    localStorage.setItem("e2e-gaze-scale", "0.2");
    if (on) localStorage.setItem("e2e-gaze-direction", "1");
  }, flag);
  const session = await seed(request);
  await page.goto(`/practice/sessions/${session.id}/run`);
  await page.locator(".camera-panel").getByRole("button", { name: "Turn On Camera" }).click();
  await expect(page.locator(".camera-panel").getByText("Face in view")).toBeVisible();
}

async function recordAndReview(page: Page) {
  const consent = page.getByRole("button", { name: "Agree & Start" });
  if (await consent.count()) await consent.click();
  else await page.getByRole("button", { name: "Start Answer", exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Finish Answer" }).click();
  await page.getByLabel("Transcript (editable)").fill("팀 프로젝트에서 일정 관리를 맡았습니다.");
  await page.getByRole("button", { name: "Finish & Review" }).click();
  await page.locator("details.answer-card > summary").click();
}

test("after calibrating, the review shows gaze direction for the answer", async ({ page, request }) => {
  await open(page, request, true);
  await page.getByRole("button", { name: "Calibrate", exact: true }).click();
  await expect(page.getByText("Gaze calibrated.")).toBeVisible({ timeout: 60_000 });
  await recordAndReview(page);
  const card = page.locator(".camera-delivery");
  await expect(card.getByRole("heading", { name: "Gaze direction" })).toBeVisible();
  await expect(card.locator('[data-metric="gaze-center"]')).toHaveText(/^\d+%/);
  await expect(card).toContainText("This isn't a score.");
});

test("with the flag off nothing about gaze direction appears", async ({ page, request }) => {
  await open(page, request, false);
  await expect(page.getByRole("button", { name: "Calibrate", exact: true })).toHaveCount(0);
  await recordAndReview(page);
  await expect(page.locator(".camera-delivery")).toBeVisible();
  await expect(page.locator(".camera-delivery").getByRole("heading", { name: "Gaze direction" })).toHaveCount(0);
});

test("Skip hides the step and measures nothing", async ({ page, request }) => {
  await open(page, request, true);
  await page.getByRole("button", { name: "Skip Calibration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Calibrate", exact: true })).toHaveCount(0);
  await recordAndReview(page);
  await expect(page.locator(".camera-delivery").getByRole("heading", { name: "Gaze direction" })).toHaveCount(0);
});

test("an answer cannot start while calibrating, and calibration can be cancelled", async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem("e2e-gaze-scale", "3")); // slow enough to act during it
  await open(page, request, true);
  await page.getByRole("button", { name: "Calibrate", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Gaze calibration" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Start Answer", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Answer", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Try Again", exact: true })).toBeVisible();
});

test("with gaze direction on, the camera details no longer say it isn't eye tracking", async ({ page, request }) => {
  await open(page, request, true);
  const details = page.locator(".camera-panel details");
  await expect(details).toContainText("rough estimate of where you looked");
  await expect(details).not.toContainText("not eye tracking");
});
