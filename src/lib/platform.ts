// Everything that touches the OS lives here. In the desktop app it uses Tauri plugins;
// in the browser-only dev mode (`npm run dev`) it falls back to web APIs or a clear message.
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { MediaItem, MediaKind } from "./types";
import { uid } from "./project";
import { parseProbe } from "../export/ffmpeg";

export const isDesktop = (() => {
  try {
    return isTauri();
  } catch {
    return false;
  }
})();

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";

const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"];

export function kindOf(name: string, mime = ""): MediaKind | null {
  const ext = name.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("video/") || VIDEO_EXT.includes(ext)) return "video";
  if (mime.startsWith("image/") || IMAGE_EXT.includes(ext)) return "image";
  if (mime.startsWith("audio/") || AUDIO_EXT.includes(ext)) return "audio";
  return null;
}

export const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
export const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, "");

// ---------------- metadata and thumbnails ----------------

export function loadMeta(url: string, kind: MediaKind): Promise<{ duration: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const done = (v: { duration: number; width?: number; height?: number }) => resolve(v);
    const timer = setTimeout(() => done({ duration: kind === "image" ? 0 : 5 }), 8000);
    if (kind === "image") {
      const img = new Image();
      img.onload = () => {
        clearTimeout(timer);
        done({ duration: 0, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        clearTimeout(timer);
        done({ duration: 0 });
      };
      img.src = url;
      return;
    }
    const el = document.createElement(kind === "video" ? "video" : "audio") as HTMLVideoElement;
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      done({ duration: isFinite(el.duration) ? el.duration : 5, width: el.videoWidth || undefined, height: el.videoHeight || undefined });
    };
    el.onerror = () => {
      clearTimeout(timer);
      done({ duration: 5 });
    };
    el.src = url;
  });
}

/** Browser mode thumbnail: grab a frame from a same-origin blob URL. */
function browserThumb(url: string, kind: MediaKind): Promise<string | undefined> {
  if (kind === "image") return Promise.resolve(url);
  if (kind !== "video") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    const fail = setTimeout(() => resolve(undefined), 6000);
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 160;
        c.height = Math.round((160 * (v.videoHeight || 9)) / (v.videoWidth || 16));
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        clearTimeout(fail);
        resolve(c.toDataURL("image/jpeg", 0.7));
      } catch {
        resolve(undefined);
      }
    };
    v.onerror = () => resolve(undefined);
  });
}

export async function mediaFromFile(file: File): Promise<MediaItem | null> {
  const kind = kindOf(file.name, file.type);
  if (!kind) return null;
  const url = URL.createObjectURL(file);
  const meta = await loadMeta(url, kind);
  return { id: uid("med"), name: file.name, kind, url, ...meta, hasAudio: kind !== "image", thumb: await browserThumb(url, kind), origin: "local" };
}

export async function mediaFromPath(path: string, origin: MediaItem["origin"] = "local"): Promise<MediaItem | null> {
  const kind = kindOf(path);
  if (!kind) return null;
  const url = convertFileSrc(path);
  let meta: { duration: number; width?: number; height?: number } = { duration: kind === "image" ? 0 : 5 };
  let hasAudio = kind === "audio";
  try {
    const pr = await probe(path);
    meta = { duration: kind === "image" ? 0 : pr.duration ?? 5, width: pr.width, height: pr.height };
    hasAudio = pr.hasAudio;
  } catch {
    meta = await loadMeta(url, kind);
    hasAudio = kind !== "image";
  }
  let thumb: string | undefined;
  if (kind === "image") thumb = url;
  else if (kind === "video") thumb = await ffmpegThumb(path).catch(() => undefined);
  return { id: uid("med"), name: baseName(path), kind, path, url, ...meta, hasAudio, thumb, origin };
}

// ---------------- FFmpeg sidecar ----------------

export interface RunHandle {
  done: Promise<{ code: number | null; stderr: string }>;
  cancel: () => void;
}

export async function runFfmpeg(args: string[], onStdout?: (line: string) => void): Promise<RunHandle> {
  if (!isDesktop) throw new Error("Export needs the desktop app. Install LahLah Video for Mac or Windows to export MP4 files.");
  const { Command } = await import("@tauri-apps/plugin-shell");
  const cmd = Command.sidecar("binaries/ffmpeg", args);
  let stderr = "";
  let resolveDone!: (v: { code: number | null; stderr: string }) => void;
  const done = new Promise<{ code: number | null; stderr: string }>((r) => (resolveDone = r));
  cmd.stdout.on("data", (line) => onStdout?.(String(line)));
  cmd.stderr.on("data", (line) => {
    stderr += String(line) + "\n";
    if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
  });
  cmd.on("close", (e) => resolveDone({ code: e.code, stderr }));
  cmd.on("error", (e) => resolveDone({ code: -1, stderr: stderr + "\n" + String(e) }));
  const child = await cmd.spawn();
  return { done, cancel: () => void child.kill().catch(() => undefined) };
}

export async function probe(path: string) {
  const h = await runFfmpeg(["-hide_banner", "-i", path]);
  const { stderr } = await h.done;
  return parseProbe(stderr);
}

export async function cacheDir(sub: string): Promise<string> {
  const { appCacheDir, join } = await import("@tauri-apps/api/path");
  const { mkdir } = await import("@tauri-apps/plugin-fs");
  const dir = await join(await appCacheDir(), sub);
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  return dir;
}

async function ffmpegThumb(path: string): Promise<string | undefined> {
  const { join } = await import("@tauri-apps/api/path");
  const out = await join(await cacheDir("thumbs"), `${uid("th")}.jpg`);
  const h = await runFfmpeg(["-hide_banner", "-y", "-ss", "0.5", "-i", path, "-frames:v", "1", "-vf", "scale=240:-2", out]);
  const r = await h.done;
  if (r.code !== 0) {
    const h2 = await runFfmpeg(["-hide_banner", "-y", "-i", path, "-frames:v", "1", "-vf", "scale=240:-2", out]);
    if ((await h2.done).code !== 0) return undefined;
  }
  return convertFileSrc(out);
}

// ---------------- files ----------------

export async function pickMediaPaths(kind?: MediaKind): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const ext = kind === "audio" ? AUDIO_EXT : kind === "image" ? IMAGE_EXT : kind === "video" ? VIDEO_EXT : [...VIDEO_EXT, ...IMAGE_EXT, ...AUDIO_EXT];
  const res = await open({ multiple: true, directory: false, filters: [{ name: "Media", extensions: ext }] });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

/** Browser fallback file picker. */
export function pickBrowserFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

export async function openTextFile(exts: string[], title: string): Promise<{ path?: string; name: string; text: string } | null> {
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, title, filters: [{ name: title, extensions: exts }] });
    if (!path || Array.isArray(path)) return null;
    return { path, name: baseName(path), text: await readTextFile(path) };
  }
  const [file] = await pickBrowserFiles(exts.map((e) => "." + e).join(","), false);
  if (!file) return null;
  return { name: file.name, text: await file.text() };
}

export async function readText(path: string): Promise<string> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

export async function saveTextFile(defaultName: string, text: string, exts: string[], existingPath?: string): Promise<string | null> {
  if (isDesktop) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    let path = existingPath;
    if (!path) {
      const { documentDir, join } = await import("@tauri-apps/api/path");
      const def = await join(await documentDir(), defaultName);
      path = (await save({ defaultPath: def, filters: [{ name: exts[0].toUpperCase(), extensions: exts }] })) ?? undefined;
    }
    if (!path) return null;
    await writeTextFile(path, text);
    return path;
  }
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return defaultName;
}

export async function writeBinary(path: string, data: Uint8Array) {
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, data);
}

export async function joinPath(...parts: string[]) {
  const { join } = await import("@tauri-apps/api/path");
  return join(...parts);
}

export async function ensureDir(dir: string) {
  const { mkdir } = await import("@tauri-apps/plugin-fs");
  await mkdir(dir, { recursive: true }).catch(() => undefined);
}

export async function fileExists(path: string) {
  const { exists } = await import("@tauri-apps/plugin-fs");
  return exists(path).catch(() => false);
}

export async function copyFileTo(from: string, to: string) {
  const { copyFile } = await import("@tauri-apps/plugin-fs");
  await copyFile(from, to);
}

/** ~/Movies/LahLah Video on Mac, Videos\LahLah Video on Windows. */
export async function defaultExportDir(): Promise<string> {
  const { videoDir, join } = await import("@tauri-apps/api/path");
  const dir = await join(await videoDir(), "LahLah Video");
  await ensureDir(dir);
  return dir;
}

export async function pickSavePath(defaultPath: string, ext: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })) ?? null;
}

export async function pickFolder(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false, title });
  return typeof r === "string" ? r : null;
}

export async function reveal(path: string) {
  if (!isDesktop) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path).catch(() => undefined);
}

export async function openExternal(url: string) {
  if (isDesktop) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url).catch(() => window.open(url, "_blank"));
  } else window.open(url, "_blank", "noopener");
}

export async function setWindowTitle(title: string) {
  if (isDesktop) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title).catch(() => undefined);
  } else document.title = title;
}

/** Fetch a URL (Higgsfield asset links, Whisper API) without browser CORS limits on desktop. */
export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isDesktop) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, init);
  }
  return fetch(url, init);
}

function nameFromUrl(url: string, contentType: string | null, i: number): string {
  let base = "";
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    base = "";
  }
  base = base.replace(/[^\w.\- ]+/g, "_").slice(-80);
  if (!kindOf(base)) {
    const ext = contentType?.includes("image/png") ? "png" : contentType?.includes("image/") ? "jpg" : contentType?.includes("audio/") ? "mp3" : "mp4";
    base = `${base || "higgsfield-clip"}-${i + 1}.${ext}`;
  }
  return base;
}

/** Download a remote file into the app's media folder and return a MediaItem. */
export async function importUrl(url: string, i = 0, origin: MediaItem["origin"] = "higgsfield", saveDir?: string): Promise<MediaItem> {
  if (!/^https?:\/\//i.test(url)) throw new Error(`Not a web link: ${url}`);
  if (!isDesktop) {
    // Browser mode streams straight from the link; export still needs the desktop app.
    const kind = kindOf(url) ?? "video";
    const meta = await loadMeta(url, kind);
    return { id: uid("med"), name: nameFromUrl(url, null, i), kind, url, ...meta, hasAudio: kind !== "image", origin };
  }
  const res = await httpFetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const name = nameFromUrl(url, res.headers.get("content-type"), i);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dir = saveDir ?? (await cacheDir("downloads"));
  await ensureDir(dir);
  const path = await joinPath(dir, `${Date.now().toString(36)}-${name}`);
  await writeBinary(path, bytes);
  const m = await mediaFromPath(path, origin);
  if (!m) throw new Error(`Downloaded ${name}, but it is not a video, image or audio file.`);
  return m;
}

/** Re-create preview URLs after loading a saved project. */
export function refreshUrls<T extends MediaItem>(m: T): T {
  if (isDesktop && m.path) return { ...m, url: convertFileSrc(m.path), thumb: m.kind === "image" ? convertFileSrc(m.path) : m.thumb };
  return m;
}
