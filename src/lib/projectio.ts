// Save, load, auto-save and recent projects (.lahlah = JSON).
import { Project } from "./types";
import { isDesktop, refreshUrls } from "./platform";
import { layoutMain } from "./project";

const AUTOSAVE_KEY = "lahlah.autosave";
const RECENT_KEY = "lahlah.recent";

export interface RecentEntry {
  path: string;
  name: string;
  at: number;
}

export function serialise(p: Project): string {
  const media = p.media.map((m) => {
    const keepUrl = /^https?:/.test(m.url) || m.url.startsWith("data:");
    return { ...m, url: keepUrl ? m.url : "", thumb: m.thumb?.startsWith("data:") && m.thumb.length < 60_000 ? m.thumb : undefined };
  });
  return JSON.stringify({ ...p, media }, null, 2);
}

export function deserialise(text: string): Project {
  const raw = JSON.parse(text);
  if (raw?.schema !== "lahlah-project/1" || !Array.isArray(raw.clips) || !Array.isArray(raw.tracks)) {
    throw new Error("This is not a LahLah Video project file.");
  }
  const p = raw as Project;
  return layoutMain({ ...p, media: p.media.map((m) => refreshUrls(m)) });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function autosaveLocal(p: Project) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialise(p));
    } catch {
      /* storage full: skip */
    }
  }, 1200);
}

export function loadAutosave(): Project | null {
  try {
    const t = localStorage.getItem(AUTOSAVE_KEY);
    if (!t) return null;
    const p = deserialise(t);
    // Browser blob: URLs do not survive a reload; drop media we can no longer play.
    if (!isDesktop) p.media = p.media.filter((m) => m.url);
    const ids = new Set(p.media.map((m) => m.id));
    p.clips = p.clips.filter((c) => !c.mediaId || ids.has(c.mediaId));
    return p.clips.length || p.media.length ? layoutMain(p) : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
}

export function recents(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addRecent(path: string, name: string) {
  const list = [{ path, name, at: Date.now() }, ...recents().filter((r) => r.path !== path)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

export function safeFileName(s: string) {
  return (s || "Untitled").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
}
