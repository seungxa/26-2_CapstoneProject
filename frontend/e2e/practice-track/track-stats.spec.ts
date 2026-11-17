import { expect, test, type Page } from "@playwright/test";

// The stats screen draws a fixed /track/stats reply: numbers are checked as text next to every bar.

function month(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function plus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const row = (stage: string, reached: number) => ({ stage, reached, passed: 0, failed: 0, pending: reached, hold: 0, pass_rate: null });
const funnel = ["서류", "인적성", "1차면접", "2차면접", "최종"].map((s, i) => row(s, Math.max(0, 4 - i)));
const base = {
  total: 6,
  status: { 진행중: 3, 합격: 2, 불합격: 1, 보류: 0 },
  funnel,
  by_job_category: [
    { job_category: "개발", total: 4, final_pass: 2, funnel },
    { job_category: "기획", total: 2, final_pass: 0, funnel },
  ],
  monthly: [],
  applied_monthly: [{ month: month(0), count: 3 }, { month: month(-2), count: 2 }, { month: month(-14), count: 9 }],
  undated_count: 1,
  upcoming: [
    { date: plus(2), kind: "deadline", application_id: "a1", company: "토스", position: "서버", label: "" },
    { date: plus(5), kind: "next_step", application_id: "a2", company: "카카오", position: "백엔드", label: "1차 면접" },
  ],
  days_to_first_result: { median: 6.5, count: 4 },
};

async function show(page: Page, body: object) {
  await page.route((url) => url.port === "8011" && url.pathname === "/track/stats", (route) => route.fulfill({ json: body }));
  await page.goto("/track/stats");
  await expect(page.getByRole("heading", { level: 1, name: "Stats" })).toBeVisible();
}

test("upcoming items, monthly bars, pass rate by job and time to first result", async ({ page }) => {
  await show(page, base);
  const next = page.getByRole("region", { name: "Next 14 Days" });
  await expect(next.getByRole("listitem")).toHaveCount(2);
  await expect(next.getByRole("listitem").first()).toContainText("Deadline");
  await expect(next.getByRole("listitem").first()).toContainText("토스");
  await expect(next.getByRole("listitem").nth(1)).toContainText("1차 면접");
  await expect(next.getByRole("link", { name: /카카오/ })).toHaveAttribute("href", "/track/a2");

  const months = page.getByRole("region", { name: "By Month" });
  const bars = months.getByTestId("month-bar");
  await expect(bars).toHaveCount(12); // the last 12 months, older ones left out
  await expect(bars.last()).toHaveAttribute("data-count", "3");
  await expect(bars.nth(9)).toHaveAttribute("data-count", "2");
  await expect(bars.nth(10)).toHaveAttribute("data-count", "0");
  await expect(months).toContainText("1 with no date");

  const jobs = page.getByRole("region", { name: "By Job" });
  await expect(jobs.getByTestId("job-pass")).toHaveText([/Engineering.*2\/4.*50%/, /Product.*0\/2.*0%/]);

  await expect(page.getByTestId("days-to-result")).toContainText("6.5");
  await expect(page.getByTestId("days-to-result")).toContainText("(4 results)");
});

test("nothing upcoming and no results yet", async ({ page }) => {
  await show(page, { ...base, upcoming: [], days_to_first_result: { median: null, count: 0 } });
  await expect(page.getByText("Nothing due in the next 14 days")).toBeVisible();
  await expect(page.getByTestId("days-to-result")).toContainText("–");
});

test("an older reply without the new fields still renders", async ({ page }) => {
  const { upcoming: _u, days_to_first_result: _d, ...old } = base;
  await show(page, old);
  await expect(page.getByText("Nothing due in the next 14 days")).toBeVisible();
  await expect(page.getByTestId("days-to-result")).toContainText("–");
});
