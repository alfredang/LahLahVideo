// High-level actions shared by buttons, keyboard shortcuts, the command bar and deep links.
import { apply, clock, pause, project, replaceProject, seek, selected, setUI, ui } from "./lib/store";
import { Clip, MediaItem, MediaKind, Project } from "./lib/types";
import {
  addCaption,
  addMediaToTimeline,
  clipEnd,
  clipsOnTrack,
  duplicateClip,
  firstTrackOfType,
  mainTrack,
  newProject,
  removeClips,
  splitAt,
  touch,
  totalDuration,
} from "./lib/project";
import {
  baseName,
  cacheDir,
  dirName,
  ensureDir,
  isDesktop,
  joinPath,
  mediaFromFile,
  mediaFromPath,
  openTextFile,
  pickBrowserFiles,
  pickMediaPaths,
  readText,
  saveTextFile,
  setWindowTitle,
  importUrl,
} from "./lib/platform";
import { toast } from "./lib/toast";
import { addRecent, deserialise, safeFileName, serialise } from "./lib/projectio";
import { captionsOf, checkHandoff, handoffSources, isHandoff, parseSrt, projectFromHandoff, toSrt } from "./lib/handoff";

/** The clip a command acts on: the selection, else the main-track clip under the playhead. */
export function targetClip(): Clip | null {
  const s = selected();
  if (s) return s;
  const p = project();
  const t = clock.get().t;
  const main = clipsOnTrack(p, mainTrack(p).id);
  return main.find((c) => t >= c.start && t < clipEnd(c)) ?? main[main.length - 1] ?? null;
}

export function select(id: string | null) {
  setUI({ selectedId: id });
}

// ---------------- import ----------------

function addMedia(items: MediaItem[]) {
  if (!items.length) return;
  apply((p) => touch({ ...p, media: [...p.media, ...items] }));
}

export async function importPaths(paths: string[], opts: { toTimeline?: boolean; trackId?: string } = {}) {
  const items: MediaItem[] = [];
  for (const path of paths) {
    const m = await mediaFromPath(path).catch(() => null);
    if (m) items.push(m);
    else toast(`Skipped ${baseName(path)}: not a video, image or audio file`, "error");
  }
  addMedia(items);
  if (opts.toTimeline) items.forEach((m) => addToTimeline(m.id, opts.trackId));
  if (items.length) toast(`Imported ${items.length} file${items.length > 1 ? "s" : ""}`, "ok");
  return items;
}

export async function importFiles(files: File[], opts: { toTimeline?: boolean; trackId?: string } = {}) {
  const items: MediaItem[] = [];
  for (const f of files) {
    if (/\.(lahlah|json)$/i.test(f.name)) {
      await openFromText(await f.text());
      continue;
    }
    if (/\.srt$/i.test(f.name)) {
      importSrtText(await f.text());
      continue;
    }
    const m = await mediaFromFile(f);
    if (m) items.push(m);
    else toast(`Skipped ${f.name}: not a video, image or audio file`, "error");
  }
  addMedia(items);
  if (opts.toTimeline) items.forEach((m) => addToTimeline(m.id, opts.trackId));
  if (items.length) toast(`Imported ${items.length} file${items.length > 1 ? "s" : ""}`, "ok");
  return items;
}

const ACCEPT: Record<string, string> = {
  any: "video/*,image/*,audio/*,.mov,.mkv",
  audio: "audio/*,.mp3,.wav,.m4a",
  video: "video/*",
  image: "image/*",
};

export async function importDialog(kind?: MediaKind, opts: { toTimeline?: boolean; trackId?: string } = {}) {
  if (isDesktop) return importPaths(await pickMediaPaths(kind), opts);
  return importFiles(await pickBrowserFiles(ACCEPT[kind ?? "any"]), opts);
}

export function addToTimeline(mediaId: string, trackId?: string, at?: number) {
  const p = project();
  const m = p.media.find((x) => x.id === mediaId);
  if (!m) return;
  let target = trackId;
  if (!target && m.kind === "audio") target = firstTrackOfType(p, "audio")!.id;
  const r = addMediaToTimeline(p, m, { trackId: target, at });
  apply(() => r.project);
  select(r.clip.id);
}

export async function addMusic() {
  const p = project();
  const music = p.tracks.find((t) => t.type === "audio" && /music/i.test(t.name)) ?? firstTrackOfType(p, "audio")!;
  const items = await importDialog("audio");
  for (const m of items ?? []) {
    const r = addMediaToTimeline(project(), m, { trackId: music.id, at: 0 });
    apply(() => touch({ ...r.project, clips: r.project.clips.map((c) => (c.id === r.clip.id ? { ...c, audioRole: "music", volume: 0.6 } : c)) }));
  }
}

/** Paste one or more Higgsfield (or any) download links. */
export async function importUrls(text: string): Promise<number> {
  const urls = [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
  if (!urls.length) {
    toast("Paste at least one https:// link", "error");
    return 0;
  }
  let ok = 0;
  for (let i = 0; i < urls.length; i++) {
    try {
      toast(`Fetching clip ${i + 1} of ${urls.length}…`);
      const m = await importUrl(urls[i], i);
      addMedia([m]);
      addToTimeline(m.id);
      ok++;
    } catch (e) {
      toast(String((e as Error).message ?? e), "error", 6000);
    }
  }
  if (ok) toast(`Added ${ok} Higgsfield clip${ok > 1 ? "s" : ""} to the timeline`, "ok");
  return ok;
}

// ---------------- projects and hand-off files ----------------

async function loadHandoff(json: unknown, baseDir?: string) {
  const check = checkHandoff(json);
  if (!check.ok) throw new Error(check.error);
  const h = check.handoff;
  check.warnings.forEach((w) => toast(w, "info", 6000));
  const media = new Map<string, MediaItem>();
  const sources = handoffSources(h);
  let saveDir: string | undefined;
  if (isDesktop) saveDir = baseDir ? await joinPath(baseDir, "higgsfield-downloads") : await cacheDir("downloads");
  let i = 0;
  for (const s of sources) {
    i++;
    try {
      if (/^https?:\/\//i.test(s.src)) {
        toast(`Fetching ${i} of ${sources.length}: ${baseName(s.src).slice(0, 40)}`);
        media.set(s.src, await importUrl(s.src, i, "handoff", saveDir));
      } else if (isDesktop) {
        const abs = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(s.src) ? s.src : baseDir ? await joinPath(baseDir, s.src) : s.src;
        const m = await mediaFromPath(abs, "handoff");
        if (m) media.set(s.src, m);
        else toast(`Could not read ${s.src}`, "error", 6000);
      } else {
        toast(`Browser mode cannot open local file ${s.src}. Use the desktop app or a https link.`, "error", 6000);
      }
    } catch (e) {
      toast(`Skipped ${s.src}: ${(e as Error).message}`, "error", 6000);
    }
  }
  if (!media.size) throw new Error("None of the clips in the hand-off file could be loaded.");
  const p = projectFromHandoff(h, media);
  replaceProject(p);
  toast(`Laid out ${clipsOnTrack(p, mainTrack(p).id).length} clips from "${p.name}"`, "ok", 5000);
}

export async function openFromText(text: string, path?: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    toast("That file is not valid JSON.", "error");
    return;
  }
  try {
    if (isHandoff(json)) {
      if (isDesktop && path) await ensureDir(dirName(path));
      await loadHandoff(json, path ? dirName(path) : undefined);
      return;
    }
    const p = deserialise(text);
    replaceProject(p, path?.endsWith(".lahlah") ? path : undefined);
    if (path) addRecent(path, p.name);
    toast(`Opened "${p.name}"`, "ok");
  } catch (e) {
    toast((e as Error).message, "error", 6000);
  }
}

export async function openPath(path: string) {
  try {
    await openFromText(await readText(path), path);
  } catch (e) {
    toast(`Could not open ${baseName(path)}: ${(e as Error).message}`, "error", 6000);
  }
}

export async function openDialog() {
  const f = await openTextFile(["lahlah", "json"], "LahLah project or hand-off");
  if (f) await openFromText(f.text, f.path);
}

export async function saveProject(saveAs = false) {
  const p = project();
  const path = await saveTextFile(`${safeFileName(p.name)}.lahlah`, serialise(p), ["lahlah"], saveAs ? undefined : ui().projectPath);
  if (!path) return;
  setUI({ projectPath: isDesktop ? path : undefined, dirty: false, lastSaved: Date.now() });
  if (isDesktop) addRecent(path, p.name);
  toast(isDesktop ? `Saved ${baseName(path)}` : `Downloaded ${baseName(path)}`, "ok");
}

export function newProjectAction(p?: Project) {
  pause();
  replaceProject(p ?? newProject());
  setWindowTitle("LahLah Video");
}

// ---------------- editing ----------------

export function splitHere(at?: number) {
  const t = at ?? clock.get().t;
  const r = splitAt(project(), t, ui().selectedId);
  if (r.project === project()) {
    toast("Move the playhead over a clip to split it", "info");
    return;
  }
  apply(() => r.project);
  if (at !== undefined) seek(at);
}

export function deleteSelected(ripple = false) {
  const c = targetClip();
  if (!c) return;
  apply((p) => removeClips(p, [c.id], ripple));
  select(null);
}

export function duplicateSelected() {
  const c = targetClip();
  if (!c) return;
  const r = duplicateClip(project(), c.id);
  apply(() => r.project);
  if (r.clip) select(r.clip.id);
}

export function selectRelative(which: "next" | "prev" | "first" | "last") {
  const p = project();
  const main = clipsOnTrack(p, mainTrack(p).id);
  if (!main.length) return;
  const cur = targetClip();
  let i = cur ? main.findIndex((c) => c.id === cur.id) : -1;
  if (which === "first") i = 0;
  else if (which === "last") i = main.length - 1;
  else if (which === "next") i = Math.min(main.length - 1, i + 1);
  else i = Math.max(0, i - 1);
  select(main[i].id);
  seek(main[i].start + 0.001);
}

// ---------------- captions ----------------

export function importSrtText(text: string) {
  const caps = parseSrt(text);
  if (!caps.length) {
    toast("No captions found in that SRT file", "error");
    return;
  }
  apply((p) => caps.reduce((acc, c) => addCaption(acc, c.start, c.end, c.text), p));
  toast(`Added ${caps.length} captions`, "ok");
}

export async function importSrt() {
  const f = await openTextFile(["srt"], "Subtitles (SRT)");
  if (f) importSrtText(f.text);
}

export async function exportSrt() {
  const caps = captionsOf(project());
  if (!caps.length) {
    toast("The Captions track is empty", "info");
    return;
  }
  const path = await saveTextFile(`${safeFileName(project().name)}.srt`, toSrt(caps), ["srt"]);
  if (path) toast(`Saved ${baseName(path)}`, "ok");
}

export function clearCaptions() {
  const ids = new Set(project().tracks.filter((t) => t.type === "caption").map((t) => t.id));
  apply((p) => removeClips(p, p.clips.filter((c) => ids.has(c.trackId)).map((c) => c.id)));
}

export function timelineEnd() {
  return totalDuration(project());
}
