import { expect, test, type APIRequestContext } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { API, DEV_USER_ID, docScreenshotPath, recordingsDir } from "./env";

async function seed(request: APIRequestContext, mode: "free" | "mock" = "free") {
  // 녹음 동의가 없는 상태에서 시작한다(글 답변은 동의 없이, 녹음은 동의 패널을 거쳐야 한다)
  await request.put(`${API}/practice/settings`, { data: { consent: false } });
  const suffix = `${Date.now()}-${Math.random()}`;
  const app = await (await request.post(`${API}/track/applications`, { data: {
    company: "검증용 소프트웨어", position: "백엔드 개발자", job_category: "개발",
  } })).json();
  const item = await (await request.post(`${API}/track/applications/${app.id}/essays`, { data: {
    question_text: "성과 경험", content: `성능 개선 프로젝트 ${suffix.slice(-5)}에서 캐시를 도입하여 응답 시간을 40% 개선했습니다.`,
  } })).json();
  await request.post(`${API}/track/essays/${item.id}/versions`, { data: { content: item.versions[0].content, is_submitted: true } });
  await request.post(`${API}/track/essays/${item.id}/versions`, { data: { content: "다른 프로젝트에서 70% 개선했습니다." } });
  const q = await (await request.post(`${API}/practice/questions`, { data: { category: "직무", text: "성과를 어떻게 측정하셨나요?" } })).json();
  const session = await (await request.post(`${API}/practice/sessions`, { data: {
    mode, application_id: app.id, question_ids: [q.id], followups_enabled: true,
    prep_sec: 0, answer_sec: 10, job_description: "API 성능 측정과 캐시 운영 경험",
  } })).json();
  return { app, session };
}

test("submitted source → text answer → follow-up → evidence review → focused re-drill", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { app } = await seed(request);
  await page.goto(`/practice?application=${app.id}`);
  await expect(page.getByRole("combobox", { name: "Application", exact: true })).toHaveValue(app.id);
  await page.getByText("Generate Questions from an Essay", { exact: true }).click();
  const generate = page.locator("details").filter({ has: page.getByText("Generate Questions from an Essay", { exact: true }) });
  await generate.getByRole("spinbutton").fill("1");
  await generate.getByRole("button", { name: "Generate Questions", exact: true }).click();
  await page.getByRole("button", { name: "Start Practice (1)", exact: true }).click();
  // The runner names the linked application in one line. The frozen essay basis is checked through the session
  await expect(page.getByTestId("runner-application")).toHaveText("검증용 소프트웨어 · 백엔드 개발자");
  await expect(page.getByRole("heading", { name: "Practice Materials" })).toHaveCount(0);
  await expect(page.getByTestId("runner-focus")).toHaveCount(0);
  const started = await (await request.get(`${API}/practice/sessions/${page.url().split("/").at(-2)}`)).json();
  expect(started.context_snapshot.essays[0].content).toContain("40%");
  expect(started.context_snapshot.essays[0].content).not.toContain("70%");
  await page.getByRole("radio", { name: "Type", exact: true }).check();
  await page.getByRole("button", { name: "Start Answer", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("프로젝트에서 제가 개선했습니다.");
  await page.getByRole("button", { name: "Finish Answer" }).click();
  await page.getByRole("button", { name: "Ask a Follow-up" }).click();
  await expect(page.locator(".followup-reason")).toContainText("numbers");
  await expect(page.locator(".runner-q")).toContainText("측정");
  await page.getByRole("button", { name: "Start Answer", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("동일한 요청 1000개를 보내 제가 응답 시간을 측정했습니다. 평균 500ms에서 300ms로 감소했습니다.");
  await page.getByRole("button", { name: "Finish Answer" }).click();
  await page.getByRole("button", { name: "Finish & Review" }).click();
  const cards = page.locator("details.answer-card");
  await expect(cards).toHaveCount(2);
  const first = cards.first();
  const last = cards.last();
  // The essay has numbers and the first answer has none, so its specificity needs work
  await expect(first.locator(":scope > summary")).toContainText("Needs Work");
  await first.locator(":scope > summary").click();
  await expect(first.locator(".coaching-panel")).toContainText("Specificity");
  await expect(first.locator(".criterion").first()).toContainText("프로젝트에서 제가 개선했습니다.");
  // 면접을 마치면 자동 디브리프가 아직 점검하지 않은 꼬리질문 답변도 기본 점검한다(P0). 그 작업이 끝난 뒤 이 답변의
  // 전사문을 고쳐 보고서를 지우면, 두 번째 패널은 'Check Answer' 클릭(POST /coach)에서만 다시 생길 수 있다
  await expect(page.locator(".coaching-panel")).toHaveCount(2);
  const sessionId = page.url().split("/").at(-1);
  await expect.poll(async () => (await (await request.get(`${API}/practice/sessions/${sessionId}`)).json()).debrief_running).toBe(false);
  await last.locator(":scope > summary").click();
  const revised = "동일한 요청 1000개를 보내 제가 응답 시간을 측정했습니다. 평균 500ms에서 250ms로 감소했습니다.";
  await last.getByLabel("Transcript", { exact: true }).fill(revised);
  await last.getByRole("button", { name: "Save", exact: true }).click();
  await expect(last.locator(".coaching-panel")).toHaveCount(0);
  await expect(page.locator(".coaching-panel")).toHaveCount(1);
  // Wait on this answer's own button: it is enabled again only once its save has settled. (A page-wide .last()
  // used to land on Q1's button while Q2's save was still busy.)
  const check = last.getByRole("button", { name: "Check Answer", exact: true });
  await expect(check).toBeEnabled();
  const coached = page.waitForResponse((r) => r.request().method() === "POST" && /\/practice\/answers\/[^/]+\/coach$/.test(r.url()));
  await check.click();
  const response = await coached;
  expect(response.status()).toBe(200);
  expect(response.url()).toContain(`/practice/answers/${(await last.getAttribute("id"))!.replace("answer-", "")}/coach`);
  await expect(page.locator(".coaching-panel")).toHaveCount(2);
  await expect(last.locator(".coaching-panel .criterion").first()).toContainText(revised);
  const redrill = page.locator(".review-summary").getByRole("button", { name: "Practice Weak Answers Again", exact: true });
  await expect(redrill).toBeEnabled();
  // The re-drill reason comes from the server as "Specificity 보완" and shows in English
  await page.locator(".review-summary .summary-details > summary").click();
  await expect(page.locator(".weak-list .chip")).toHaveText(["Specificity: Needs Work"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  // 문서 이미지(docs/screenshots/)는 UPDATE_DOC_SCREENSHOTS=1일 때만 덮어쓴다. 기본은 test-results/
  await page.screenshot({ path: docScreenshotPath(`coaching-review-${testInfo.project.name}`, (f) => testInfo.outputPath(f)), fullPage: true });
  await redrill.click();
  await expect(page).toHaveURL(/\/practice\/sessions\/[\w-]+\/run$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Question 1 of \d+$/ })).toBeVisible();
  const drill = await (await request.get(`${API}/practice/sessions/${page.url().split("/").at(-2)}`)).json();
  expect(drill.title).toMatch(/^보완 연습/);
  expect(drill.context_snapshot.origin_session_id).toBe(sessionId);
  expect(drill.context_snapshot.drill_targets.length).toBeGreaterThan(0);
  // The runner names the focus for this question, in one line
  await expect(page.getByTestId("runner-focus")).toHaveText(`Work on: ${drill.context_snapshot.drill_targets[0].next_action}`);
  await expect(page.getByRole("radio", { name: "Type", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("recording upload failure retains audio for retry and blocks advancing", async ({ page, request }) => {
  const { session } = await seed(request);
  await page.goto(`/practice/sessions/${session.id}/run`);
  // 첫 녹음 전에는 녹음 동의가 필요하다(글 답변에는 묻지 않는다). 동의하면 바로 답변을 시작한다
  await page.getByRole("button", { name: "Agree & Start" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  // A short capture interval supplies actual fake-device audio to MediaRecorder.
  await page.waitForTimeout(750);
  let failed = false;
  await page.route("**/practice/answers/*/audio", async (route) => {
    if (!failed && route.request().method() === "POST") { failed = true; await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Finish Answer" }).click();
  await expect(page.getByRole("button", { name: "Retry Saving Recording" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish & Review" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry Saving Recording" }).click();
  await expect(page.getByRole("button", { name: "Retry Saving Recording" })).toHaveCount(0);
  await page.getByLabel("Transcript (editable)", { exact: true }).fill("직접 입력한 녹음 답변입니다.");
  await page.getByRole("button", { name: "Finish & Review" }).click();
  await expect(page.locator("audio")).toHaveCount(1);
  await page.locator("details.answer-card > summary").click();
  await expect(page.locator("audio")).toBeVisible();
  await expect(page.getByLabel("Transcript", { exact: true })).toHaveValue("직접 입력한 녹음 답변입니다.");
  // 서버는 이번 실행의 임시 녹음 폴더에 저장했다(개발용 backend/recordings/가 아니라)
  expect(readdirSync(join(recordingsDir(), DEV_USER_ID, session.id))).toHaveLength(1);
});

test("mock timer saves the current text once at the deadline", async ({ page, request }) => {
  const { session } = await seed(request, "mock");
  await page.clock.install();
  await page.goto(`/practice/sessions/${session.id}/run`);
  await page.getByRole("radio", { name: "Type", exact: true }).check();
  await page.getByRole("button", { name: "Start Answer", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("제가 직접 측정한 결과입니다.");
  await page.clock.fastForward(10100);
  await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue("제가 직접 측정한 결과입니다.");
  const saved = await (await request.get(`${API}/practice/sessions/${session.id}`)).json();
  expect(saved.answers).toHaveLength(1);
  expect(saved.answers[0].transcript).toBe("제가 직접 측정한 결과입니다.");
});

test("permanent audio error can recover to text and unfinished last answer can resume", async ({ page, request }) => {
  const { session } = await seed(request);
  await page.goto(`/practice/sessions/${session.id}/run`);
  // 첫 녹음 전에는 녹음 동의가 필요하다(글 답변에는 묻지 않는다). 동의하면 바로 답변을 시작한다
  await page.getByRole("button", { name: "Agree & Start" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(750);
  await page.route("**/practice/answers/*/audio", (route) => route.fulfill({ status: 413, contentType: "application/json", body: '{"detail":"녹음 파일이 너무 큽니다"}' }));
  await page.getByRole("button", { name: "Finish Answer" }).click();
  await page.getByRole("button", { name: "Type Instead" }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("제가 직접 작성한 대체 답변입니다.");
  // Save this last answer without finishing, then return through the review UI.
  await page.getByRole("button", { name: "Save Answer" }).click();
  await page.getByRole("link", { name: "End Practice" }).click();
  await page.getByRole("link", { name: "Finish Practice" }).click();
  await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue("제가 직접 작성한 대체 답변입니다.");
  await page.getByRole("button", { name: "Finish & Review" }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/sessions/${session.id}$`));
  const saved = await (await request.get(`${API}/practice/sessions/${session.id}`)).json();
  expect(saved.finished_at).toBeTruthy();
});

test("recorded answer can retry transcription and display returned Korean text", async ({ page, request }) => {
  const { session } = await seed(request);
  const aid = session.answers[0].id;
  await page.goto(`/practice/sessions/${session.id}/run`);
  // 첫 녹음 전에는 녹음 동의가 필요하다(글 답변에는 묻지 않는다). 동의하면 바로 답변을 시작한다
  await page.getByRole("button", { name: "Agree & Start" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(750);
  await page.getByRole("button", { name: "Finish Answer" }).click();
  const text = "저는 캐시를 직접 설계하고 응답 시간을 측정했습니다.";
  // The provider result is simulated: this checks the UI contract, not recognition accuracy.
  await page.route(`**/practice/answers/${aid}/transcribe`, async (route) => {
    const updated = await request.patch(`${API}/practice/answers/${aid}`, { data: { transcript: text } });
    await route.fulfill({ json: { ...await updated.json(), stt_status: "done" } });
  });
  await page.getByRole("button", { name: "Retry Transcription" }).click();
  await expect(page.getByLabel("Transcript (editable)", { exact: true })).toHaveValue(text);
  await expect(page.getByRole("button", { name: "Ask a Follow-up" })).toBeEnabled();
});

test('saving an edited answer holds review navigation until the real PATCH completes',async({page,request})=>{
 const {session}=await seed(request);const id=session.answers[0].id;
 await page.goto(`/practice/sessions/${session.id}/run`);await page.getByRole('radio',{name:'Type',exact:true}).check();await page.getByRole('button',{name:'Start Answer',exact:true}).click();
 await page.getByLabel('Your answer',{exact:true}).fill('처음 작성한 답변입니다.');await page.getByRole('button',{name:'Finish Answer',exact:true}).click();
 const edit=page.getByLabel('Your answer',{exact:true});await expect(edit).toBeEnabled();await edit.fill('저장을 마친 뒤 회고에 표시할 새 답변입니다.');
 let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 await page.route(`**/practice/answers/${id}`,async route=>{if(route.request().method()!=='PATCH')return route.continue();entered();await barrier;await route.continue();});
 const review=page.getByRole('link',{name:'End Practice',exact:true});await page.getByRole('button',{name:'Save Answer',exact:true}).click();await waiting;
 try{
  await expect(review).toHaveAttribute('aria-disabled','true');
  await review.evaluate(element=>(element as HTMLAnchorElement).click());await expect(page).toHaveURL(/\/run$/);
 }finally{release();}
 await expect(review).toHaveAttribute('aria-disabled','false');await review.click();
 await expect(page.getByRole('link',{name:'Finish Practice',exact:true})).toBeVisible();
 const saved=await(await request.get(`${API}/practice/sessions/${session.id}`)).json();expect(saved.answers[0].transcript).toBe('저장을 마친 뒤 회고에 표시할 새 답변입니다.');
});
