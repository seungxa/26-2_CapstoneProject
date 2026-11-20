#!/usr/bin/env node
// 시선 방향 실측 전용 실행기(Windows·macOS·Linux). 카메라가 있는 노트북에서 실험실 화면만 띄운다.
// 로그인·연습 서버·파이썬이 필요 없다. 브라우저 밖으로 영상이나 좌표를 보내지 않는다.
// 사용: 저장소 루트에서 `cd frontend && npm ci` 한 번 → `node scripts/practice-track/start-gaze-lab.mjs`
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const frontend = join(repo, "frontend");
const vite = join(frontend, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(vite)) {
  console.error("Frontend packages are missing. Run `npm ci` inside the frontend folder first.");
  process.exit(2);
}
let revision = "unknown";
try {
  revision = execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch { /* git이 없어도 실험실은 돈다 */ }
const port = "5181";
const url = `http://localhost:${port}/src/features/practice-track/dev/gaze-lab.html`;
console.log(`Gaze direction lab (dev only). Code: ${revision}`);
console.log(`Open in Chrome on this computer: ${url}`);
console.log("The camera works only on this computer's localhost address. Stop with Ctrl-C.");
const child = spawn(process.execPath, [vite, "--host", "localhost", "--port", port, "--strictPort"], {
  cwd: frontend,
  stdio: "inherit",
  env: { ...process.env, VITE_GAZE_LAB: "true", VITE_E2E_FAKE_FACE: "false" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
