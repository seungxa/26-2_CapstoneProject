import { expect, test } from "@playwright/test";
import { createApiClient } from "../../../src/features/practice-track/api";

test.describe.configure({ mode: "serial" });
let original: typeof fetch;
test.beforeEach(() => { original = globalThis.fetch; });
test.afterEach(() => { globalThis.fetch = original; });

test("host supplies API origin and current access token without URL credentials", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return Response.json([]); };
  const client = createApiClient({ baseUrl: "https://api.example.test", getAccessToken: async () => "ephemeral-test-token" });
  await client.applications();
  expect(seen?.url).toBe("https://api.example.test/track/applications");
  expect(seen?.init?.headers).toMatchObject({ Authorization: "Bearer ephemeral-test-token" });
});

test("one host refresh retries a read but never repeats a write", async () => {
  let calls = 0, refreshes = 0;
  globalThis.fetch = async () => { calls++; return calls % 2 ? Response.json({detail:"expired"}, {status:401}) : Response.json([]); };
  const client = createApiClient({ baseUrl: "https://api.example.test", onUnauthorized: async () => { refreshes++; } });
  await client.applications();
  expect(calls).toBe(2); expect(refreshes).toBe(1);
  await expect(client.createApplication({company:"会社",position:"開発"})).rejects.toMatchObject({status:401});
  expect(calls).toBe(3); expect(refreshes).toBe(2);
});

test("account reset rejects a late response instead of showing the previous user's data", async () => {
  let finish!: (r: Response) => void;
  globalThis.fetch = () => new Promise<Response>(resolve => { finish = resolve; });
  const client = createApiClient({ baseUrl: "https://api.example.test" });
  const pending = client.applications();
  await Promise.resolve(); await Promise.resolve();
  client.resetSession();
  finish(Response.json([{id:"old-user-record"}]));
  await expect(pending).rejects.toMatchObject({name:"AbortError"});
});

test("account reset also rejects a response whose JSON body is still being read", async () => {
  let finish!: (value: unknown) => void;
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  globalThis.fetch = async () => ({ok:true,status:200,json:() => { reading(); return new Promise(resolve => { finish = resolve; }); }}) as Response;
  const client = createApiClient({baseUrl:"https://api.example.test"});
  const pending = client.applications();
  await started;
  client.resetSession();
  finish([{id:"previous-user"}]);
  await expect(pending).rejects.toMatchObject({name:"AbortError"});
});

test("recording load errors are English and say what to do", async () => {
  const hangul = /[가-힣]/;
  const client = createApiClient({ baseUrl: "https://api.example.test" });
  const failWith = async (response: Response) => {
    globalThis.fetch = async () => response;
    return client.audioUrl("a1").then(() => { throw new Error("expected a failure"); }, (e: Error) => e);
  };
  // 404: the server's sentence tells a deleted original apart from a missing file
  const deleted = await failWith(Response.json({ detail: "The original recording was deleted." }, { status: 404 }));
  expect([(deleted as { status?: number }).status, deleted.message]).toEqual([404, "The original recording was deleted."]);
  const missing = await failWith(new Response("", { status: 404 }));
  expect([(missing as { status?: number }).status, missing.message]).toEqual([404, "The recording wasn't found."]);
  const storage = await failWith(Response.json({ detail: "Could not reach recording storage. Try again in a moment." }, { status: 502 }));
  expect([(storage as { status?: number }).status, storage.message]).toEqual([502, "Couldn't load the recording. Try again."]);
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const offline = await client.audioUrl("a1").then(() => null, (e: Error) => e);
  expect(offline?.message).toBe("Couldn't load the recording. Try again.");
  for (const e of [deleted, missing, storage, offline]) expect(e?.message).not.toMatch(hangul);
});

test("a request canceled by an account change says so in English", async () => {
  let finish!: (r: Response) => void;
  globalThis.fetch = () => new Promise<Response>(resolve => { finish = resolve; });
  const client = createApiClient({ baseUrl: "https://api.example.test" });
  const pending = client.audioUrl("a1");
  await Promise.resolve(); await Promise.resolve();
  client.resetSession();
  finish(new Response(new Blob(["x"]), { status: 200 }));
  const error = await pending.then(() => null, (e: Error) => e);
  expect(error).toMatchObject({ name: "AbortError" });
  expect(error?.message).not.toMatch(/[가-힣]/);
});
