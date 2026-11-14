import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./env";

// Review overview: one Summary card, charts and rule-based points folded under its Details, answers as folded cards.
// Everything is computed from the session detail. No outside service is called
const LONG_Q = "지금까지 경험한 프로젝트 가운데 가장 어려웠던 순간을 하나 고르고, 그때 팀과 본인이 각각 어떤 판단을 했으며 결과가 어땠는지 아주 자세하게 설명해 주세요".repeat(2);
const TEAM = "우리 팀은 서비스 응답 속도를 개선하기 위해 캐시 구조를 바꾸고 배포 과정을 다시 설계해서 결과적으로 사용자 불만을 크게 줄였습니다";
const LIMIT = "Rule-based checks, not a hiring assessment.";

async function session(request: APIRequestContext, texts: string[]) {
  const ids = [];
  for (const text of texts)
    ids.push((await (await request.post(`${API}/practice/questions`, { data: { category: "인성", text: `${text} ${Date.now()}-${Math.random()}` } })).json()).id);
  const s = await (await request.post(`${API}/practice/sessions`, { data: { mode: "free", question_ids: ids, prep_sec: 0, answer_sec: 60 } })).json();
  return s as { id: string; answers: { id: string; order_no: number }[] };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("review leads with one summary", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const s = await session(request, ["본인의 강점은 무엇인가요?", "지원 동기를 말씀해 주세요."]);
  const [a1, a2] = [...s.answers].sort((x, y) => x.order_no - y.order_no);
  await request.patch(`${API}/practice/answers/${a1.id}`, { data: { transcript: TEAM, self_rating: 2 } });
  await request.patch(`${API}/practice/answers/${a2.id}`, { data: { transcript: "제가 맡은 일을 끝까지 책임지는 편입니다.", self_rating: 5 } });
  await request.post(`${API}/practice/answers/${a1.id}/coach`);

  await page.goto(`/practice/sessions/${s.id}`);
  // Header: Practice · date, and Delete
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Practice · [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  // One Summary card holds the counts, the next step, the re-drill button and the limit line
  const cards = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Summary", exact: true }) });
  await expect(cards).toHaveCount(1);
  await expect(page.locator(".practice-track").getByRole("heading", { level: 2 })).toHaveText(["Summary"]); // no other open cards
  const summary = cards.first();
  await expect(summary.getByTestId("summary-counts")).toHaveText("2 answers · 0 need work · Avg. self-rating 3.5");
  await expect(summary.getByTestId("summary-next")).toContainText("Next: Q1");
  await expect(summary.getByRole("button", { name: "Practice Weak Answers Again", exact: true })).toBeEnabled();
  await expect(summary.getByText(LIMIT, { exact: true })).toBeVisible();
  // The limit sentence is said once on the whole page
  const text = (await page.locator(".practice-track").textContent()) ?? "";
  expect(text.split(LIMIT).length - 1).toBe(1);
  // The rest is folded: charts and coaching notes under Details, materials under their own fold
  await expect(summary.locator(".summary-details")).not.toHaveAttribute("open");
  // Answer cards start folded. Each summary line is Qn, the Korean question, the verdict and the stars
  const answers = page.locator("details.answer-card");
  await expect(answers).toHaveCount(2);
  for (const card of await answers.all()) await expect(card).not.toHaveAttribute("open");
  const line = page.locator(`#answer-${a1.id} > summary`);
  await expect(line).toContainText("Q1");
  await expect(line.locator('[lang="ko"]')).toContainText("본인의 강점은 무엇인가요?");
  await expect(line).toContainText("Not Judged");
  await expect(line.getByRole("img", { name: "Self-rating 2 of 5" })).toHaveText("★★☆☆☆");
  await expect(page.locator(`#answer-${a2.id} > summary`)).toContainText("Not Checked");
  await expect(page.locator(`#answer-${a1.id}`).getByLabel("Transcript", { exact: true })).toBeHidden();
  // Opening a card shows the transcript, checks, self rating, note and its two actions
  await line.click();
  const card = page.locator(`#answer-${a1.id}`);
  await expect(card.getByLabel("Transcript", { exact: true })).toHaveValue(TEAM);
  await expect(card.getByLabel("Transcript", { exact: true })).toHaveAttribute("lang", "ko");
  await expect(card.getByRole("heading", { name: "Checks", exact: true })).toBeVisible();
  // All three criteria are Not Judged: one line, with the three reasons folded
  await expect(card.getByText(/^Not judged: add /)).toBeVisible();
  await expect(card.locator(".criterion").first()).toBeHidden();
  await expect(card.getByRole("heading", { name: "Self Rating & Note", exact: true })).toBeVisible();
  await expect(card.getByRole("radio", { name: "2 stars", exact: true })).toBeChecked();
  await expect(card.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Check Answer", exact: true })).toBeEnabled();
  await expect(page.locator(".practice-track")).not.toContainText(/OpenAI|score|confiden/i);
  expect(errors).toEqual([]);
});

test("typed answers: status grid, rule-based points with answer links, and reasons instead of empty charts", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const s = await session(request, [LONG_Q, "본인의 강점은 무엇인가요?"]);
  const [a1, a2] = [...s.answers].sort((x, y) => x.order_no - y.order_no);
  await request.patch(`${API}/practice/answers/${a1.id}`, { data: { transcript: TEAM, self_rating: 2 } });
  await request.patch(`${API}/practice/answers/${a2.id}`, { data: { transcript: "제가 맡은 일을 끝까지 책임지는 편입니다.", self_rating: 4 } });
  await request.post(`${API}/practice/answers/${a1.id}/coach`); // 기본 점검(모두 판단유보)

  await page.goto(`/practice/sessions/${s.id}`);
  const card = page.locator(".review-summary");
  await expect(card.getByRole("heading", { name: "Summary" })).toBeVisible();
  await card.locator(".summary-details > summary").click();

  const grid = card.getByRole("table", { name: "Checks for each answer" });
  await expect(grid.getByRole("row").filter({ hasText: "Q1" })).toContainText("–Not Judged");
  await expect(grid.getByRole("row").filter({ hasText: "Q2" })).toContainText("·Not Checked");

  const points = card.getByTestId("insight-points");
  await expect(points).not.toContainText(/your own role|pronoun/i); // 대명사 유무로 본인 역할을 판정하지 않는다
  const low = points.getByRole("listitem").filter({ hasText: "Low self-rating" });
  await expect(low.getByRole("link", { name: "Q1" })).toHaveAttribute("href", `#answer-${a1.id}`);
  await expect(low).toContainText("Q1 2/5");
  await expect(points).not.toContainText("Q2 4/5");

  await expect(card.getByText("No recorded answers, so there's no speaking pace.")).toBeVisible();
  await expect(card.getByText("No recorded answers, so there's no answer time to show.")).toBeVisible();

  const rating = card.getByRole("figure", { name: "Self Rating" });
  await rating.getByText("Show as Table").click();
  await expect(rating.getByRole("table")).toContainText("2/5");
  await expect(rating.getByRole("table")).toContainText("4/5");

  // 아주 긴 질문이 있어도 화면이 옆으로 넘치지 않는다
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("a session with no answers yet shows a short note instead of charts", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const s = await session(request, ["지원 동기를 말씀해 주세요."]);
  await page.goto(`/practice/sessions/${s.id}`);
  const card = page.locator(".review-summary");
  await expect(card.getByTestId("summary-counts")).toHaveText("No answers yet.");
  await expect(card.getByRole("button", { name: "Practice Weak Answers Again", exact: true })).toBeDisabled();
  await expect(card.locator("table")).toHaveCount(0);
  await expect(card.getByTestId("summary-next")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("no horizontal scroll with an answer card and the summary details open", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone width only");
  const s = await session(request, [LONG_Q]);
  const [a1] = s.answers;
  await request.patch(`${API}/practice/answers/${a1.id}`, { data: { transcript: TEAM.repeat(4), self_rating: 1, reflection_note: "다음에는 결과를 숫자로 말하기" } });
  await request.post(`${API}/practice/answers/${a1.id}/coach`);
  await page.goto(`/practice/sessions/${s.id}`);
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  const card = page.locator(`#answer-${a1.id}`);
  await card.locator(":scope > summary").click();
  await expect(card.getByLabel("Transcript", { exact: true })).toBeVisible();
  for (const fold of await card.locator("details").all()) await fold.locator(":scope > summary").click();
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  await page.locator(".review-summary .summary-details > summary").click();
  await expect(page.getByRole("table", { name: "Checks for each answer" })).toBeVisible();
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  // Closing it again leaves the folded line on one screen width too
  await card.locator(":scope > summary").click();
  await expect(card).not.toHaveAttribute("open");
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
});
