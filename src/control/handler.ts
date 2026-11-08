// Runs local API requests (forwarded by the Rust control server) against the editor.
// Edits go through apply(), so Claude's changes land in the same undo history as yours.
import { apply, clock, playerLog, project, replaceProject, setUI, ui } from "../lib/store";
import { Clip, MediaItem, Project } from "../lib/types";
import {
  addCaption,
  addMediaToTimeline,
  canvasSize,
  clipEnd,
  clipsOnTrack,
  firstTrackOfType,
  mainTrack,
  removeClips,
  setAspect,
  touch,
  totalDuration,
  updateClip,
} from "../lib/project";
import { captionsOf, isHandoff, parseSrt } from "../lib/handoff";
import { addRecent, deserialise, recents, safeFileName, serialise } from "../lib/projectio";
import { baseName, cacheDir, defaultExportDir, dirName, fileExists, importUrl, isDesktop, joinPath, mediaFromPath, readText, runFfmpeg, writeBinary } from "../lib/platform";
import { loadHandoff } from "../actions";
import { parseCommand } from "../commands/parse";
import { execute } from "../commands/execute";
import { buildFfmpegArgs, outputSize } from "../export/ffmpeg";
import { startExport } from "../export/run";
import { toast } from "../lib/toast";
import { snapFps } from "../lib/fps";
import { canvasToPng, drawClip } from "../lib/raster";
import { API_ROUTES, ApiOperation, EXPORT_PRESET_IDS, ExportJob, ExportPresetId, matchRoute } from "./protocol";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const bad = (m: string) => new ApiError(400, m);

const jobs = new Map<string, ExportJob>();
let version = "";
export function setAppVersion(v: string) {
  version = v;
}

export function timelineJson(p: Project) {
  const name = (c: Clip) => p.media.find((m) => m.id === c.mediaId)?.name;
  return {
    name: p.name,
    aspect: p.aspect,
    canvas: canvasSize(p),
    fps: p.fps,
    duration: Number(totalDuration(p).toFixed(3)),
    playhead: Number(clock.get().t.toFixed(3)),
    background: p.background,
    tracks: p.tracks.map((t) => ({
      id: t.id,
      type: t.type,
      name: t.name,
      muted: !!t.muted,
      hidden: !!t.hidden,
      clips: clipsOnTrack(p, t.id).map((c) => ({
        id: c.id,
        type: c.type,
        label: c.label ?? name(c) ?? c.text?.content ?? c.sticker,
        start: Number(c.start.toFixed(3)),
        end: Number(clipEnd(c).toFixed(3)),
        duration: Number(c.duration.toFixed(3)),
        inPoint: Number(c.inPoint.toFixed(3)),
        speed: c.speed,
        volume: c.volume,
        muted: c.muted,
        transitionIn: c.transitionIn ?? null,
        text: c.text?.content,
        look: c.adjust.look,
        keyframes: c.keyframes?.length ?? 0,
      })),
    })),
    captions: captionsOf(p),
    media: p.media.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.duration, path: m.path, origin: m.origin })),
  };
}

function status() {
  const p = project();
  return {
    app: "LahLah Video",
    version,
    running: true,
    desktop: isDesktop,
    project: {
      name: p.name,
      path: ui().projectPath ?? null,
      unsavedChanges: ui().dirty,
      duration: Number(totalDuration(p).toFixed(3)),
      aspect: p.aspect,
      canvas: canvasSize(p),
      fps: p.fps,
      clips: p.clips.length,
      mainClips: clipsOnTrack(p, mainTrack(p).id).length,
      captions: captionsOf(p).length,
    },
    exports: [...jobs.values()].slice(-5),
    player: { playing: clock.get().playing, playhead: Number(clock.get().t.toFixed(3)), log: playerLog.slice(-8) },
  };
}

async function openHandoff(body: any) {
  if (body?.path) {
    const path = String(body.path);
    const text = await readText(path).catch(() => {
      throw bad(`Could not read ${path}`);
    });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw bad(`${baseName(path)} is not valid JSON`);
    }
    if (isHandoff(json)) await loadHandoff(json, dirName(path));
    else {
      const p = deserialise(text);
      replaceProject(p, path.endsWith(".lahlah") ? path : undefined);
      addRecent(path, p.name);
    }
  } else if (body?.json !== undefined) {
    const json = typeof body.json === "string" ? JSON.parse(body.json) : body.json;
    if (!isHandoff(json)) throw bad('json must be a lahlah-edit/1 hand-off (schema: "lahlah-edit/1")');
    await loadHandoff(json, body.baseDir ? String(body.baseDir) : undefined);
  } else throw bad("Send path (a lahlah-edit.json or .lahlah file) or json (the hand-off itself)");
  return { opened: true, timeline: timelineJson(project()) };
}

function trackFor(p: Project, m: MediaItem, track?: string): string | undefined {
  if (!track) return undefined;
  if (p.tracks.some((t) => t.id === track)) return track;
  const audio = p.tracks.filter((t) => t.type === "audio");
  switch (track) {
    case "main":
      return mainTrack(p).id;
    case "overlay":
      return firstTrackOfType(p, "overlay")?.id;
    case "music":
      return audio.find((t) => /music/i.test(t.name))?.id ?? audio[0]?.id;
    case "voice":
      return audio.find((t) => !/music/i.test(t.name))?.id ?? audio[1]?.id;
    case "audio":
      return audio[0]?.id;
  }
  void m;
  throw bad(`Unknown track "${track}". Use main, overlay, music, voice, audio, none or a track id.`);
}

async function addClips(body: any) {
  const sources: string[] = Array.isArray(body?.sources) ? body.sources.map(String) : typeof body?.sources === "string" ? [body.sources] : [];
  if (!sources.length) throw bad("sources must list at least one https:// URL or file path");
  const added: { source: string; clipId?: string; mediaId?: string; error?: string }[] = [];
  let at = typeof body.at === "number" ? body.at : undefined;
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    try {
      const m = /^https?:\/\//i.test(src) ? await importUrl(src, i, "higgsfield") : await mediaFromPath(src);
      if (!m) throw new Error("not a video, image or audio file");
      const before = project();
      const rate = m.kind === "video" && !before.clips.some((c) => c.type === "video") ? snapFps(m.fps) : undefined;
      apply((p) => touch({ ...p, fps: rate ?? p.fps, media: [...p.media, m] }));
      if (body.track === "none") {
        added.push({ source: src, mediaId: m.id });
        continue;
      }
      const p = project();
      const r = addMediaToTimeline(p, m, { trackId: trackFor(p, m, body.track), at });
      apply(() => (m.kind === "audio" && body.track === "voice" ? updateClip(r.project, r.clip.id, { audioRole: "vo" }) : r.project));
      if (at !== undefined) at += r.clip.duration;
      added.push({ source: src, mediaId: m.id, clipId: r.clip.id });
    } catch (e) {
      added.push({ source: src, error: (e as Error).message });
    }
  }
  if (added.some((a) => a.clipId || a.mediaId)) toast(`Claude added ${added.filter((a) => !a.error).length} clip(s)`, "ok");
  return { added, timeline: timelineJson(project()) };
}

function runCommand(body: any) {
  const text = String(body?.text ?? "").trim();
  if (!text) throw bad("text is required, e.g. \"split at 3 seconds\"");
  const r = parseCommand(text);
  if (!r.ok) return { ok: false, error: r.error, suggestions: r.suggestions };
  const message = execute(r.command) ?? r.say;
  toast(message, "ok");
  return { ok: true, command: r.command, message, timeline: timelineJson(project()) };
}

function setCaptions(body: any) {
  let caps: { start: number; end: number; text: string }[] = [];
  if (typeof body?.srt === "string") caps = parseSrt(body.srt);
  else if (Array.isArray(body?.captions)) caps = body.captions.map((c: any) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text ?? "") }));
  else throw bad("Send srt (SRT text) or captions ([{start, end, text}])");
  caps = caps.filter((c) => isFinite(c.start) && isFinite(c.end) && c.end > c.start && c.text.trim());
  apply((p) => {
    const ids = new Set(p.tracks.filter((t) => t.type === "caption").map((t) => t.id));
    const cleared = removeClips(p, p.clips.filter((c) => ids.has(c.trackId)).map((c) => c.id));
    return caps.reduce((acc, c) => addCaption(acc, c.start, c.end, c.text.trim()), cleared);
  });
  return { captions: caps.length };
}

async function uniquePath(dir: string, name: string) {
  let path = await joinPath(dir, `${name}.mp4`);
  for (let i = 2; (await fileExists(path)) && i < 100; i++) path = await joinPath(dir, `${name} (${i}).mp4`);
  return path;
}

async function startExportJob(body: any) {
  const preset = String(body?.preset ?? "") as ExportPresetId;
  if (!EXPORT_PRESET_IDS.includes(preset)) throw bad(`preset must be one of ${EXPORT_PRESET_IDS.join(", ")}`);
  const want = preset === "youtube" ? "16:9" : "9:16";
  if (project().aspect !== want) apply((p) => setAspect(p, want));
  const p = project();
  if (totalDuration(p) <= 0) throw bad("The timeline is empty");
  const quality = ["720p", "1080p", "4k"].includes(body?.resolution) ? body.resolution : "1080p";
  const fps = [24, 25, 30, 50, 60].includes(Number(body?.fps)) ? Number(body.fps) : p.fps;
  const output = body?.path ? String(body.path) : await uniquePath(await defaultExportDir(), safeFileName(p.name));
  const id = `exp_${Date.now().toString(36)}`;
  const job: ExportJob = { id, state: "running", progress: 0, output, preset, startedAt: Date.now() };
  jobs.set(id, job);
  toast(`Exporting for ${preset.replace("_", " ")}…`);
  const run = await startExport(p, { ...outputSize(p, quality), fps, output }, (f) => (job.progress = Number(f.toFixed(3))));
  run.done.then((r) => {
    job.finishedAt = Date.now();
    if (r.ok) {
      job.state = "done";
      job.progress = 1;
      toast(`Exported ${baseName(output)}`, "ok");
    } else {
      job.state = "failed";
      job.error = r.error;
    }
  });
  return { job };
}

async function snapshot(query: URLSearchParams) {
  if (!isDesktop) throw new ApiError(501, "Snapshots need the desktop app");
  const p = project();
  if (totalDuration(p) <= 0) throw bad("The timeline is empty");
  const t = query.has("t") ? Number(query.get("t")) : clock.get().t;
  const width = Math.max(120, Math.min(1920, Number(query.get("width")) || 540));
  const { w, h } = canvasSize(p);
  const size = { width: Math.round(width / 2) * 2, height: Math.round((width * h) / w / 2) * 2 };
  const dir = await cacheDir("snapshots");
  const rasters: Record<string, { path: string; w: number; h: number }> = {};
  for (const c of p.clips) {
    if (c.type !== "text" && c.type !== "sticker") continue;
    const cv = drawClip(c, size.width / w, w);
    if (!cv) continue;
    const path = await joinPath(dir, `${c.id}.png`);
    await writeBinary(path, await canvasToPng(cv));
    rasters[c.id] = { path, w: cv.width, h: cv.height };
  }
  const out = await joinPath(dir, `frame-${Date.now()}.png`);
  const { args } = buildFfmpegArgs({ project: p, opts: { ...size, fps: p.fps, output: out }, rasters, pathOf: (m) => m.path!, snapshotAt: t });
  const h2 = await runFfmpeg(args);
  const r = await h2.done;
  if (r.code !== 0) throw new ApiError(500, `Could not render the frame: ${r.stderr.trim().split("\n").slice(-2).join(" ")}`);
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(out);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: "image/png", base64: btoa(bin), time: t, width: size.width, height: size.height };
}

async function saveProjectApi(body: any) {
  const p = project();
  let path: string | undefined = body?.path ? String(body.path) : ui().projectPath;
  if (!path) {
    const { documentDir } = await import("@tauri-apps/api/path");
    const dir = await joinPath(await documentDir(), "LahLah Video");
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    path = await joinPath(dir, `${safeFileName(p.name)}.lahlah`);
  }
  if (!path.endsWith(".lahlah")) path += ".lahlah";
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, serialise(p));
  setUI({ projectPath: path, dirty: false, lastSaved: Date.now() });
  addRecent(path, p.name);
  return { saved: true, path };
}

/** Route one request. Exported for tests. */
export async function handle(method: string, path: string, query: string, body: unknown): Promise<unknown> {
  const m = matchRoute(method, path);
  if (!m) throw new ApiError(404, `No route ${method} ${path}. Routes: ${Object.values(API_ROUTES).map((r) => `${r.method} ${r.path}`).join(", ")}`);
  const q = new URLSearchParams(query);
  const ops: Record<ApiOperation, () => unknown> = {
    status,
    open_handoff: () => openHandoff(body),
    add_clips: () => addClips(body),
    run_command: () => runCommand(body),
    get_timeline: () => timelineJson(project()),
    set_captions: () => setCaptions(body),
    export: () => startExportJob(body),
    export_status: () => {
      const job = jobs.get(m.params.id);
      if (!job) throw new ApiError(404, `No export job ${m.params.id}`);
      return { job };
    },
    list_projects: () => ({ current: { name: project().name, path: ui().projectPath ?? null, unsavedChanges: ui().dirty }, recent: recents() }),
    save_project: () => saveProjectApi(body),
    snapshot: () => snapshot(q),
  };
  return ops[m.op]();
}

/** Start listening for requests from the Rust control server (desktop only). */
export async function startControlListener() {
  if (!isDesktop) return;
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  const { getVersion } = await import("@tauri-apps/api/app");
  setAppVersion(await getVersion().catch(() => ""));
  await listen<{ id: number; method: string; path: string; query: string; body: unknown }>("lahlah-control", async (ev) => {
    const { id, method, path, query, body } = ev.payload;
    let status = 200;
    let result: unknown;
    try {
      result = await handle(method, path, query, body);
    } catch (e) {
      status = e instanceof ApiError ? e.status : 500;
      result = { error: (e as Error).message ?? String(e) };
    }
    await invoke("control_reply", { id, status, body: result ?? null }).catch(() => undefined);
  });
}

