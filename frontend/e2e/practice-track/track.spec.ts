import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./env";

// 지원 관리 화면의 비동기 흐름(저장 중 입력, 응답 순서, 실패 처리). 화면 크기와 무관해 desktop에서만 돈다
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "흐름 검사: 화면 크기와 무관"));

async function newApp(request: APIRequestContext, company: string) {
  return (await request.post(`${API}/track/applications`, { data: { company, position: "백엔드", job_category: "개발" } })).json();
}

/** 다음 요청이 올 때까지 붙잡아 두는 경로 처리기. release()를 부르면 그때 서버로 보낸다 */
function hold() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { gate, release: () => release() };
}

const details = (page: Page) => page.getByRole("region", { name: "Details", exact: true });
const statusChip = (page: Page) => page.getByTestId("application-status");
const editResult = (page: Page) => page.getByRole("group", { name: "Edit Result", exact: true });

test("the list shows English names while filters send the stored values", async ({ page, request }) => {
  const tok = `목록${Date.now()}`;
  const app = await newApp(request, `${tok} 회사`);
  await request.patch(`${API}/track/applications/${app.id}`, { data: { stage: "1차면접" } });
  await newApp(request, `${tok} 다른회사`);
  await page.goto("/track");
  await expect(page.getByRole("heading", { level: 1, name: "Applications", exact: true })).toBeVisible();
  await page.getByPlaceholder("Search company or role").fill(tok);
  await expect(page.locator("tbody tr")).toHaveCount(2);
  const row = page.getByRole("row").filter({ hasText: `${tok} 회사` });
  await expect(row.getByRole("cell")).toHaveText([`${tok} 회사`, "백엔드", "1st Interview", "In Progress", "", /^[A-Z][a-z]{2} \d{1,2}$/]);
  // The status filter is visible; stage and job are folded under Filters
  const status = page.getByRole("combobox", { name: "Filter by status", exact: true });
  await expect(status.locator("option")).toHaveText(["All Statuses", "In Progress", "Passed", "Rejected", "On Hold"]);
  const stage = page.getByRole("combobox", { name: "Filter by stage", exact: true });
  await expect(stage).toBeHidden();
  await page.getByText("Filters", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Filter by job", exact: true }).locator("option")).toHaveText(
    ["All Jobs", "Engineering", "Product", "Marketing", "Data", "Design", "Other"]);
  const filtered = page.waitForRequest((r) => new URL(r.url()).searchParams.get("stage") === "1차면접");
  await stage.selectOption("1차면접");
  await filtered;
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("summary", { hasText: "Filters" })).toHaveText("Filters (1)");
  await status.selectOption("합격");
  await expect(page.getByText("No applications match.", { exact: true })).toBeVisible();
});

test("typing while a version is saving keeps the newer draft", async ({ page, request }) => {
  const app = await newApp(request, `자소서저장 ${Date.now()}`);
  await request.post(`${API}/track/applications/${app.id}/essays`, { data: { question_text: "지원 동기", content: "첫 버전" } });
  const { gate, release } = hold();
  await page.route("**/track/essays/*/versions", async (route) => { await gate; await route.continue(); });
  await page.goto(`/track/${app.id}`);
  const box = page.getByPlaceholder("Write your answer");
  await box.fill("A");
  const saved = page.waitForResponse((r) => r.url().includes("/versions") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save Version", exact: true }).click();
  await box.fill("AB"); // 저장 응답이 오기 전에 이어서 입력한다
  release();
  await saved;
  await expect(page.locator(".version-list button")).toHaveCount(2);
  await expect(box).toHaveValue("AB");
  await expect(page.getByRole("button", { name: "Save Version", exact: true })).toBeEnabled();
});

test("restoring an old version puts it in the editor", async ({ page, request }) => {
  const app = await newApp(request, `자소서복원 ${Date.now()}`);
  const item = await (await request.post(`${API}/track/applications/${app.id}/essays`, {
    data: { question_text: "지원 동기", content: "첫 버전" } })).json();
  await request.post(`${API}/track/essays/${item.id}/versions`, { data: { content: "둘째 버전" } });
  await page.goto(`/track/${app.id}`);
  await page.locator(".version-list button", { hasText: "v1" }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator(".version-list button")).toHaveCount(3);
  await expect(page.getByPlaceholder("Write your answer")).toHaveValue("첫 버전");
});

test("an older filter response never replaces the newer one", async ({ page, request }) => {
  const tok = `역전${Date.now()}`;
  await newApp(request, `${tok}가`);
  await newApp(request, `${tok}가나다`);
  const isList = (u: URL, q: string) => u.pathname === "/track/applications" && u.searchParams.get("q") === q;
  // 먼저 보낸 검색(tok)의 응답만 늦게 온다
  await page.route((u) => isList(u, tok), async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto("/track");
  const search = page.getByPlaceholder("Search company or role");
  const slow = page.waitForResponse((r) => isList(new URL(r.url()), tok));
  await search.fill(tok);
  await page.waitForRequest((r) => isList(new URL(r.url()), tok));
  await search.fill(`${tok}가나다`);
  await page.waitForResponse((r) => isList(new URL(r.url()), `${tok}가나다`));
  await slow;
  await page.waitForTimeout(100);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(`${tok}가나다`);
});

test("the detail header shows company, role, stage and status in one line", async ({ page, request }) => {
  const app = await newApp(request, `머리글 ${Date.now()}`);
  await request.patch(`${API}/track/applications/${app.id}`, { data: { stage: "2차면접", status: "보류" } });
  await page.goto(`/track/${app.id}`);
  const head = page.locator(".app-head");
  await expect(head.getByRole("heading", { level: 1 })).toHaveText(`${app.company} · 백엔드`);
  await expect(head.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "ko");
  await expect(head.getByTestId("application-stage")).toHaveText("2nd Interview");
  await expect(head.getByTestId("application-status")).toHaveText("On Hold");
  await expect(page.getByRole("button", { name: "Practice for This Application", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Details", "Stages", "Essays"]);
  // Details are read first; the form opens with Edit and closes with Cancel
  await expect(details(page).getByRole("textbox")).toHaveCount(0);
  await expect(details(page)).toContainText("Engineering");
  await details(page).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(details(page).getByRole("combobox", { name: "Stage", exact: true })).toHaveValue("2차면접");
  await expect(details(page).getByRole("combobox", { name: "Stage", exact: true }).locator("option:checked")).toHaveText("2nd Interview");
  await details(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(details(page).getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("No results yet.", { exact: true })).toBeVisible();
});

test("a failed change shows the server message and preserves the unsaved draft", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const app = await newApp(request, `실패처리 ${Date.now()}`);
  await page.route(`**/track/applications/${app.id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Couldn't save (test)." }) })
    : route.continue());
  await page.goto(`/track/${app.id}`);
  await details(page).getByRole("button", { name: "Edit", exact: true }).click();
  const status = details(page).getByRole("combobox", { name: "Status", exact: true });
  await status.selectOption("보류");
  await expect(status.locator("option:checked")).toHaveText("On Hold");
  await details(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(details(page).getByRole("alert")).toHaveText("Couldn't save (test).");
  await expect(status).toHaveValue("보류");
  await expect(statusChip(page)).toHaveText("In Progress");
  // 페이지 전체가 오류 화면으로 바뀌지 않고 계속 쓸 수 있다
  await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("parallel saves keep all three essay responses", async ({ page, request }) => {
  const app = await newApp(request, `동시문항 ${Date.now()}`);
  for (const question of ["지원 동기", "협업 경험", "성장 과정"]) {
    await request.post(`${API}/track/applications/${app.id}/essays`, { data: { question_text: question, content: "첫 버전" } });
  }
  const one = hold(); const two = hold();
  let count = 0;
  await page.route("**/track/essays/*/versions", async (route) => { const n = ++count; await (n === 1 ? one.gate : two.gate); await route.continue(); });
  await page.goto(`/track/${app.id}`);
  const boxes = page.getByPlaceholder("Write your answer");
  await boxes.nth(0).fill("첫 문항 수정");
  await boxes.nth(1).fill("둘째 문항 수정");
  await page.getByRole("button", { name: "Save Version", exact: true }).nth(0).click();
  await page.getByRole("button", { name: "Save Version", exact: true }).nth(1).click();
  two.release();
  await expect(page.locator(".version-list").nth(1).getByRole("button")).toHaveCount(2);
  one.release();
  await expect(page.locator(".version-list").nth(0).getByRole("button")).toHaveCount(2);
  await expect(page.locator(".version-list").nth(1).getByRole("button")).toHaveCount(2);
  await expect(boxes.nth(2)).toHaveValue("첫 버전");
});

test("basic info uses explicit save and preserves the draft on failure", async ({ page, request }) => {
  const app = await newApp(request, `정보초안 ${Date.now()}`);
  let patches = 0;
  await page.route(`**/track/applications/${app.id}`, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patches++;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Couldn't save the details." }) });
  });
  await page.goto(`/track/${app.id}`);
  await details(page).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Company", { exact: true }).fill("계속 작성할 회사명");
  await page.getByLabel("Role", { exact: true }).click();
  expect(patches).toBe(0);
  await details(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn't save the details.");
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue("계속 작성할 회사명");
});

test("old version submission is explicit and restore creates a draft", async ({ page, request }) => {
  const app = await newApp(request, `제출확인 ${Date.now()}`);
  const item = await (await request.post(`${API}/track/applications/${app.id}/essays`, { data: { question_text: "지원 동기", content: "실제 제출한 내용" } })).json();
  await request.post(`${API}/track/essays/${item.id}/versions`, { data: { content: "작성 중인 내용" } });
  await page.goto(`/track/${app.id}`);
  await page.locator(".version-list button", { hasText: "v1" }).click();
  await page.getByRole("button", { name: "Mark as Submitted", exact: true }).click();
  await expect(page.getByText("Submitted: v1", { exact: true })).toBeVisible();
  await page.locator(".version-list button", { hasText: "v1" }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator(".version-list button")).toHaveCount(3);
  await expect(page.getByText("Submitted: v1", { exact: true })).toBeVisible();
});

test("event editing and deletion keep manual state until explicit recalculation", async ({ page, request }) => {
  const app = await newApp(request, `전형편집 ${Date.now()}`);
  await request.post(`${API}/track/applications/${app.id}/events`, { data: { stage: "서류", result: "합격", event_date: "2026-11-01", memo: "처음 기록" } });
  await request.patch(`${API}/track/applications/${app.id}`, { data: { stage: "1차면접", status: "보류" } });
  await page.goto(`/track/${app.id}`);
  await expect(page.getByText("Set by hand.", { exact: false })).toBeVisible();
  // A result's buttons never share a name prefix with the whole-application Delete Application (서류 is "Application")
  await expect(page.getByRole("button", { name: "Delete Application" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Delete Application" })).toHaveText("Delete Application");
  await page.getByRole("button", { name: "Edit result: Application Nov 1, 2026", exact: true }).click();
  await editResult(page).getByLabel("Note", { exact: true }).fill("내용 수정");
  await editResult(page).getByRole("combobox", { name: "Result", exact: true }).selectOption("불합격");
  await editResult(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("내용 수정", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "내용 수정" }).locator(".chip")).toHaveText("Rejected");
  await expect(statusChip(page)).toHaveText("On Hold");
  await page.getByRole("button", { name: "Follow Results", exact: true }).click();
  await expect(statusChip(page)).toHaveText("Rejected");
  await expect(page.getByRole("button", { name: "Follow Results", exact: true })).toHaveCount(0);
  await details(page).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(details(page).getByRole("combobox", { name: "Status", exact: true })).toHaveValue("불합격");
  await page.getByRole("button", { name: "Delete result: Application Nov 1, 2026", exact: true }).click();
  await expect(statusChip(page)).toHaveText("In Progress");
});

test("detail ignores an older id response after client navigation", async ({ page, request }) => {
  const first = await newApp(request, `오래된상세 ${Date.now()}`);
  const second = await newApp(request, `새상세 ${Date.now()}`);
  const delayed = hold();
  await page.route(`**/track/applications/${first.id}`, async (route) => { await delayed.gate; await route.continue(); });
  // 팀 셸은 화면을 lazy 로딩하므로, 이전 id 요청이 실제로 나간 뒤에 이동해야 경합을 재현한다
  const firstRequested = page.waitForRequest((r) => r.url().endsWith(`/track/applications/${first.id}`));
  await page.goto(`/track/${first.id}`);
  await firstRequested;
  await page.evaluate((nextId) => {
    history.pushState({}, '', `/track/${nextId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, second.id);
  await expect(page.getByRole('heading', { name: `${second.company} · 백엔드` })).toBeVisible();
  const firstResponded = page.waitForResponse((r) => r.url().endsWith(`/track/applications/${first.id}`));
  delayed.release();
  await firstResponded;
  await expect(page.getByRole('heading', { name: `${second.company} · 백엔드` })).toBeVisible();
});

for (const action of ["basic info", "event", "reload"] as const) {
  for (const essayChange of ["version", "submission"] as const) {
    test(`late ${action} detail keeps newer essay ${essayChange}`, async ({ page, request }) => {
      const app = await newApp(request, `상세경합 ${Date.now()}`);
      const item = await (await request.post(`${API}/track/applications/${app.id}/essays`, { data: { question_text: "지원 동기", content: "같은 답변" } })).json();
      if (essayChange === "submission") {
        const next = await (await request.post(`${API}/track/essays/${item.id}/versions`, { data: { content: "다른 초안" } })).json();
        await request.post(`${API}/track/versions/${next.versions[1].id}/submit`);
      }
      let eventId = "";
      if (action === "reload") {
        const detail = await (await request.post(`${API}/track/applications/${app.id}/events`, { data: { stage: "서류", result: "대기", event_date: "2026-11-01" } })).json();
        eventId = detail.events[0].id;
      }
      await page.goto(`/track/${app.id}`);
      await expect(page.getByRole("heading", { name: `${app.company} · 백엔드` })).toBeVisible();
      const delayed = hold();
      let captured!: () => void;
      const capturedResponse = new Promise<void>((resolve) => { captured = resolve; });
      const path = action === "basic info" ? `/track/applications/${app.id}` : action === "event" ? `/track/applications/${app.id}/events` : `/track/applications/${app.id}`;
      const method = action === "basic info" ? "PATCH" : action === "event" ? "POST" : "GET";
      await page.route((url) => url.port === "8011" && url.pathname === path, async (route) => {
        if (route.request().method() !== method) return route.continue();
        const response = await route.fetch();
        const body = await response.body();
        captured();
        await delayed.gate;
        await route.fulfill({ response, body });
      });
      if (action === "basic info") {
        await details(page).getByRole("button", { name: "Edit", exact: true }).click();
        await page.getByLabel("Company", { exact: true }).fill(`${app.company} 수정`);
        await details(page).getByRole("button", { name: "Save", exact: true }).click();
      } else if (action === "event") {
        await page.getByRole("button", { name: "Add Result", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Edit result: Application Nov 1, 2026", exact: true }).click();
        await editResult(page).getByLabel("Note", { exact: true }).fill(`수정 ${eventId}`);
        await editResult(page).getByRole("button", { name: "Save", exact: true }).click();
      }
      await capturedResponse;
      if (essayChange === "version") {
        await page.getByPlaceholder("Write your answer").fill("더 최신인 답변");
        await page.getByRole("button", { name: "Save Version", exact: true }).click();
        await expect(page.locator(".version-list button")).toHaveCount(2);
      } else {
        await page.locator(".version-list button", { hasText: "v1" }).click();
        await page.getByRole("button", { name: "Mark as Submitted", exact: true }).click();
        await expect(page.getByText("Submitted: v1", { exact: true })).toBeVisible();
      }
      const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === method);
      delayed.release();
      await lateResponse;
      if (action === "basic info") await expect(page.getByRole("heading", { name: `${app.company} 수정 · 백엔드` })).toBeVisible();
      if (essayChange === "version") {
        await expect(page.locator(".version-list button")).toHaveCount(2);
        await expect(page.getByPlaceholder("Write your answer")).toHaveValue("더 최신인 답변");
      } else {
        await expect(page.getByText("Submitted: v1", { exact: true })).toBeVisible();
        await expect(page.locator(".version-list button")).toHaveCount(2);
      }
    });
  }
}

test("manually edited legacy application still asks for its unknown event baseline", async ({ page, request }) => {
  const app = await newApp(request, `레거시기준 ${Date.now()}`);
  let detail = { ...app, state_source: "legacy", state_requires_baseline: true, essay_items: [], events: [] };
  await page.route((url) => url.port === "8011" && url.pathname === `/track/applications/${app.id}`, async (route) => {
    if (route.request().method() === "PATCH") detail = { ...detail, ...route.request().postDataJSON(), state_source: "manual" };
    await route.fulfill({ json: detail });
  });
  let resetBody: Record<string, string> | undefined;
  await page.route(`**/track/applications/${app.id}/state-from-events`, async (route) => {
    resetBody = route.request().postDataJSON();
    if (!resetBody?.baseline_stage || !resetBody?.baseline_status) return route.fulfill({ status: 422, json: { detail: "Pick the stage and status before these results." } });
    detail = { ...detail, stage: resetBody.baseline_stage, status: resetBody.baseline_status, state_source: "events", state_requires_baseline: false };
    await route.fulfill({ json: detail });
  });
  await page.goto(`/track/${app.id}`);
  await expect(page.getByText("Kept from older data.", { exact: false })).toBeVisible();
  await details(page).getByRole("button", { name: "Edit", exact: true }).click();
  await details(page).getByRole("combobox", { name: "Status", exact: true }).selectOption("보류");
  await details(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(statusChip(page)).toHaveText("On Hold");
  await expect(page.getByText("Set by hand.", { exact: false })).toBeVisible();
  const baselineStage = page.getByRole("combobox", { name: "Stage before these results", exact: true });
  await expect(baselineStage).toBeVisible();
  await expect(baselineStage.locator("option")).toHaveText(["Application", "Aptitude Test", "1st Interview", "2nd Interview", "Final"]);
  await baselineStage.selectOption("인적성");
  await page.getByRole("combobox", { name: "Status before these results", exact: true }).selectOption("진행중");
  await page.getByRole("button", { name: "Follow Results", exact: true }).click();
  await expect(statusChip(page)).toHaveText("In Progress");
  expect(resetBody).toEqual({ baseline_stage: "인적성", baseline_status: "진행중" });
});
