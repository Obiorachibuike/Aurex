import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import chromium from "@sparticuz/chromium";
import { chromium as playwright, type Browser } from "playwright-core";

const require = createRequire(import.meta.url);

/**
 * Launches headless Chromium without a system browser install.
 * Uses CHROME_PATH when provided; otherwise the @sparticuz/chromium binary, unpacking the
 * shared libraries it normally expects from AWS Lambda so it also runs on plain Linux/CI.
 */
export async function launchBrowser(): Promise<Browser> {
  if (process.env.CHROME_PATH) return playwright.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const libDir = path.join(tmpdir(), "aurex-chromium-libs");
  if (!existsSync(path.join(libDir, "lib"))) {
    mkdirSync(libDir, { recursive: true });
    const pkgDir = path.resolve(path.dirname(require.resolve("@sparticuz/chromium")), "..");
    const tar = path.join(libDir, "al2023.tar");
    writeFileSync(tar, brotliDecompressSync(readFileSync(path.join(pkgDir, "bin", "al2023.tar.br"))));
    execFileSync("tar", ["-xf", tar, "-C", libDir]);
  }
  const executablePath = await chromium.executablePath();
  return playwright.launch({ executablePath, headless: true, args: chromium.args.filter((a) => a !== "--single-process"), env: { ...process.env, LD_LIBRARY_PATH: [path.join(libDir, "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } as Record<string, string> });
}
