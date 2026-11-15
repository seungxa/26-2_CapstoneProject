import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { API, BROWSER_API } from "./env";

// The interview runner: answer, then move on. One question, a timer and one primary action, and the recording
// consent card only the first time. The e2e backend runs with STT_PROVIDER=off, so transcription is off here.

async function seed(request: APIRequestContext, count: number, extra: Record<string, unknown> = {}) {
  const suffix = `${test.info().project.name}-${Date.now()}-${Math.random()}`;
  const questions: { id: string; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    questions.push(await (await request.post(`${API}/practice/questions`, { data: { category: "인성", text: `진행 화면 질문 ${i + 1} ${suffix}` } })).json());
  }
  const session = await (await request.post(`${API}/practice/sessions`, { data: {
    mode: "free", question_ids: questions.map((q) => q.id), prep_sec: 0, answer_sec: 30, ...extra,
  } })).json();
  return { session, questions };
}

const primary = (page: Page) => page.locator(".practice-track button.primary");
const startAnswer = (page: Page) => page.getByRole("button", { name: "Start Answer", exact: true });
const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const consentCard = (page: Page) => page.getByRole("heading", { name: "Before You Record", exact: true }).locator("xpath=ancestor::section[1]");
const box = async (locator: Locator) => (await locator.boundingBox())!;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Hangul in screen text or attributes outside lang="ko" (Korean interview content must be marked). */
const koreanOutsideKo = (page: Page) => page.locator(".practice-track").evaluate((root) => {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/[가-힣]/.test(node.textContent ?? "") && !node.parentElement?.closest('[lang="ko"]')) found.push(node.textContent ?? "");
  }
  for (const element of root.querySelectorAll("[placeholder], [aria-label], [title]")) {
    for (const name of ["placeholder", "aria-label", "title"]) {
      const value = element.getAttribute(name) ?? "";
      if (/[가-힣]/.test(value)) found.push(value);
    }
  }
  return found;
});

test("the runner shows one question, a timer and one primary action, then the next step", async ({ page, request }) => {
  await request.put(`${API}/practice/settings`, { data: { consent: true } });
  const app = await (await request.post(`${API}/track/applications`, { data: { company: "진행 회사", position: "백엔드 개발자" } })).json();
  const { session, questions } = await seed(request, 2, { application_id: app.id, followups_enabled: true });
  await page.goto(`/practice/sessions/${session.id}/run`);

  // Header: Question n of N and End Practice on one line. A phone is too narrow for both at 30px, so there
  // End Practice wraps right under the heading and stays at the right edge
  const title = heading(page, "Question 1 of 2");
  const end = page.getByRole("button", { name: "End Practice", exact: true });
  await expect(title).toBeVisible();
  await expect(end).toBeVisible();
  const [t, e] = [await box(title), await box(end)];
  if (page.viewportSize()!.width >= 720) {
    expect(e.y).toBeLessThan(t.y + t.height);
    expect(e.y + e.height).toBeGreaterThan(t.y);
  } else {
    expect(e.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
    expect(e.y - (t.y + t.height)).toBeLessThan(24);
    const header = await box(page.locator(".runner-head"));
    expect(Math.abs(e.x + e.width - (header.x + header.width))).toBeLessThan(2);
  }
  // The linked application is one line under the header. The materials card is gone
  const linked = page.getByTestId("runner-application");
  await expect(linked).toHaveText("진행 회사 · 백엔드 개발자");
  await expect(linked).toHaveAttribute("lang", "ko");
  expect((await box(linked)).y).toBeGreaterThan(Math.max(t.y, e.y));
  await expect(page.getByRole("heading", { name: "Practice Materials" })).toHaveCount(0);
  await expect(page.getByTestId("runner-focus")).toHaveCount(0); // only re-drill sessions name a focus

  // The question (Korean content), the timer, then the one primary button
  const question = page.locator(".runner-q");
  await expect(question).toHaveText(questions[0].text);
  await expect(question).toHaveAttribute("lang", "ko");
  const timer = page.locator(".timer");
  await expect(timer).toBeVisible();
  await expect(primary(page)).toHaveCount(1);
  await expect(primary(page)).toHaveText("Start Answer");
  expect((await box(question)).y).toBeLessThan((await box(timer)).y);
  expect((await box(timer)).y).toBeLessThan((await box(startAnswer(page))).y);
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeVisible();
  // Under it: Record or Type, and the camera toggle
  const record = page.getByRole("radio", { name: "Record", exact: true });
  const type = page.getByRole("radio", { name: "Type", exact: true });
  await expect(record).toBeChecked();
  await expect(type).not.toBeChecked();
  const camera = page.getByRole("button", { name: "Turn On Camera", exact: true });
  const below = (await box(startAnswer(page))).y;
  expect((await box(record)).y).toBeGreaterThan(below);
  expect((await box(camera)).y).toBeGreaterThan(below);
  expect(await koreanOutsideKo(page)).toEqual([]);
  expect(await noHorizontalScroll(page)).toBe(true);

  // Answer by typing, then edit the answer and move on
  await type.check();
  await startAnswer(page).click();
  await expect(primary(page)).toHaveText("Finish Answer");
  await page.getByLabel("Your answer", { exact: true }).fill("제가 일정을 나누고 매일 공유했습니다.");
  await page.getByRole("button", { name: "Finish Answer", exact: true }).click();
  const answer = page.getByLabel("Your answer", { exact: true });
  await expect(answer).toHaveValue("제가 일정을 나누고 매일 공유했습니다.");
  await expect(answer).toBeEditable();
  await expect(primary(page)).toHaveCount(1);
  await expect(primary(page)).toHaveText("Next Question");
  const followup = page.getByRole("button", { name: "Ask a Follow-up", exact: true });
  await expect(followup).toBeEnabled();
  expect((await box(primary(page))).x).toBeLessThan((await box(followup)).x);
  expect(await koreanOutsideKo(page)).toEqual([]);
  expect(await noHorizontalScroll(page)).toBe(true);

  await primary(page).click();
  await expect(heading(page, "Question 2 of 2")).toBeVisible();
  await expect(question).toHaveText(questions[1].text);
  await expect(primary(page)).toHaveText("Start Answer");
});

test("consent card appears once", async ({ page, request }) => {
  await request.put(`${API}/practice/settings`, { data: { consent: false } });
  const { session } = await seed(request, 2);
  try {
    await page.goto(`/practice/sessions/${session.id}/run`);
    const consent = consentCard(page);
    await expect(consent).toBeVisible();
    // No linked application, so no application line
    await expect(page.getByTestId("runner-application")).toHaveCount(0);
    // The card sits under the main button, which waits for consent while Record is chosen
    await expect(startAnswer(page)).toBeDisabled();
    expect((await box(consent)).y).toBeGreaterThan((await box(startAnswer(page))).y);
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText("Agree & Start");
    // Transcription is off on this server, so the card must not promise it
    await expect(consent.locator("li")).toHaveCount(3);
    await expect(consent).not.toContainText(/transcri/i);
    await expect(consent).toContainText("deleted within 30 days");
    // Details opens a new tab and says so to screen readers
    const details = consent.getByRole("link", { name: "Details", exact: true });
    await expect(details).toHaveAttribute("target", "_blank");
    await expect(details).toHaveAccessibleDescription("Opens in a new tab");

    // Typing needs no consent
    await page.getByRole("radio", { name: "Type", exact: true }).check();
    await expect(page.getByRole("heading", { name: "Before You Record" })).toHaveCount(0);
    await expect(startAnswer(page)).toBeEnabled();
    await page.getByRole("radio", { name: "Record", exact: true }).check();

    await consent.getByRole("button", { name: "Agree & Start", exact: true }).click();
    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Finish Answer", exact: true }).click();
    await page.getByRole("button", { name: "Next Question", exact: true }).click();
    await expect(heading(page, "Question 2 of 2")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before You Record" })).toHaveCount(0);
    await expect(startAnswer(page)).toBeEnabled();
    await expect(primary(page)).toHaveText("Start Answer");
    // Saved on the server: a reload doesn't ask again
    await page.reload();
    await expect(heading(page, "Question 2 of 2")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before You Record" })).toHaveCount(0);
  } finally {
    await request.put(`${API}/practice/settings`, { data: { consent: false } });
  }
});

test("transcription off shows an inline notice", async ({ page, request }) => {
  await request.put(`${API}/practice/settings`, { data: { consent: true } });
  expect((await (await request.get(`${API}/health`)).json()).stt.available).toBe(false); // STT_PROVIDER=off
  const { session } = await seed(request, 1);
  await page.goto(`/practice/sessions/${session.id}/run`);
  await page.waitForLoadState("networkidle");
  const notice = page.getByText(/^Transcription is off\./);
  await expect(notice).toHaveCount(1);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Type");
  // Right under the record button, not in a status line on top of the page
  const [button, line] = [await box(startAnswer(page)), await box(notice)];
  expect(line.y).toBeGreaterThanOrEqual(button.y + button.height - 1);
  expect(line.y - (button.y + button.height)).toBeLessThan(48);
  await expect(page.locator(".practice-track > *")).toHaveCount(2); // the menu and the page, nothing above the page
  expect(line.y).toBeGreaterThan((await box(heading(page, "Question 1 of 1"))).y);
  // It is about recording: choosing Type removes it
  await page.getByRole("radio", { name: "Type", exact: true }).check();
  await expect(notice).toHaveCount(0);
  await page.getByRole("radio", { name: "Record", exact: true }).check();
  await expect(notice).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("a re-drill session names what to work on for the current question", async ({ page, request }) => {
  await request.put(`${API}/practice/settings`, { data: { consent: true } });
  const { session, questions } = await seed(request, 2);
  // A self-rating of 1–2 picks the answer for re-drill; the other answer is not picked
  await request.patch(`${API}/practice/answers/${session.answers[0].id}`, { data: { transcript: "제가 맡은 일을 끝냈습니다.", self_rating: 2 } });
  await request.patch(`${API}/practice/answers/${session.answers[1].id}`, { data: { transcript: "역할을 나눴습니다.", self_rating: 5 } });
  await request.post(`${API}/practice/sessions/${session.id}/finish`);
  const drill = await (await request.post(`${API}/practice/sessions/${session.id}/redrill`)).json();
  const target = drill.context_snapshot.drill_targets[0];
  expect(target.question_id).toBe(questions[0].id);
  await page.goto(`/practice/sessions/${drill.id}/run`);
  await expect(heading(page, "Question 1 of 1")).toBeVisible();
  const focus = page.getByTestId("runner-focus");
  await expect(focus).toHaveText(`Work on: ${target.next_action}`);
  await expect(focus).toHaveClass(/muted/);
  // Right under the header (no application here), above the question card
  expect((await box(focus)).y).toBeGreaterThan((await box(heading(page, "Question 1 of 1"))).y);
  expect((await box(focus)).y).toBeLessThan((await box(page.locator(".runner-q"))).y);
  expect(await koreanOutsideKo(page)).toEqual([]);
  expect(await noHorizontalScroll(page)).toBe(true);
});

const PROMISE = /transcribed on our server/;
const health = (available: boolean) => ({ ok: true, auth_disabled: true,
  stt: { provider: available ? "local" : "off", available, model: null, state: available ? "ready" : null, error: null } });

test("consent never promises transcription until the server confirms it", async ({ page, request }) => {
  await request.put(`${API}/practice/settings`, { data: { consent: false } });
  const { session } = await seed(request, 1);
  // Record whether the promise was ever on screen, even for one frame
  await page.addInitScript((source) => {
    const promise = new RegExp(source);
    const w = window as unknown as { __promised: boolean };
    w.__promised = false;
    new MutationObserver(() => { if (promise.test(document.body?.innerText ?? "")) w.__promised = true; })
      .observe(document, { subtree: true, childList: true, characterData: true });
  }, PROMISE.source);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`${BROWSER_API}/health`, async (route) => { await held; await route.fulfill({ json: health(true) }); });
  try {
    await page.goto(`/practice/sessions/${session.id}/run`);
    const consent = consentCard(page);
    await expect(consent).toBeVisible();
    await expect(consent.locator("li")).toHaveCount(3);
    await expect(consent).toContainText("deleted within 30 days");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __promised: boolean }).__promised)).toBe(false);
    // Once the server confirms transcription, the card may say so
    release();
    await expect(consent).toContainText(PROMISE);
    await expect(consent).toContainText("deleted after transcription unless you keep it");
  } finally {
    release();
    await request.put(`${API}/practice/settings`, { data: { consent: false } });
  }
});

test("consent stays neutral and usable when the server status can't be read", async ({ page, request }) => {
  await request.put(`${API}/practice/settings`, { data: { consent: false } });
  const { session } = await seed(request, 1);
  await page.route(`${BROWSER_API}/health`, (route) => route.fulfill({ status: 503, json: { detail: "down" } }));
  try {
    await page.goto(`/practice/sessions/${session.id}/run`);
    const consent = consentCard(page);
    await expect(consent).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(consent).not.toContainText(/transcri/i);
    await expect(consent).toContainText("deleted within 30 days");
    await consent.getByRole("button", { name: "Agree & Start", exact: true }).click();
    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    expect((await (await request.get(`${API}/practice/settings`)).json()).consented_at).toBeTruthy();
  } finally {
    await request.put(`${API}/practice/settings`, { data: { consent: false } });
  }
});

test("End Practice finishes the practice, after a confirm when questions are left", async ({ page, request }) => {
  const { session } = await seed(request, 3);
  await page.goto(`/practice/sessions/${session.id}/run`);
  const end = page.getByRole("button", { name: "End Practice", exact: true });
  await page.getByRole("radio", { name: "Type", exact: true }).check();
  await startAnswer(page).click();
  // Blocked while an answer is in progress (as while saving): finish the answer first
  await expect(end).toBeDisabled();
  await page.getByLabel("Your answer", { exact: true }).fill("팀 프로젝트에서 일정 관리를 맡아 마감 기한을 지켰습니다.");
  await page.getByRole("button", { name: "Finish Answer" }).click();
  await expect(end).toBeEnabled();

  // Cancel: still in the runner on the same question, and the practice stays open
  const asked: string[] = [];
  page.once("dialog", (d) => { asked.push(d.message()); void d.dismiss(); });
  await end.click();
  await expect.poll(() => asked).toEqual(["End practice now? 2 unanswered questions will be skipped. You can't continue this practice later."]);
  await expect(page).toHaveURL(/\/run$/);
  await expect(heading(page, "Question 1 of 3")).toBeVisible();
  expect((await (await request.get(`${API}/practice/sessions/${session.id}`)).json()).finished_at).toBeNull();

  // Confirm: the practice is finished and the review opens with the answered question checked
  page.once("dialog", (d) => void d.accept());
  await end.click();
  await expect(page).toHaveURL(new RegExp(`/practice/sessions/${session.id}$`));
  expect((await (await request.get(`${API}/practice/sessions/${session.id}`)).json()).finished_at).toBeTruthy();
  await expect(page.getByRole("link", { name: /^(Continue|Finish) Practice/ })).toHaveCount(0);
  const card = page.locator("details.answer-card").first();
  await card.locator(":scope > summary").click();
  await expect(card.locator(".coaching-panel")).toBeVisible({ timeout: 15000 });
  await page.goto("/practice/history");
  const row = page.getByRole("row").filter({ has: page.locator(`a[href="/practice/sessions/${session.id}"]`) });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("In Progress", { exact: true })).toHaveCount(0);
});
