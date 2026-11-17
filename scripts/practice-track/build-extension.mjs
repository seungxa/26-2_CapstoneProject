#!/usr/bin/env node
// Build the JobSeeker extension zip that the Apply page offers (frontend/public/downloads/).
//   node scripts/practice-track/build-extension.mjs [--web-origin URL]... [--api-url URL] [--out DIR]
//   node scripts/practice-track/build-extension.mjs --check   (does the committed zip match extension/?)
// Fills manifest.externally_connectable and host_permissions and the default addresses in config.js. The same input
// always gives the same bytes: files in name order, a fixed time stamp, Node's zlib only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = join(REPO, "extension");
const DEFAULT_OUT = join(REPO, "frontend", "public", "downloads");
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const DEFAULT_API = "https://team-api.duckdns.org";
/** Development and documentation files that users do not need */
const LEFT_OUT = (name) => name.startsWith("tests/") || name.startsWith("demo") || name.endsWith(".md") || name === "package.json";

function parse(argv) {
  const args = { webOrigins: [], apiUrl: DEFAULT_API, out: DEFAULT_OUT, check: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--check") args.check = true;
    else if (["--web-origin", "--api-url", "--out"].includes(flag) && argv[i + 1]) {
      const value = argv[++i];
      if (flag === "--out") args.out = value;
      else {
        const origin = new URL(value).origin;
        if (flag === "--web-origin") args.webOrigins.push(origin);
        else args.apiUrl = origin;
      }
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

/** Files git tracks in extension/ (stray local files never ship); without git, every non-hidden file */
function files(dir) {
  try {
    const out = execFileSync("git", ["-C", REPO, "ls-files", "-z", "--", "extension"], { encoding: "utf8" });
    const tracked = out.split("\0").filter(Boolean).map((p) => p.slice("extension/".length));
    if (tracked.length) return tracked.sort();
  } catch { /* not a git checkout */ }
  return readdirSync(dir).filter((name) => !name.startsWith(".")).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path).map((f) => `${name}/${f}`) : [relative(SOURCE, path).split("\\").join("/")];
  }).sort();
}

function contents(webOrigins, apiUrl) {
  const manifest = JSON.parse(readFileSync(join(SOURCE, "manifest.json"), "utf8"));
  const pattern = (origin) => `${origin}/*`;
  manifest.externally_connectable.matches = [...new Set([...DEV_ORIGINS, ...webOrigins].map(pattern))];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, pattern(apiUrl)])];
  const webUrl = webOrigins[0] ?? DEV_ORIGINS[0];
  const config = `// Written by scripts/practice-track/build-extension.mjs\nexport const CONFIG = {\n  apiUrl: ${JSON.stringify(apiUrl)},\n  webUrl: ${JSON.stringify(webUrl)},\n};\n`;
  return files(SOURCE).filter((name) => !LEFT_OUT(name)).map((name) => [name,
    name === "manifest.json" ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
      : name === "config.js" ? Buffer.from(config) : readFileSync(join(SOURCE, name))]);
}

/** A zip with deflate, DOS time 1980-01-01 00:00 and 0644 file modes */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function build({ webOrigins, apiUrl }) {
  const bytes = zip(contents(webOrigins, apiUrl));
  const version = JSON.parse(readFileSync(join(SOURCE, "manifest.json"), "utf8")).version;
  let commit = "unknown";
  try { commit = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
  const info = { version, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    source_commit: commit, web_origins: webOrigins, api_url: apiUrl };
  return { bytes, info };
}

const args = parse(process.argv.slice(2));
if (args.check) {
  const committed = JSON.parse(readFileSync(join(DEFAULT_OUT, "extension.json"), "utf8"));
  const { bytes } = build({ webOrigins: committed.web_origins, apiUrl: committed.api_url });
  const current = readFileSync(join(DEFAULT_OUT, "jobseeker-extension.zip"));
  if (!bytes.equals(current)) {
    console.error("frontend/public/downloads/jobseeker-extension.zip is out of date: run scripts/practice-track/build-extension.mjs and commit the result.");
    process.exit(1);
  }
  console.log("The committed zip matches extension/.");
} else {
  const { bytes, info } = build(args);
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, "jobseeker-extension.zip"), bytes);
  writeFileSync(join(args.out, "extension.json"), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`Built ${info.version}: ${info.size} bytes, sha256 ${info.sha256}`);
}
