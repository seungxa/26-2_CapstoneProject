import { expect, test, type Page } from "@playwright/test";

// The Apply page: download the merged extension, install steps, and the connection to an installed extension.
// The extension is a stand-in chrome.runtime; the team profile row is a stand-in Supabase reply.

async function fakeExtension(page: Page, archiveReply: object = { ok: true }) {
  await page.addInitScript((reply) => {
    const sent: unknown[] = [];
    (window as any).sentToExtension = () => sent;
    (window as any).chrome = { runtime: { sendMessage: (_id: string, message: { type: string }, callback: (r: unknown) => void) => {
      sent.push(message);
      const answer = message.type === "jobseeker:ping" ? { ok: true, version: "0.8.0" } : message.type === "jobseeker:archive" ? reply : { ok: true };
      setTimeout(() => callback(answer), 5);
    } } };
  }, archiveReply);
  await page.route("**/rest/v1/profiles**", (route) => route.fulfill({ json: { archive: { profile: { name: "홍길동", email: "practice@example.invalid" } } } }));
}

test("without the extension the page offers the download and the steps", async ({ page }) => {
  await page.goto("/apply");
  await expect(page.getByRole("heading", { level: 1, name: "Apply" })).toBeVisible();
  const download = page.getByRole("link", { name: /^Download/ });
  await expect(download).toHaveAttribute("href", "/downloads/jobseeker-extension.zip");
  await expect(download).toHaveAttribute("download", "");
  await expect(download).toContainText("v0.8.0");
  await expect(page.getByRole("list", { name: "Install steps" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByTestId("extension-status")).toHaveText("Not installed");
  await expect(page.getByRole("button", { name: "Send my profile" })).toBeDisabled();
  const zip = await page.request.get("/downloads/jobseeker-extension.zip");
  expect(zip.status()).toBe(200);
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("with the extension it connects, sends the sign-in and the profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "flow check");
  await fakeExtension(page);
  await page.goto("/apply");
  await expect(page.getByTestId("extension-status")).toHaveText("Installed v0.8.0");
  await expect.poll(() => page.evaluate(() => (window as any).sentToExtension().filter((m: { type: string }) => m.type === "jobseeker:session").length)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Send my profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile sent" })).toBeVisible();
  const archive = await page.evaluate(() => (window as any).sentToExtension().find((m: { type: string }) => m.type === "jobseeker:archive"));
  expect(archive.archive.profile.name).toBe("홍길동");
});

test("an archive the extension refuses shows its reason", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "flow check");
  await fakeExtension(page, { ok: false, error: "Not a valid archive." });
  await page.goto("/apply");
  await page.getByRole("button", { name: "Send my profile" }).click();
  await expect(page.getByRole("alert")).toHaveText("Not a valid archive.");
});
