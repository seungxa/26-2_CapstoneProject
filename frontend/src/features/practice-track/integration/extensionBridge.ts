// Talking to the JobSeeker Chrome extension from the web app: Chrome passes messages from the origins listed in the
// extension's manifest (externally_connectable). Without the extension every call quietly reports "not installed".

import { EXTENSION_ID } from "../../../extensionId";

export { EXTENSION_ID };

type Runtime = { sendMessage: (id: string, message: unknown, callback: (reply: unknown) => void) => void };
type Reply = { ok?: boolean; version?: string; error?: string } | undefined;

const defaultRuntime = (): Runtime | undefined =>
  (globalThis as { chrome?: { runtime?: Partial<Runtime> } }).chrome?.runtime?.sendMessage
    ? ((globalThis as unknown as { chrome: { runtime: Runtime } }).chrome.runtime)
    : undefined;

function send(message: unknown, runtime: Runtime | undefined, waitMs: number): Promise<Reply> {
  if (!runtime) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), waitMs);
    try {
      runtime.sendMessage(EXTENSION_ID, message, (reply) => {
        // Reading lastError tells Chrome the "extension not installed" case was handled (no console error)
        void (globalThis as { chrome?: { runtime?: { lastError?: unknown } } }).chrome?.runtime?.lastError;
        clearTimeout(timer);
        resolve(reply as Reply);
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

export async function pingExtension(runtime: Runtime | undefined = defaultRuntime(), waitMs = 1500): Promise<{ installed: boolean; version?: string }> {
  const reply = await send({ type: "jobseeker:ping" }, runtime, waitMs);
  return reply?.ok ? { installed: true, version: reply.version } : { installed: false };
}

/** The Supabase access token (null signs the extension out) */
export async function sendSession(token: string | null, runtime: Runtime | undefined = defaultRuntime()): Promise<boolean> {
  return (await send({ type: "jobseeker:session", token }, runtime, 1500))?.ok === true;
}

/** The profile archive the autofill uses */
export async function sendArchive(archive: unknown, runtime: Runtime | undefined = defaultRuntime()): Promise<{ ok: boolean; error?: string }> {
  if (!runtime) return { ok: false, error: "The extension is not installed." };
  const reply = await send({ type: "jobseeker:archive", archive }, runtime, 3000);
  return reply?.ok ? { ok: true } : { ok: false, error: reply?.error ?? "The extension did not answer." };
}
