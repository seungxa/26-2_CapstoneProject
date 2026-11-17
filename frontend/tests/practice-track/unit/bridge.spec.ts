// Messages from the JobSeeker web app to the extension (extension/bridge.js and the background handler).
import { expect, test } from "@playwright/test";
import { allowedOrigin, parseExternal } from "../../../../extension/bridge.js";

const manifest = { externally_connectable: { matches: ["http://localhost:5173/*", "https://team.example.app/*"] } };

test("only the web app's own origins may talk to the extension", () => {
  expect(allowedOrigin("http://localhost:5173", manifest)).toBe(true);
  expect(allowedOrigin("https://team.example.app", manifest)).toBe(true);
  expect(allowedOrigin("http://localhost:5174", manifest)).toBe(false);
  expect(allowedOrigin("https://evil.example.com", manifest)).toBe(false);
  expect(allowedOrigin("https://team.example.app.evil.com", manifest)).toBe(false);
  expect(allowedOrigin(undefined, manifest)).toBe(false);
});

test("messages are checked before anything is stored", () => {
  expect(parseExternal({ type: "jobseeker:ping" })).toEqual({ kind: "ping" });
  expect(parseExternal({ type: "jobseeker:session", token: "abc" })).toEqual({ kind: "session", token: "abc" });
  expect(parseExternal({ type: "jobseeker:session", token: null })).toEqual({ kind: "session", token: null });
  expect(parseExternal({ type: "jobseeker:session", token: "x".repeat(4097) })).toHaveProperty("error");
  expect(parseExternal({ type: "jobseeker:session", token: 5 })).toHaveProperty("error");
  expect(parseExternal({ type: "jobseeker:archive", archive: { profile: {} } })).toEqual({ kind: "archive", archive: { profile: {} } });
  expect(parseExternal({ type: "jobseeker:archive", archive: [] })).toHaveProperty("error");
  expect(parseExternal({ type: "something-else" })).toHaveProperty("error");
  expect(parseExternal(null)).toHaveProperty("error");
});

test("the background stores a session only from an allowed origin", async () => {
  const listeners: Record<string, (...a: unknown[]) => unknown> = {};
  const ev = (name: string) => ({ addListener: (f: (...a: unknown[]) => unknown) => { listeners[name] = f; } });
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: "self", onInstalled: ev("i"), onMessage: ev("m"), onMessageExternal: ev("ext"),
      getManifest: () => ({ version: "0.8.0", ...manifest }) },
    action: { onClicked: ev("c") }, sidePanel: { setPanelBehavior: async () => undefined },
    tabs: { onCreated: ev("tc"), onUpdated: ev("tu"), onRemoved: ev("tr") },
    webNavigation: { onCreatedNavigationTarget: ev("n1"), onCommitted: ev("n2"), onCompleted: ev("n3") },
    storage: {
      session: { set: async (v: object) => Object.assign(session, v), remove: async (k: string) => { delete session[k]; }, get: async () => ({ ...session }) },
      local: { set: async (v: object) => Object.assign(local, v), get: async () => ({ ...local }), setAccessLevel: () => undefined },
    },
  };
  await import(`../../../../extension/background.js?bridge=${Date.now()}`);
  const send = (message: object, origin: string) => new Promise((resolve) => listeners.ext(message, { origin }, resolve));
  expect(await send({ type: "jobseeker:ping" }, "http://localhost:5173")).toEqual({ ok: true, version: "0.8.0" });
  expect(await send({ type: "jobseeker:session", token: "tok" }, "https://evil.example.com")).toEqual({ ok: false, error: "This site may not talk to JobSeeker." });
  expect(session).toEqual({});
  expect(await send({ type: "jobseeker:session", token: "tok" }, "http://localhost:5173")).toEqual({ ok: true });
  expect(session).toEqual({ accessToken: "tok" });
  expect(await send({ type: "jobseeker:archive", archive: { profile: { name: "홍길동" } } }, "http://localhost:5173")).toEqual({ ok: true });
  expect((local["jobseeker.archive.v1"] as { profile: { name: string } }).profile.name).toBe("홍길동");
  expect(await send({ type: "jobseeker:archive", archive: { education: "x" } }, "http://localhost:5173")).toEqual({ ok: false, error: "Check the record list format." });
  expect(await send({ type: "jobseeker:session", token: null }, "http://localhost:5173")).toEqual({ ok: true });
  expect(session).toEqual({});
});
