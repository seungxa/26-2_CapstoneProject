import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/features/practice-track/styles.css"), "utf8");

function tokens(): Record<string, string> {
  const block = /\.practice-track\.practice-track\s*\{([^}]*)\}/.exec(css);
  if (!block) throw new Error("root block not found");
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("text tokens reach 4.5:1 on surface and page background", () => {
  const t = tokens();
  for (const name of ["--text", "--text-2", "--muted", "--accent", "--good-text", "--warn-text", "--bad-text"]) {
    for (const bg of ["--surface", "--bg"]) {
      expect(contrast(t[name], t[bg]), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(contrast("#ffffff", t["--accent"]), "white on --accent").toBeGreaterThanOrEqual(4.5);
});

test("uses the team palette and has no dark override", () => {
  const t = tokens();
  expect(t["--accent"]).toBe("#2563eb");
  expect(t["--surface"]).toBe("#ffffff");
  expect(t["--bg"]).toBe("#f8fafc");
  expect(t["--radius"]).toBe("12px");
  expect(css).not.toContain("prefers-color-scheme: dark");
});
