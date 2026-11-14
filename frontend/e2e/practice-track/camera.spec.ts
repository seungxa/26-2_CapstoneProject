import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { API, BROWSER_API } from "./env";

// 카메라 자세 분석(선택 기능). 검출기는 playwright.config.ts의 VITE_E2E_FAKE_FACE로 가짜를 쓰고, 카메라는 Chromium의 가짜 장치를 쓴다
async function seed(request: APIRequestContext) {
  const q = await (await request.post(`${API}/practice/questions`, { data: { category: "인성", text: `카메라 분석 질문 ${Date.now()}-${Math.random()}` } })).json();
  return (await request.post(`${API}/practice/sessions`, { data: { mode: "free", question_ids: [q.id], prep_sec: 0, answer_sec: 10 } })).json();
}

/** getUserMedia가 돌려준 카메라 스트림을 모아 둔다(정리됐는지 확인용). deny면 카메라만 거부한다 */
async function watchCamera(page: Page, deny = false) {
  await page.addInitScript((denyVideo) => {
    const w = window as unknown as { __cameraStreams: MediaStream[] };
    w.__cameraStreams = [];
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (c?.video && denyVideo) throw new DOMException("denied", "NotAllowedError");
      const s = await original(c);
      if (c?.video) w.__cameraStreams.push(s);
      return s;
    };
  }, deny);
}
const liveCameraTracks = (page: Page) => page.evaluate(() =>
  (window as unknown as { __cameraStreams: MediaStream[] }).__cameraStreams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length);

async function answerByTextAndFinish(page: Page, waitMs = 0) {
  await page.getByRole("radio", { name: "Type", exact: true }).check();
  await page.getByRole("button", { name: "Start Answer", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("팀 프로젝트에서 일정 관리를 맡았습니다.");
  if (waitMs) await page.waitForTimeout(waitMs); // 고개 방향 기준을 잡을 만큼 표본을 모은다(초당 4회)
  await page.getByRole("button", { name: "Finish Answer" }).click();
  await page.getByRole("button", { name: "Finish & Review" }).click();
  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
}
/** Camera numbers now sit in each answer's Delivery section */
const cameraBlock = (page: Page) => page.locator(".camera-delivery");
const voiceBlock = (page: Page) => page.locator(".voice-delivery");
const metric = (block: Locator, name: string) => block.locator(`[data-metric="${name}"]`);

test("camera analysis measures during the answer, shows numbers in review, and keeps them only in memory", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sent: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(BROWSER_API)) sent.push(r.postData() ?? ""); });
  await watchCamera(page);
  const session = await seed(request);
  await page.goto(`/practice/sessions/${session.id}/run`);
  const panel = page.locator(".camera-panel");
  await expect(panel.getByRole("heading", { name: "Camera Feedback", exact: true })).toBeVisible();
  await expect(panel).toContainText("Optional. Video stays on this device.");
  // 측정 항목과 한계는 접힌 Details 안에 있다
  const details = panel.locator("details");
  await expect(details).not.toHaveAttribute("open");
  await details.getByText("Details", { exact: true }).click();
  await expect(details).toContainText("not eye tracking");
  await expect(details).toContainText("face not found");
  await expect(panel).not.toContainText(/off[- ]screen|looked away/i);

  await panel.getByRole("button", { name: "Turn On Camera" }).click();
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expect(panel.getByRole("status")).toContainText(/face/i);
  // 끄면 카메라를 바로 놓고, 다시 켤 수 있다
  await panel.getByRole("button", { name: "Turn Off Camera" }).click();
  await expect.poll(() => liveCameraTracks(page)).toBe(0);
  await panel.getByRole("button", { name: "Turn On Camera" }).click();
  await expect(page.getByLabel("Camera preview")).toBeVisible();

  await page.getByRole("checkbox", {name:"Show live hints"}).uncheck();
  await expect(panel.getByRole("status")).toHaveCount(0);
  await page.getByRole("checkbox", {name:"Show live hints"}).check();
  const consent=page.getByRole("button",{name:"Agree & Start"});
  if(await consent.count()) await consent.click();
  else await page.getByRole("button",{name:"Start Answer",exact:true}).click();
  await page.waitForTimeout(4000);
  await page.getByRole("button",{name:"Finish Answer"}).click();
  await page.getByLabel("Transcript (editable)").fill("팀 프로젝트에서 일정 관리를 맡았습니다.");
  await page.getByRole("button",{name:"Finish & Review"}).click();
  await expect(page.getByRole("heading",{name:"Summary",exact:true})).toBeVisible();
  // 회고로 넘어가면(면접 화면을 떠나면) 카메라를 놓는다
  expect(await liveCameraTracks(page)).toBe(0);
  const answer = page.locator("details.answer-card").first();
  await answer.locator(":scope > summary").click();
  const card = cameraBlock(page);
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Face found");
  await expect(card).toContainText("Face not found");
  await expect(card).toContainText("Analyzed");
  await expect(card).not.toContainText(/off[- ]screen|looked away/i);
  await expect(metric(card, "face-found")).toHaveText(/^\d+%$/);
  await expect(metric(card, "head-turned")).toHaveText(/^\d+%$/); // 고개 방향 기준을 잡았다
  await expect(card).not.toContainText(/confiden|nervous|likely to pass|score/i);
  // The test condition picker and the diagnostics are dev-only (CAMERA_DEBUG is off here)
  await expect(answer.getByRole("combobox")).toHaveCount(0);
  await expect(answer.getByRole("button", { name: /Export/ })).toHaveCount(0);
  await expect(voiceBlock(page)).toBeVisible(); // the same answer's voice numbers
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({colorScheme});
    const minimum = await answer.evaluate(root => {
      const luminance=(value:string)=>{const rgb=(value.match(/[\d.]+/g)??[]).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=0.03928?n/12.92:((n+0.055)/1.055)**2.4);return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];};
      const background=luminance(getComputedStyle(root).backgroundColor);
      return Math.min(...[...root.querySelectorAll('.muted,th')].map(el=>{const foreground=luminance(getComputedStyle(el).color);return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);}));
    });
    expect(minimum).toBeGreaterThanOrEqual(4.5);
  }
  // 수치는 서버로 보내지 않는다. 먼저 API 요청을 실제로 모았는지(글 답변 저장) 확인한다: 비어 있으면 아래 검사는 의미가 없다
  expect(sent.some((b) => b.includes("일정 관리를 맡았습니다"))).toBe(true);
  expect(sent.filter((b) => /detectedMs|noneMs|edgeMs|turnedMs|yaw|pitch|overshoot/.test(b))).toEqual([]);
  await expect(page.locator('.integrated-coaching')).toContainText('Camera, Q1:');
  await card.getByRole('button',{name:'Clear Camera Results'}).click();
  await expect(cameraBlock(page)).toHaveCount(0);
  await expect(page.locator('.integrated-coaching')).not.toContainText('Camera, Q1:');
  await expect(voiceBlock(page)).toBeVisible(); // clearing the camera keeps the voice numbers
  // 메모리에만 있으므로 새로고침하면 사라진다
  await page.reload();
  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
  await expect(cameraBlock(page)).toHaveCount(0);
  await expect(voiceBlock(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("camera permission denied keeps the interview working", async ({ page, request }) => {
  await watchCamera(page, true);
  const session = await seed(request);
  await page.goto(`/practice/sessions/${session.id}/run`);
  await page.getByRole("button", { name: "Turn On Camera" }).click();
  await expect(page.locator(".camera-panel").getByRole("alert")).toContainText("Can't use the camera");
  await answerByTextAndFinish(page);
  await expect(cameraBlock(page)).toHaveCount(0);
});

test("analysis model load failure releases the camera and keeps the interview working", async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem("e2e-face-detector", "fail"));
  await watchCamera(page);
  const session = await seed(request);
  await page.goto(`/practice/sessions/${session.id}/run`);
  await page.getByRole("button", { name: "Turn On Camera" }).click();
  await expect(page.locator(".camera-panel").getByRole("alert")).toContainText("Couldn't load camera feedback");
  await expect.poll(() => liveCameraTracks(page)).toBe(0);
  await expect(page.getByLabel("Camera preview")).toHaveCount(0);
  await answerByTextAndFinish(page);
  await expect(cameraBlock(page)).toHaveCount(0);
});

test("edge-top: face partly outside is shown as detected, not as not-found", async ({ page, request }) => {
  // 이마 위만 프레임 밖이고 눈·코·입은 안에 있는 얼굴(가까이 앉은 경우)
  await page.addInitScript(() => localStorage.setItem("e2e-face-detector", "edge-top"));
  await watchCamera(page);
  const session = await seed(request);
  await page.goto(`/practice/sessions/${session.id}/run`);
  const panel = page.locator(".camera-panel");
  await panel.getByRole("button", { name: "Turn On Camera" }).click();
  await expect(panel.getByRole("status")).toHaveText("Part of your face is out of view at the top");
  // 미리보기는 분석 프레임 전체를 보여 주고(contain), 좌우 반전은 그대로다
  const preview = page.getByLabel("Camera preview");
  expect(await preview.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain");
  expect(await preview.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(-1,/);

  const consent=page.getByRole("button",{name:"Agree & Start"});
  if(await consent.count()) await consent.click();
  else await page.getByRole("button",{name:"Start Answer",exact:true}).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button",{name:"Finish Answer"}).click();
  await page.getByLabel("Transcript (editable)").fill("팀 프로젝트에서 일정 관리를 맡았습니다.");
  await page.getByRole("button",{name:"Finish & Review"}).click();
  await page.locator("details.answer-card > summary").click();
  const card = cameraBlock(page);
  await expect(metric(card, "face-found")).toHaveText("100%"); // 얼굴 검출
  await expect(metric(card, "face-none")).toHaveText(/^0s /); // 찾지 못한 시간
  await expect(metric(card, "face-edge")).not.toHaveText(/^0s /); // 일부 프레임 밖
  await expect(card).not.toContainText(/off[- ]screen|looked away/i);
});

test("typed answers never receive camera or voice reports", async ({page,request}) => {
 const session=await seed(request); await page.goto(`/practice/sessions/${session.id}/run`);
 await page.getByRole("button",{name:"Turn On Camera"}).click();
 await answerByTextAndFinish(page,1500);
 await expect(cameraBlock(page)).toHaveCount(0);
 await expect(voiceBlock(page)).toHaveCount(0);
});

test("failed recording uploads never publish camera or voice reports", async ({page,request})=>{
 const session=await seed(request);
 await page.goto(`/practice/sessions/${session.id}/run`);
 await page.getByRole("button",{name:"Turn On Camera"}).click();
 const consent=page.getByRole("button",{name:"Agree & Start"});
 if(await consent.count()) await consent.click(); else await page.getByRole("button",{name:"Start Answer",exact:true}).click();
 await page.waitForTimeout(1200);
 await page.route("**/practice/answers/*/audio",route=>route.fulfill({status:503,json:{detail:"테스트 저장 실패"}}));
 await page.getByRole("button",{name:"Finish Answer"}).click();
 await expect(page.getByRole("alert")).toContainText("테스트 저장 실패");
 await page.getByRole("link",{name:"End Practice"}).click();
 await expect(page.getByRole("heading",{name:"Summary",exact:true})).toBeVisible();
 await expect(cameraBlock(page)).toHaveCount(0);
 await expect(voiceBlock(page)).toHaveCount(0);
});
