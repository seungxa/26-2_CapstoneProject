// The web side of the extension connection (integration/extensionBridge.ts) with a stand-in chrome.runtime.
import { expect, test } from "@playwright/test";
import { EXTENSION_ID, pingExtension, sendArchive, sendSession } from "../../../src/features/practice-track/integration/extensionBridge";

type Sent = { id: string; message: unknown };
const runtime = (reply: (m: { type: string }) => unknown, sent: Sent[] = []) => ({
  sendMessage: (id: string, message: { type: string }, callback: (r: unknown) => void) => { sent.push({ id, message }); const r = reply(message); if (r !== undefined) setTimeout(() => callback(r), 5); },
});

test("without Chrome's extension messaging the extension counts as not installed", async () => {
  expect(await pingExtension(undefined)).toEqual({ installed: false });
  expect(await sendSession("t", undefined)).toBe(false);
  expect(await sendArchive({}, undefined)).toEqual({ ok: false, error: "The extension is not installed." });
});

test("ping reports the installed version; silence means not installed", async () => {
  const sent: Sent[] = [];
  expect(await pingExtension(runtime(() => ({ ok: true, version: "0.8.0" }), sent))).toEqual({ installed: true, version: "0.8.0" });
  expect(sent).toEqual([{ id: EXTENSION_ID, message: { type: "jobseeker:ping" } }]);
  expect(EXTENSION_ID).toBe("hbbocccjbnobncagkalnkeapkndiompd");
  const started = Date.now();
  expect(await pingExtension(runtime(() => undefined), 300)).toEqual({ installed: false });
  expect(Date.now() - started).toBeGreaterThanOrEqual(280);
});

test("session and archive messages have the agreed shape", async () => {
  const sent: Sent[] = [];
  expect(await sendSession("tok", runtime(() => ({ ok: true }), sent))).toBe(true);
  expect(await sendArchive({ profile: {} }, runtime(() => ({ ok: false, error: "Not a valid archive." }), sent))).toEqual({ ok: false, error: "Not a valid archive." });
  expect(sent.map((s) => s.message)).toEqual([{ type: "jobseeker:session", token: "tok" }, { type: "jobseeker:archive", archive: { profile: {} } }]);
});
