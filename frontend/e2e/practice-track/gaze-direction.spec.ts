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

test("resizing the window during the run invalidates it", async ({ page }) => {
  await startLab(page, "gaze");
  await expect(page.getByTestId("direction-prompt")).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.getByRole("alert")).toContainText("무효", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});

test("stopping the run returns to the start with no results", async ({ page }) => {
  await startLab(page, "gaze");
  await expect(page.getByTestId("direction-prompt")).toBeVisible();
  await page.getByRole("button", { name: "시험 중단" }).click();
  await expect(page.getByRole("button", { name: "시험 시작" })).toBeEnabled();
  await expect(page.getByTestId("direction-prompt")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "시험 결과" })).toHaveCount(0);
});
