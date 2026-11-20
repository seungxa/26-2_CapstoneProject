import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./env";

// 카드 제목의 부모 section. 면접 화면에서는 동의 카드가 질문 카드 안에 들어 있다
const card = (page: Page, title: string) => page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::section[1]");

// 녹음 동의·원본 보관·전체 삭제·동의 철회를 Settings 화면에서 한다. 다른 테스트처럼 동의 없는 상태에서 시작하고 끝낸다
const withdraw = (request: APIRequestContext) => request.put(`${API}/practice/settings`, { data: { consent: false, keep_audio: false } });
test.beforeEach(async ({ request }) => { await withdraw(request); });
test.afterEach(async ({ request }) => { await withdraw(request); });

test("settings keeps recording consent, audio keeping, and deletion in two short sections", async ({ page, request }) => {
  await page.goto("/practice/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
  const content = page.locator(".pt-content");
  await expect(content).not.toContainText("OpenAI");
  await expect(content.getByText(/real interview/)).toHaveCount(1); // 연습 전용 안내는 한 번만

  // 동의 전: 짧은 동의 카드와 Agree. 이 화면 자신을 가리키는 Details 링크는 없다
  const consent = card(page, "Before You Record");
  await expect(consent).toContainText("saved on our server"); // transcription is off in the e2e server, so no transcript promise
  await expect(consent).not.toContainText(/transcri/i);
  await expect(consent.getByRole("link", { name: "Details" })).toHaveCount(0);
  const keep = page.getByRole("checkbox", { name: "Keep original audio for 30 days", exact: true });
  await expect(keep).toHaveCount(1); // 보관 체크는 한 곳에만
  await keep.check();
  const agreed = page.waitForResponse((r) => r.url().endsWith("/practice/settings") && r.request().method() === "PUT");
  await consent.getByRole("button", { name: "Agree", exact: true }).click();
  expect((await agreed).request().postDataJSON()).toEqual({ consent: true, keep_audio: true });

  // 동의 뒤: Recordings에 보관 토글과 삭제, Privacy는 두 줄
  await expect(page.getByRole("heading", { name: "Before You Record" })).toHaveCount(0);
  const recordings = card(page, "Recordings");
  const toggle = recordings.getByRole("checkbox", { name: "Keep original audio for 30 days", exact: true });
  await expect(toggle).toBeChecked();
  const privacy = card(page, "Privacy");
  await expect(privacy.locator(":scope > p")).toHaveText([
    "Your voice is saved on our server and isn't sent to other services.",
    "Camera video never leaves your device.",
  ]);
  await expect(privacy.locator("details")).not.toHaveAttribute("open");

  const toggled = page.waitForResponse((r) => r.url().endsWith("/practice/settings") && r.request().method() === "PUT");
  await toggle.click(); // 서버가 저장한 값을 보여 주므로 응답 뒤에 풀린다
  expect((await toggled).request().postDataJSON()).toEqual({ keep_audio: false });
  await expect(toggle).not.toBeChecked();
  expect((await (await request.get(`${API}/practice/settings`)).json()).keep_audio).toBe(false);

  page.once("dialog", (d) => d.accept());
  await recordings.getByRole("button", { name: "Delete All Recordings", exact: true }).click();
  await expect(page.getByText(/^(No recordings to delete\.|Deleted \d+ recordings?\.)/)).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await recordings.getByRole("button", { name: "Withdraw Consent", exact: true }).click();
  await expect(page.getByText(/^Consent withdrawn\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Agree", exact: true })).toBeVisible();
  expect((await (await request.get(`${API}/practice/settings`)).json()).consented_at).toBeNull();
  await expect(content).not.toContainText(/[가-힣]/);
});

test("the interview consent card is three short lines with a Details link", async ({ page, request }) => {
  const q = await (await request.post(`${API}/practice/questions`, { data: { category: "인성", text: `동의 카드 질문 ${Date.now()}` } })).json();
  const session = await (await request.post(`${API}/practice/sessions`, { data: { mode: "free", question_ids: [q.id], prep_sec: 0, answer_sec: 30 } })).json();
  await page.goto(`/practice/sessions/${session.id}/run`);
  const consent = card(page, "Before You Record");
  await expect(consent.locator("li")).toHaveCount(3);
  await expect(consent).not.toContainText(/OpenAI|[가-힣]/);
  await expect(consent.getByRole("checkbox", { name: "Keep original audio for 30 days", exact: true })).not.toBeChecked();
  await expect(consent.getByRole("button", { name: "Agree & Start", exact: true })).toBeVisible();
  // Details는 새 탭으로 연다: 저장을 기다리는 녹음이 있어도 면접 화면을 떠나지 않는다
  const details = consent.getByRole("link", { name: "Details", exact: true });
  await expect(details).toHaveAttribute("href", "/practice/settings");
  const opened = page.waitForEvent("popup");
  await details.click();
  const settings = await opened;
  await expect(settings.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/practice/sessions/${session.id}/run$`));
  await settings.close();
});

const health = (available: boolean) => ({ ok: true, auth_disabled: true,
  stt: { provider: available ? "local" : "off", available, model: null, state: available ? "ready" : null, error: null } });

test("settings never promises transcription until /health confirms it", async ({ page }) => {
  const promise = /transcribed on our server|after transcription|couldn't be transcribed/i; // the promise; "Transcripts stay in your history" is fine
  // /health unreadable: neutral
  await page.route("**/health", (route) => route.fulfill({ status: 503, json: { detail: "down" } }));
  await page.goto("/practice/settings");
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".pt-content")).not.toContainText(promise);
  await page.unroute("**/health");

  // Held while loading: neutral, then it may promise once confirmed
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route("**/health", async (route) => { await held; await route.fulfill({ json: health(true) }); });
  await page.goto("/practice/settings");
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(page.locator(".pt-content")).not.toContainText(promise);
  release();
  await expect(card(page, "Before You Record")).toContainText("transcribed on our server");
  await expect(card(page, "Privacy")).toContainText("Your voice is transcribed on our server");
});

test("Retry Transcription is not offered when transcription is off", async ({ page, request }) => {
  const q = await (await request.post(`${API}/practice/questions`, { data: { category: "인성", text: `전사 꺼짐 질문 ${Date.now()}` } })).json();
  const session = await (await request.post(`${API}/practice/sessions`, { data: { mode: "free", question_ids: [q.id], prep_sec: 0, answer_sec: 30 } })).json();
  expect((await (await request.get(`${API}/health`)).json()).stt.available).toBe(false); // STT_PROVIDER=off
  await request.put(`${API}/practice/settings`, { data: { consent: true } });
  const up = await request.post(`${API}/practice/answers/${session.answers[0].id}/audio`, {
    multipart: { file: { name: "rec.webm", mimeType: "audio/webm", buffer: Buffer.from("not-real-audio") }, duration_sec: "5" },
  });
  expect(up.ok()).toBe(true); // saved without a transcript: the case that used to offer Retry Transcription
  await page.goto(`/practice/sessions/${session.id}/run`);
  await expect(page.getByText("This recording wasn't transcribed. Type your answer below.")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Retry Transcription" })).toHaveCount(0);
  await page.goto(`/practice/sessions/${session.id}`);
  await expect(page.getByText(/This recording wasn't transcribed\./).first()).toBeAttached(); // inside a folded answer card
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Retry Transcription" })).toHaveCount(0);
  await expect(page.getByText(/Retry, or type/)).toHaveCount(0);
  await request.put(`${API}/practice/settings`, { data: { consent: false } });
});
