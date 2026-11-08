#!/usr/bin/env node
// Downloads a static FFmpeg build into src-tauri/binaries/ so Tauri can bundle it as a sidecar.
// Usage: node scripts/fetch-ffmpeg.mjs [--target <rust-target-triple>]
// Builds come from https://github.com/eugeneware/ffmpeg-static (GPL, includes libx264 + AAC).
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const RELEASE = process.env.FFMPEG_STATIC_RELEASE || "b6.1.1";
const ASSETS = {
  "aarch64-apple-darwin": "ffmpeg-darwin-arm64",
  "x86_64-apple-darwin": "ffmpeg-darwin-x64",
  "x86_64-pc-windows-msvc": "ffmpeg-win32-x64",
  "x86_64-unknown-linux-gnu": "ffmpeg-linux-x64",
  "aarch64-unknown-linux-gnu": "ffmpeg-linux-arm64",
};

function hostTriple() {
  try {
    const m = /host:\s*(\S+)/.exec(execSync("rustc -vV", { encoding: "utf8" }));
    if (m) return m[1];
  } catch {
    /* no rustc: guess from node */
  }
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  return `${arch}-unknown-linux-gnu`;
}

const i = process.argv.indexOf("--target");
const target = i > 0 ? process.argv[i + 1] : hostTriple();
const asset = ASSETS[target];
if (!asset) {
  console.error(`No FFmpeg build mapped for ${target}. Known: ${Object.keys(ASSETS).join(", ")}`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries");
const out = join(outDir, `ffmpeg-${target}${target.includes("windows") ? ".exe" : ""}`);
mkdirSync(outDir, { recursive: true });
if (existsSync(out) && statSync(out).size > 1_000_000 && !process.argv.includes("--force")) {
  console.log(`FFmpeg already present: ${out}`);
  process.exit(0);
}

const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}/${asset}.gz`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const bin = gunzipSync(Buffer.from(await res.arrayBuffer()));
writeFileSync(out, bin);
chmodSync(out, 0o755);
console.log(`Saved ${out} (${(bin.length / 1e6).toFixed(1)} MB)`);
