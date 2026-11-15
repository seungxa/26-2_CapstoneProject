import { expect, test, type Page } from "@playwright/test";
import { API } from "./env";

// Guard: screen text is English. Korean interview content carries lang="ko" and user-typed values sit in inputs,
// so both are excluded. The dev-only gaze labs keep Korean on purpose and are not listed here.
const HANGUL = /[가-힣]/;

/** Visible text of the page without [lang="ko"] subtrees and without input/textarea values */
async function screenText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[lang="ko"], input, textarea, script, style').forEach((el) => el.remove());
    // select options show the stored Korean values only through label(); option text is checked too
    return clone.textContent ?? "";
  });
}

async function expectEnglish(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".practice-track")).toBeVisible();
  const text = await screenText(page);
  expect(text.length, `${path} rendered nothing`).toBeGreaterThan(40);
  const found = text.match(new RegExp(`.{0,30}${HANGUL.source}.{0,30}`, "g"));
  expect(found, `Korean text outside lang="ko" on ${path}`).toBeNull();
}

test("Practice and Track screens show no Korean outside lang=ko content", async ({ page, request }) => {
  const stamp = Date.now();
  const q = await (await request.post(`${API}/practice/questions`, { data: { category: "직무", text: `영어 화면 점검 질문 ${stamp}` } })).json();
  const app = await (await request.post(`${API}/track/applications`, { data: { company: `영어점검회사${stamp}`, position: "백엔드 개발자", job_category: "개발" } })).json();
  await request.patch(`${API}/track/applications/${app.id}`, { data: { stage: "1차면접", status: "보류" } });
  const essay = await (await request.post(`${API}/track/applications/${app.id}/essays`, { data: { question_text: "지원 동기", content: "저는 캐시를 설계하고 응답 시간을 줄였습니다." } })).json();
  await request.post(`${API}/track/essays/${essay.id}/versions`, { data: { content: "수정한 자기소개서 문장입니다.", is_submitted: true } });
  await request.put(`${API}/practice/settings`, { data: { consent: true } });
  const session = await (await request.post(`${API}/practice/sessions`, { data: {
    mode: "free", application_id: app.id, question_ids: [q.id], followups_enabled: true, prep_sec: 0, answer_sec: 30,
  } })).json();
  const answer = session.answers[0].id;
  await request.patch(`${API}/practice/answers/${answer}`, { data: { transcript: "제가 맡은 일을 끝까지 책임지고 마무리했습니다. 결과를 측정해 40% 줄였습니다.", self_rating: 3, reflection_note: "다음엔 숫자를 먼저 말하기" } });
  await request.post(`${API}/practice/answers/${answer}/coach`);

  try {
    for (const path of [
      "/practice", "/practice/history", "/practice/settings",
      `/practice/sessions/${session.id}/run`, // runner, before consent withdrawal and while unfinished
      "/track", `/track/${app.id}`, "/track/stats",
    ]) await expectEnglish(page, path);
    await request.post(`${API}/practice/sessions/${session.id}/finish`);
    await expectEnglish(page, `/practice/sessions/${session.id}`); // review
    await request.put(`${API}/practice/settings`, { data: { consent: false } });
    await expectEnglish(page, "/practice/settings"); // pre-consent card
    await expectEnglish(page, `/practice/sessions/${session.id}/run`);
  } finally {
    await request.put(`${API}/practice/settings`, { data: { consent: false } });
  }
});

test("a recording that can't be loaded is explained in English, once", async ({ page, request }) => {
  const q = await (await request.post(`${API}/practice/questions`, { data: { category: "인성", text: `녹음 불러오기 실패 ${Date.now()}` } })).json();
  const session = await (await request.post(`${API}/practice/sessions`, { data: { mode: "free", question_ids: [q.id], prep_sec: 0, answer_sec: 30 } })).json();
  const answer = session.answers[0].id;
  await request.put(`${API}/practice/settings`, { data: { consent: true } });
  try {
    // Transcription is off on the e2e server, so the upload keeps the original and the review tries to load it
    const uploaded = await request.post(`${API}/practice/answers/${answer}/audio`, {
      multipart: { file: { name: "rec.webm", mimeType: "audio/webm", buffer: Buffer.from("not-real-audio") }, duration_sec: "5" },
    });
    expect(uploaded.ok()).toBeTruthy();
    for (const [status, detail, shown] of [
      [404, "The original recording was deleted.", "The original recording was deleted."],
      [404, null, "The recording wasn't found."],
      [502, "Could not reach recording storage. Try again in a moment.", "Couldn't load the recording. Try again."],
    ] as const) {
      await page.unroute("**/answers/*/audio");
      await page.route("**/answers/*/audio", (route) => route.request().method() !== "GET" ? route.continue()
        : route.fulfill({ status, contentType: "application/json", body: detail ? JSON.stringify({ detail }) : "" }));
      await page.goto(`/practice/sessions/${session.id}`);
      const card = page.locator(`#answer-${answer}`);
      await card.locator(":scope > summary").click();
      const note = card.locator(".answer-audio");
      await expect(note).toContainText(shown);
      const said = (await note.textContent()) ?? "";
      expect(said.split("Couldn't load the recording.").length - 1, said).toBeLessThanOrEqual(1);
      const text = await screenText(page);
      expect(text.match(new RegExp(`.{0,30}${HANGUL.source}.{0,30}`, "g")), `Korean text outside lang="ko" (${status})`).toBeNull();
    }
  } finally {
    await request.put(`${API}/practice/settings`, { data: { consent: false } });
  }
});
