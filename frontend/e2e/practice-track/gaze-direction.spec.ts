import { expect, test, type Page } from "@playwright/test";

// 개발 전용 시선 방향 실험실(C5). 가짜 검출기의 가상 사용자가 화면의 점을 안내된 자세로 본다.
// 배선·흐름·판정 표시만 확인한다. 실제 웹캠 정확도는 docs/practice-track/gaze-direction-protocol.md 절차로 사람이 잰다.
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop"));
test.setTimeout(150_000);

async function startLab(page: Page, mode: string) {
  await page.addInitScript((m) => {
    localStorage.setItem("e2e-face-detector", m);
    localStorage.setItem("e2e-gaze-scale", "0.2"); // e2e에서만 단계 시간을 줄인다
  }, mode);
  await page.goto("/practice/dev/gaze-direction");
  await expect(page.getByRole("heading", { name: "시선 방향 실험실(개발 전용)" })).toBeVisible();
  await page.getByRole("button", { name: "동의하고 카메라 켜기" }).click();
  await expect(page.getByText("얼굴이 화면 안에 있어요")).toBeVisible();
  await page.getByRole("button", { name: "시험 시작" }).click();
}

test("following fake user: calibration succeeds, the run passes, nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => { const b = r.postData(); if (b) sent.push(b); });
  await startLab(page, "gaze");
  await expect(page.getByRole("heading", { name: "시험 결과" })).toBeVisible({ timeout: 120_000 });
  const rows = page.getByTestId("direction-results");
  for (const name of ["정면", "위", "아래", "왼쪽", "오른쪽"]) await expect(rows).toContainText(name);
  await expect(page.getByTestId("direction-verdict")).toContainText("통과");
  await expect(page.getByTestId("direction-runs")).toContainText("1번 중 통과 1");
  await expect(page.getByText("통과해도 정확도를 보장하지 않아요")).toBeVisible();
  expect(sent.filter((b) => /landmark|gaze|points|"ex"|"ey"/i.test(b))).toEqual([]);
});

test("a user who does not follow the dots fails calibration and can retry", async ({ page }) => {
  await startLab(page, "gaze-still");
  await expect(page.getByRole("alert")).toContainText("기준을 잡지 못했어요", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "다시 하기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});

/** 기준 잡기를 지나 첫 방향 시행(눈만 조건)이 화면에 나올 때까지 기다린다 */
const TRIAL_PROMPT = "고개는 그대로, 눈으로만 점을 보세요";
async function reachTrials(page: Page) {
  await expect(page.getByTestId("direction-prompt")).toContainText(TRIAL_PROMPT, { timeout: 60_000 });
}

test("resizing the window during a trial invalidates the run", async ({ page }) => {
  await startLab(page, "gaze");
  await reachTrials(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.getByRole("alert")).toContainText("무효", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "처음부터 다시" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});

test("hiding the tab during a trial invalidates the run", async ({ page }) => {
  await startLab(page, "gaze");
  await reachTrials(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("alert")).toContainText("다른 탭", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});

test("stopping during a trial returns to the start with no results", async ({ page }) => {
  await startLab(page, "gaze");
  await reachTrials(page);
  await page.getByRole("button", { name: "시험 중단" }).click();
  await expect(page.getByRole("button", { name: "시험 시작" })).toBeEnabled();
  await expect(page.getByTestId("direction-prompt")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});

test("turning the camera off during a trial stops the run with no results", async ({ page }) => {
  await startLab(page, "gaze");
  await reachTrials(page);
  // 시험 레이어가 화면을 덮으므로 사용자가 누를 수는 없다(카메라가 끊긴 경우와 같은 상태 변화만 만든다)
  await page.getByRole("button", { name: "카메라 끄기" }).dispatchEvent("click");
  await expect(page.getByTestId("direction-prompt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "시험 시작" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});

test("leaving the page during a trial and coming back shows a fresh lab", async ({ page }) => {
  await startLab(page, "gaze");
  await reachTrials(page);
  await page.goto("/practice");
  await page.goto("/practice/dev/gaze-direction");
  await expect(page.getByRole("heading", { name: "시선 방향 실험실(개발 전용)" })).toBeVisible();
  await expect(page.getByTestId("direction-prompt")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});

test("earlier results stay visible after a later run is stopped", async ({ page }) => {
  await startLab(page, "gaze");
  await expect(page.getByRole("heading", { name: "시험 결과" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "시험 시작" }).click();
  await reachTrials(page);
  await page.getByRole("button", { name: "시험 중단" }).click();
  await expect(page.getByRole("heading", { name: "시험 결과" })).toBeVisible();
  await expect(page.getByTestId("direction-runs")).toContainText("1번 중 통과 1");
  await expect(page.getByRole("button", { name: "집계 복사(JSON)" })).toBeVisible();
});
