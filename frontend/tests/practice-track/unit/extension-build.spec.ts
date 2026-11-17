// scripts/practice-track/build-extension.mjs: the zip the Apply page offers.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("../../../../", import.meta.url).pathname;
const SCRIPT = join(REPO, "scripts/practice-track/build-extension.mjs");
const build = (...args: string[]) => {
  const out = mkdtempSync(join(tmpdir(), "ext-build-"));
  execFileSync(process.execPath, [SCRIPT, "--out", out, ...args], { cwd: REPO });
  return out;
};
/** The zip's entries and a file's text, read with Python's zipfile (an independent reader) */
const unzip = (zip: string, name?: string) => execFileSync("python3", ["-I", "-c",
  "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.read(sys.argv[2]).decode() if len(sys.argv)>2 else '\\n'.join(z.namelist()))",
  zip, ...(name ? [name] : [])], { encoding: "utf8" });
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("the same input builds the same bytes", () => {
  const a = build("--web-origin", "https://team.example.app");
  const b = build("--web-origin", "https://team.example.app");
  expect(sha(join(a, "jobseeker-extension.zip"))).toBe(sha(join(b, "jobseeker-extension.zip")));
});

test("the zip carries the web origin, the API address and only the extension's runtime files", () => {
  const out = build("--web-origin", "https://team.example.app", "--api-url", "https://api.example.app");
  const zip = join(out, "jobseeker-extension.zip");
  const names = unzip(zip).trim().split("\n");
  expect(names).toContain("manifest.json");
  expect(names).toContain("popup.html");
  expect(names).toContain("panel.js");
  expect(names).toContain("icons/icon128.png");
  expect(names.some((n) => n.startsWith("tests/") || n.startsWith("demo") || n === "package.json")).toBe(false);
  const manifest = JSON.parse(unzip(zip, "manifest.json"));
  expect(manifest.externally_connectable.matches).toContain("https://team.example.app/*");
  expect(manifest.externally_connectable.matches).toContain("http://localhost:5173/*");
  expect(manifest.host_permissions).toContain("https://api.example.app/*");
  const config = unzip(zip, "config.js");
  expect(config).toContain('apiUrl: "https://api.example.app"');
  expect(config).toContain('webUrl: "https://team.example.app"');
  const info = JSON.parse(readFileSync(join(out, "extension.json"), "utf8"));
  expect(info).toMatchObject({ version: "0.8.0", sha256: sha(zip), web_origins: ["https://team.example.app"], api_url: "https://api.example.app" });
  expect(info.size).toBe(readFileSync(zip).length);
});

test("test_committed_zip_matches_the_source", () => {
  // --check rebuilds with the arguments recorded in the committed extension.json and compares the bytes
  expect(() => execFileSync(process.execPath, [SCRIPT, "--check"], { cwd: REPO, stdio: "pipe" })).not.toThrow();
});
