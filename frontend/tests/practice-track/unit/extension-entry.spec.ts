// The merged extension (extension/): manifest, the popup → side panel entry, and the archive check moved out of panel.js.
// chrome APIs are stand-ins; nothing is installed in a browser.
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../../../extension/", import.meta.url);
const manifest = async () => JSON.parse(await readFile(new URL("manifest.json", ROOT), "utf8"));

test("the manifest opens the popup, keeps the side panel and joins both permission sets", async () => {
  const m = await manifest();
  expect([m.name, m.version, m.manifest_version]).toEqual(["JobSeeker", "0.8.0", 3]);
  expect(m.action.default_popup).toBe("popup.html");
  expect(m.side_panel.default_path).toBe("panel.html");
  expect(m.background).toEqual({ service_worker: "background.js", type: "module" });
  expect(m.options_page).toBe("options.html");
  expect([...m.permissions].sort()).toEqual(["activeTab", "scripting", "sidePanel", "storage", "tabs", "webNavigation"]);
  for (const host of ["http://localhost/*", "http://127.0.0.1/*", "https://*.incruit.com/*", "https://*.saramin.co.kr/*",
    "https://*.jobkorea.co.kr/*", "http://localhost:8000/*", "http://127.0.0.1:8000/*", "https://team-api.duckdns.org/*"]) {
    expect(m.host_permissions).toContain(host);
  }
  expect(m.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
  expect(m.externally_connectable.matches).toEqual(["http://localhost:5173/*", "http://127.0.0.1:5173/*"]);
  expect(typeof m.key).toBe("string");
  expect(m.key.length).toBeGreaterThan(300);
});

type Listener = (...args: unknown[]) => unknown;
function chromeStub() {
  const listeners: Record<string, Listener[]> = {};
  const event = (name: string) => ({ addListener: (fn: Listener) => { (listeners[name] ??= []).push(fn); } });
  const calls: { method: string; args: unknown }[] = [];
  const stub = {
    runtime: { id: "self", onInstalled: event("onInstalled"), onMessage: event("onMessage"), onMessageExternal: event("onMessageExternal"),
      sendMessage: async () => undefined, getManifest: () => ({ version: "0.8.0", externally_connectable: { matches: ["http://localhost:5173/*"] } }) },
    action: { onClicked: event("onClicked"), setBadgeBackgroundColor: (a: unknown) => calls.push({ method: "badgeColor", args: a }),
      setBadgeText: (a: unknown) => calls.push({ method: "badgeText", args: a }) },
    sidePanel: { setPanelBehavior: async () => undefined, open: async (a: unknown) => { calls.push({ method: "sidePanel.open", args: a }); } },
    tabs: { onCreated: event("tabs.onCreated"), onUpdated: event("tabs.onUpdated"), onRemoved: event("tabs.onRemoved"),
      get: async (id: number) => ({ id, windowId: 3, url: "https://jobs.example.com/apply" }), sendMessage: async () => undefined },
    webNavigation: { onCreatedNavigationTarget: event("nav.created"), onCommitted: event("nav.committed"), onCompleted: event("nav.completed") },
    scripting: { executeScript: async (a: { files?: string[] }) => { calls.push({ method: "executeScript", args: a }); return a.files ? [] : [{ result: { url: "https://jobs.example.com/apply" } }]; } },
    storage: { session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      local: { get: async () => ({}), set: async () => undefined, setAccessLevel: () => undefined } },
  };
  return { stub, listeners, calls };
}

test("the popup's Fill button connects the tab through the background", async () => {
  const { stub, listeners, calls } = chromeStub();
  (globalThis as { chrome?: unknown }).chrome = stub;
  await import(new URL("background.js", ROOT).href);
  const [onMessage] = listeners.onMessage;
  const reply = await new Promise((resolve) => {
    const keep = onMessage({ type: "JS_CONNECT_TAB", tabId: 7 }, { id: "self" }, resolve);
    expect(keep).toBe(true); // answers asynchronously
  });
  expect(reply).toEqual({ ok: true });
  const scripted = calls.filter((c) => c.method === "executeScript").map((c) => (c.args as { target: { tabId: number } }).target.tabId);
  expect(scripted.length).toBeGreaterThan(0);
  expect(new Set(scripted)).toEqual(new Set([7]));
  expect(calls).toContainEqual({ method: "badgeText", args: { tabId: 7, text: "ON" } });

  calls.length = 0;
  const ignored = onMessage({ type: "JS_CONNECT_TAB", tabId: 7 }, { id: "another-extension" }, () => undefined);
  expect(ignored).toBeUndefined();
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toEqual([]);
});

test("validateArchive moved to archive.js keeps the panel's rules", async () => {
  const { validateArchive } = await import(new URL("archive.js", ROOT).href);
  const clean = validateArchive({ profile: { name: "홍길동" }, education: [{ school: "한국대" }] });
  expect(clean.profile.name).toBe("홍길동");
  expect(clean.education[0].school).toBe("한국대");
  expect(() => validateArchive([])).toThrow("Not a valid archive.");
  expect(() => validateArchive({ education: "x" })).toThrow("Check the record list format.");
  expect(() => validateArchive({ profile: { name: "x".repeat(20001) } })).toThrow("20,000 characters");
});
