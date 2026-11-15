import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./env";
import type { ApplicationDetail, InterviewContext, Stats } from "../../src/features/practice-track/types";

// All application, essay, version, confirmation and event writes below use the real UI.
// API requests are read-only checks against the actual IDs created by that UI.
async function readStats(request: APIRequestContext): Promise<Stats> {
  const response = await request.get(`${API}/track/stats`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

// Stored values (Korean) → the English names the screen shows
const STAGE: Record<string, string> = { 서류: "Application", 인적성: "Aptitude Test", "1차면접": "1st Interview", "2차면접": "2nd Interview", 최종: "Final" };
const STATUS: Record<string, string> = { 진행중: "In Progress", 합격: "Passed", 불합격: "Rejected", 보류: "On Hold" };
const details = (page: Page) => page.getByRole("region", { name: "Details", exact: true });

async function state(page: Page, stage: string, status: string) {
  await expect(page.getByTestId("application-stage")).toHaveText(STAGE[stage]);
  await expect(page.getByTestId("application-status")).toHaveText(STATUS[status]);
}

/** The Details form keeps the stored values as select values and shows English names */
async function storedState(page: Page, stage: string, status: string) {
  await details(page).getByRole("button", { name: "Edit", exact: true }).click();
  const stageSelect = details(page).getByRole("combobox", { name: "Stage", exact: true });
  const statusSelect = details(page).getByRole("combobox", { name: "Status", exact: true });
  await expect(stageSelect).toHaveValue(stage);
  await expect(statusSelect).toHaveValue(status);
  await expect(stageSelect.locator("option:checked")).toHaveText(STAGE[stage]);
  await expect(statusSelect.locator("option:checked")).toHaveText(STATUS[status]);
  await details(page).getByRole("button", { name: "Cancel", exact: true }).click();
}

test("UI-created Track history and confirmed essays remain frozen in linked Practice", async ({ page, request }, testInfo) => {
  const baseline = await readStats(request);
  const company = `연습회사 ${testInfo.project.name} ${Date.now()}`;
  const position = "제품 개발자";
  const applied = "2026-11-01";
  const jobUrl = `https://example.com/jobs/practice-only-${testInfo.project.name}-${Date.now()}`;
  const essays = [
    { question: "지원 동기", answer: "작은 도구를 만들어 반복 작업을 줄였습니다." },
    { question: "협업 경험", answer: "역할을 나누고 매주 진행 상황을 공유했습니다." },
    { question: "문제 해결", answer: "오류를 재현한 뒤 원인을 기록하고 수정했습니다." },
  ];
  const first = page.getByRole("region", { name: essays[0].question, exact: true });
  const version = (n: number) => first.locator(".version-list").getByRole("button", { name: new RegExp(`^v${n}\\s`) });

  await test.step("A: create a complete application and refresh persisted fields", async () => {
    await page.goto("/track");
    await page.getByRole("button", { name: "Add Application", exact: true }).click();
    await page.getByLabel("Company", { exact: true }).fill(company);
    await page.getByLabel("Role", { exact: true }).fill(position);
    await page.getByLabel("Date applied", { exact: true }).fill(applied);
    await page.getByLabel("Job posting URL", { exact: true }).fill(jobUrl);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/track\/[\w-]+$/);
    await page.reload();
    await expect(page.getByRole("heading", { name: `${company} · ${position}`, exact: true })).toBeVisible();
    await expect(details(page)).toContainText("Nov 1, 2026");
    await expect(details(page).getByRole("link", { name: "Open Posting", exact: true })).toHaveAttribute("href", jobUrl);
    await details(page).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Company", { exact: true })).toHaveValue(company);
    await expect(page.getByLabel("Role", { exact: true })).toHaveValue(position);
    await expect(page.getByLabel("Date applied", { exact: true })).toHaveValue(applied);
    await expect(page.getByLabel("Job posting URL", { exact: true })).toHaveValue(jobUrl);
    await details(page).getByRole("button", { name: "Cancel", exact: true }).click();
  });
  const applicationId = new URL(page.url()).pathname.split("/").pop()!;
  const applicationPath = `/track/${applicationId}`;

  await test.step("B: add three questions and save each answer through the UI", async () => {
    for (const essay of essays) {
      await page.getByRole("textbox", { name: "New question", exact: true }).fill(essay.question);
      await page.getByRole("button", { name: "Add Question", exact: true }).click();
      const card = page.getByRole("region", { name: essay.question, exact: true });
      await expect(card.getByRole("heading", { level: 3 })).toHaveAttribute("lang", "ko");
      await card.getByRole("textbox", { name: `Answer to ${essay.question}`, exact: true }).fill(essay.answer);
      await card.getByRole("button", { name: "Save Version", exact: true }).click();
      await expect(card.locator(".version-list button")).toHaveCount(1);
    }
    await page.reload();
    for (const essay of essays) await expect(page.getByLabel(`Answer to ${essay.question}`, { exact: true })).toHaveValue(essay.answer);
  });

  await test.step("C: diff, append-only restoration, old-version confirmation and a newer draft", async () => {
    await first.getByRole("textbox").fill("작은 도구를 만들어 반복 작업을 크게 개선했습니다.");
    await first.getByRole("button", { name: "Save Version", exact: true }).click();
    await expect(first.locator(".version-list button")).toHaveCount(2);
    await first.getByText("Changes from v1", { exact: true }).click();
    await expect(first.locator("del")).toContainText("줄였습니다.");
    await expect(first.locator("ins")).toContainText("크게 개선했습니다.");
    await version(1).click();
    await first.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(first.locator(".version-list button")).toHaveCount(3);
    await expect(first.getByRole("textbox")).toHaveValue(essays[0].answer);
    await version(2).click();
    await expect(first.locator(".diff")).toHaveText("작은 도구를 만들어 반복 작업을 크게 개선했습니다.");
    await version(1).click();
    await first.getByRole("button", { name: "Mark as Submitted", exact: true }).click();
    await expect(first.getByText("Submitted: v1", { exact: true })).toBeVisible();
    await expect(version(1)).toContainText("Submitted");
    await version(3).click();
    await first.getByRole("textbox").fill("새 초안에서는 검토 방법을 덧붙였습니다.");
    await first.getByRole("button", { name: "Save Version", exact: true }).click();
    await expect(first.locator(".version-list button")).toHaveCount(4);
    await expect(first.getByText("Submitted: v1", { exact: true })).toBeVisible();
    await page.reload();
    await expect(first.getByRole("textbox")).toHaveValue("새 초안에서는 검토 방법을 덧붙였습니다.");
    await expect(first.getByText("Submitted: v1", { exact: true })).toBeVisible();
  });

  // A result's note shows under its stage name
  const note = (text: string) => page.locator(".event-note").getByText(text, { exact: true });

  async function addEvent(stage: string, result: string, date: string, memo: string) {
    await page.getByRole("combobox", { name: "New result stage", exact: true }).selectOption(stage);
    await page.getByRole("combobox", { name: "New result", exact: true }).selectOption(result);
    await page.getByLabel("New result date", { exact: true }).fill(date);
    await page.getByRole("textbox", { name: "New result note", exact: true }).fill(memo);
    await page.getByRole("button", { name: "Add Result", exact: true }).click();
    await expect(note(memo)).toBeVisible();
    await expect(note(memo)).toHaveAttribute("lang", "ko");
  }

  async function statsMatch(status: "진행중" | "불합격" | "보류", stage: string) {
    const stats = await readStats(request);
    expect(stats.total).toBe(baseline.total + 1);
    for (const value of ["진행중", "합격", "불합격", "보류"] as const) {
      expect(stats.status[value]).toBe(baseline.status[value] + (value === status ? 1 : 0));
    }
    const row = stats.funnel.find((r) => r.stage === stage)!;
    const previous = baseline.funnel.find((r) => r.stage === stage)!;
    expect(row.reached).toBe(previous.reached + 1);
    expect(row.failed).toBe(previous.failed + (status === "불합격" ? 1 : 0));
    expect(row.hold).toBe((previous.hold ?? 0) + (status === "보류" ? 1 : 0));
    await page.getByRole("link", { name: "Stats", exact: true }).click();
    await expect(page.locator(".tile").filter({ hasText: "Applications" }).locator(".v")).toHaveText(String(stats.total));
    await expect(page.locator(".tile").filter({ hasText: "Rejected" }).locator(".v")).toHaveText(String(stats.status["불합격"]));
    await page.getByRole("button", { name: "Show Table", exact: true }).click();
    const tableRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: STAGE[stage], exact: true }) });
    await expect(tableRow.getByRole("cell")).toHaveText([
      STAGE[stage], String(row.reached), String(row.passed), String(row.failed), String(row.pending - (row.hold ?? 0)), String(row.hold ?? 0),
      row.pass_rate == null ? "–" : `${Math.round(row.pass_rate * 100)}%`,
    ]);
    await page.goto(applicationPath);
    await state(page, stage, status);
  }

  await test.step("D: event history, correction, deletion and explicit manual override keep stats coherent", async () => {
    await addEvent("서류", "합격", "2026-11-02", "서류 확인");
    await state(page, "인적성", "진행중");
    await addEvent("인적성", "합격", "2026-11-03", "인적성 확인");
    await state(page, "1차면접", "진행중");
    await addEvent("1차면접", "불합격", "2026-11-04", "면접 확인");
    await state(page, "1차면접", "불합격");
    await statsMatch("불합격", "1차면접");
    await page.getByRole("row").filter({ hasText: "면접 확인" }).getByRole("button", { name: "Edit result: 1st Interview Nov 4, 2026", exact: true }).click();
    const edit = page.getByRole("group", { name: "Edit Result", exact: true });
    await expect(edit).toBeVisible();
    await edit.getByRole("combobox", { name: "Result", exact: true }).selectOption("대기");
    await expect(edit.getByRole("combobox", { name: "Result", exact: true }).locator("option:checked")).toHaveText("Pending");
    await edit.getByLabel("Note", { exact: true }).fill("면접 결과 정정");
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await state(page, "1차면접", "진행중");
    await expect(note("면접 결과 정정")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "면접 결과 정정" }).locator(".chip")).toHaveText("Pending");
    await expect(page.getByRole("button", { name: "Follow Results", exact: true })).toHaveCount(0);
    await details(page).getByRole("button", { name: "Edit", exact: true }).click();
    await details(page).getByRole("combobox", { name: "Stage", exact: true }).selectOption("2차면접");
    await details(page).getByRole("combobox", { name: "Status", exact: true }).selectOption("보류");
    await details(page).getByRole("button", { name: "Save", exact: true }).click();
    await state(page, "2차면접", "보류");
    await storedState(page, "2차면접", "보류");
    await expect(page.getByText("Set by hand.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Delete result: 1st Interview Nov 4, 2026", exact: true }).click();
    await expect(note("면접 결과 정정")).toHaveCount(0);
    await state(page, "2차면접", "보류");
    await statsMatch("보류", "2차면접");
    await page.getByRole("button", { name: "Follow Results", exact: true }).click();
    await state(page, "1차면접", "진행중");
    await expect(page.getByText("Set by hand.", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Follow Results", exact: true })).toHaveCount(0);
    await storedState(page, "1차면접", "진행중");
    await statsMatch("진행중", "1차면접");
  });

  let sessionId = "";
  let snapshot: InterviewContext;
  await test.step("E: link from Track, choose confirmed basis and start free practice", async () => {
    await page.getByRole("button", { name: "Practice for This Application", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Application", exact: true })).toHaveValue(applicationId);
    await page.getByText("More Options", { exact: true }).click();
    await page.getByRole("combobox", { name: "Essay version", exact: true }).selectOption("submitted");
    await expect(page.getByTestId("practice-context-preview")).toContainText("지원 동기 · v1 · Submitted");
    await page.getByRole("checkbox", { name: /^Select question:/ }).first().check();
    await page.getByRole("button", { name: "Start Practice (1)", exact: true }).click();
    await expect(page).toHaveURL(/\/practice\/sessions\/[\w-]+\/run$/);
    sessionId = new URL(page.url()).pathname.split("/")[3];
    // The runner shows the linked application in one line, with no materials card
    await expect(page.getByTestId("runner-application")).toHaveText(`${company} · ${position}`);
    await expect(page.getByRole("heading", { name: "Practice Materials", exact: true })).toHaveCount(0);
    const response = await request.get(`${API}/practice/sessions/${sessionId}`);
    expect(response.ok()).toBeTruthy();
    snapshot = (await response.json()).context_snapshot;
    expect(snapshot.essay_basis).toBe("submitted");
    expect(snapshot.essays).toHaveLength(3);
    expect(snapshot.essays?.find((e) => e.question_text === essays[0].question)).toMatchObject({
      version_no: 1, content: essays[0].answer, selection: "submitted", submission_confirmation: "confirmed",
    });
  });

  await test.step("F: later Track edits and confirmation leave the existing session unchanged", async () => {
    await page.goto(applicationPath);
    await first.getByRole("textbox").fill("연습 시작 뒤 수정한 별도의 내용입니다.");
    await first.getByRole("button", { name: "Save as Submitted", exact: true }).click();
    await expect(first.locator(".version-list button")).toHaveCount(5);
    await expect(first.getByText("Submitted: v5", { exact: true })).toBeVisible();
    await details(page).getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Company", { exact: true }).fill(`${company} 수정`);
    await details(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${company} 수정 · ${position}`, exact: true })).toBeVisible();
    const applicationResponse = await request.get(`${API}/track/applications/${applicationId}`);
    expect(applicationResponse.ok()).toBeTruthy();
    const detail: ApplicationDetail = await applicationResponse.json();
    const item = detail.essay_items.find((e) => e.question_text === essays[0].question)!;
    expect(item.versions).toHaveLength(5);
    expect(item.versions[0].content).toBe(essays[0].answer);
    expect(item.versions[2].content).toBe(essays[0].answer);
    expect(item.versions[2].id).not.toBe(item.versions[0].id);
    expect(item.submitted_version_id).toBe(item.versions[4].id);
    const after = await (await request.get(`${API}/practice/sessions/${sessionId}`)).json();
    expect(after.context_snapshot).toEqual(snapshot!);
    await page.goto(`/practice/sessions/${sessionId}/run`);
    // The runner keeps the company name frozen at start
    await expect(page.getByTestId("runner-application")).toHaveText(`${company} · ${position}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    // The frozen essays are shown with the review
    await page.goto(`/practice/sessions/${sessionId}`);
    await page.getByText("Practice Materials", { exact: true }).click();
    const sources = page.locator(".source-context");
    await expect(sources).toContainText(`${company} · ${position}`);
    await sources.locator("summary").filter({ hasText: essays[0].question }).click();
    await expect(sources.getByText(essays[0].answer, { exact: true })).toBeVisible();
    await expect(sources).not.toContainText("연습 시작 뒤 수정한 별도의 내용입니다.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await testInfo.attach("track-practice-ui-flow.json", { contentType: "application/json", body: JSON.stringify({
      applicationId, sessionId, snapshot: snapshot!, finalSubmittedVersionId: item.submitted_version_id,
      externalServices: "disabled", viewport: testInfo.project.name,
    }, null, 2) });
  });
});
