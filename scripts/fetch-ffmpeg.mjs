#!/usr/bin/env node
// Downloads a static FFmpeg build into src-tauri/binaries/ so Tauri can bundle it as a sidecar.
// Usage: node scripts/fetch-ffmpeg.mjs [--target <rust-target-triple>] [--force]
// Primary source: https://github.com/eugeneware/ffmpeg-static (FFmpeg 6, GPL, libx264 + AAC).
// Fallback (if GitHub downloads fail): static builds from martin-riedl.de (macOS, Linux) and
// gyan.dev (Windows), FFmpeg 9, also GPL with libx264. Both families pass the export tests.
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const RELEASE = process.env.FFMPEG_STATIC_RELEASE || "b6.1.1";
const PRIMARY = {
  "aarch64-apple-darwin": "ffmpeg-darwin-arm64",
  "x86_64-apple-darwin": "ffmpeg-darwin-x64",
  "x86_64-pc-windows-msvc": "ffmpeg-win32-x64",
  "x86_64-unknown-linux-gnu": "ffmpeg-linux-x64",
  "aarch64-unknown-linux-gnu": "ffmpeg-linux-arm64",
};
const FALLBACK = {
  "aarch64-apple-darwin": "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip",
  "x86_64-apple-darwin": "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip",
  "x86_64-unknown-linux-gnu": "https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffmpeg.zip",
  "x86_64-pc-windows-msvc": "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip",
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
if (!PRIMARY[target]) {
  console.error(`No FFmpeg build mapped for ${target}. Known: ${Object.keys(PRIMARY).join(", ")}`);
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

async function download(url, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(url).catch((e) => ({ ok: false, status: String(e) }));
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    console.error(`  attempt ${attempt} failed: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return null;
}

function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
  return null;
}

let done = false;
const primary = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}/${PRIMARY[target]}.gz`;
console.log(`Downloading ${primary}`);
let gz = await download(primary, 2);
if (!gz) {
  // The release CDN link can fail while the API still serves the same file.
  console.log("Trying the GitHub API asset endpoint");
  const rel = await fetch(`https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/${RELEASE}`, { headers: { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const asset = rel?.assets?.find((a) => a.name === `${PRIMARY[target]}.gz`);
  if (asset) {
    const r = await fetch(asset.url, { headers: { Accept: "application/octet-stream" } }).catch(() => null);
    if (r?.ok) gz = Buffer.from(await r.arrayBuffer());
  }
}
if (gz) {
  writeFileSync(out, gunzipSync(gz));
  done = true;
} else if (FALLBACK[target]) {
  const url = FALLBACK[target];
  console.log(`GitHub download failed; trying ${url}`);
  const zip = await download(url);
  if (zip) {
    const tmp = mkdtempSync(join(tmpdir(), "lahlah-ffmpeg-"));
    const zipPath = join(tmp, "ffmpeg.zip");
    writeFileSync(zipPath, zip);
    // bsdtar reads zip files on macOS and Windows 10+; unzip is standard on Linux runners.
    if (process.platform === "linux") execFileSync("unzip", ["-q", "-o", zipPath, "-d", tmp]);
    else execFileSync("tar", ["-xf", zipPath, "-C", tmp]);
    const bin = findFile(tmp, target.includes("windows") ? "ffmpeg.exe" : "ffmpeg");
    if (bin) {
      copyFileSync(bin, out);
      done = true;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}
if (!done) {
  console.error("Could not download FFmpeg from any source");
  process.exit(1);
}
chmodSync(out, 0o755);
console.log(`Saved ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
