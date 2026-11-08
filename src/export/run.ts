// Runs the export, the CapCut hand-over and auto-captions through the FFmpeg sidecar.
import { Project } from "../lib/types";
import { canvasSize, clipsOnTrack, mainTrack, addCaption } from "../lib/project";
import { cacheDir, copyFileTo, ensureDir, httpFetch, isDesktop, joinPath, runFfmpeg, RunHandle, writeBinary } from "../lib/platform";
import { canvasToPng, drawClip } from "../lib/raster";
import { buildFfmpegArgs, parseProgress, RasterLayer } from "./ffmpeg";
import { captionsOf, parseSrt, toSrt } from "../lib/handoff";
import { safeFileName } from "../lib/projectio";

export interface ExportJob {
  cancel: () => void;
  done: Promise<{ ok: boolean; output: string; error?: string }>;
}

function checkMedia(p: Project) {
  const used = new Set(p.clips.map((c) => c.mediaId).filter(Boolean));
  const missing = p.media.filter((m) => used.has(m.id) && !m.path);
  if (missing.length) {
    throw new Error(`These clips are not saved on this computer yet: ${missing.map((m) => m.name).join(", ")}. Re-import them, then export again.`);
  }
}

async function renderRasters(p: Project, width: number): Promise<Record<string, RasterLayer>> {
  const k = width / canvasSize(p).w;
  const dir = await cacheDir(`render-${Date.now().toString(36)}`);
  const out: Record<string, RasterLayer> = {};
  for (const c of p.clips) {
    if (c.type !== "text" && c.type !== "sticker") continue;
    const cv = drawClip(c, k, canvasSize(p).w);
    if (!cv) continue;
    const path = await joinPath(dir, `${c.id}.png`);
    await writeBinary(path, await canvasToPng(cv));
    out[c.id] = { path, w: cv.width, h: cv.height };
  }
  return out;
}

export async function startExport(
  p: Project,
  o: { width: number; height: number; fps: number; output: string },
  onProgress: (fraction: number) => void,
): Promise<ExportJob> {
  if (!isDesktop) throw new Error("Export runs in the desktop app. Install LahLah Video (see the README), or use the CapCut hand-over.");
  checkMedia(p);
  const rasters = await renderRasters(p, o.width);
  const { args, duration } = buildFfmpegArgs({ project: p, opts: { ...o, preset: "medium", crf: 20 }, rasters, pathOf: (m) => m.path! });
  let handle: RunHandle | null = null;
  handle = await runFfmpeg(args, (line) => {
    const t = parseProgress(line);
    if (t !== null) onProgress(Math.min(1, t / duration));
    if (line.startsWith("progress=end")) onProgress(1);
  });
  const done = handle.done.then(({ code, stderr }) => {
    if (code === 0) return { ok: true, output: o.output };
    const tail = stderr.trim().split("\n").slice(-6).join("\n");
    return { ok: false, output: o.output, error: tail || `FFmpeg stopped with code ${code}` };
  });
  return { cancel: () => handle?.cancel(), done };
}

/** "Open in CapCut instead": trimmed main-track clips in order, plus captions.srt and a how-to. */
export async function capcutHandover(p: Project, parent: string, onStep: (msg: string) => void): Promise<string> {
  if (!isDesktop) throw new Error("The CapCut hand-over needs the desktop app.");
  checkMedia(p);
  const dir = await joinPath(parent, `${safeFileName(p.name)} - for CapCut`);
  await ensureDir(dir);
  const main = clipsOnTrack(p, mainTrack(p).id);
  let i = 0;
  for (const c of main) {
    i++;
    const m = p.media.find((x) => x.id === c.mediaId);
    if (!m?.path) continue;
    const label = safeFileName(c.label ?? m.name.replace(/\.[^.]+$/, ""));
    onStep(`Clip ${i} of ${main.length}`);
    if (m.kind === "image") {
      const ext = m.path.split(".").pop();
      await copyFileTo(m.path, await joinPath(dir, `${String(i).padStart(2, "0")} - ${label}.${ext}`));
      continue;
    }
    const out = await joinPath(dir, `${String(i).padStart(2, "0")} - ${label}.mp4`);
    const h = await runFfmpeg(["-hide_banner", "-y", "-ss", String(c.inPoint), "-t", String(c.duration * c.speed), "-i", m.path, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", out]);
    const r = await h.done;
    if (r.code !== 0) throw new Error(`Could not prepare ${m.name}`);
  }
  for (const a of p.clips.filter((c) => c.type === "audio")) {
    const m = p.media.find((x) => x.id === a.mediaId);
    if (m?.path) await copyFileTo(m.path, await joinPath(dir, `audio - ${safeFileName(m.name)}`)).catch(() => undefined);
  }
  const caps = captionsOf(p);
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  if (caps.length) await writeTextFile(await joinPath(dir, "captions.srt"), toSrt(caps));
  await writeTextFile(
    await joinPath(dir, "OPEN IN CAPCUT - read me.txt"),
    [
      `${p.name}`,
      "",
      "1. Open CapCut and click Create project.",
      "2. Set the canvas ratio to " + p.aspect + " (click Ratio above the preview).",
      "3. Drag the numbered clips (01, 02, 03 ...) onto the timeline in order.",
      caps.length ? "4. Captions: Text > Local captions > Import, then pick captions.srt." : "4. Add captions in CapCut with Captions > Auto captions.",
      "5. Drag the audio files onto the timeline under the video.",
      "",
      "Made with LahLah Video. Clips are trimmed to match your LahLah timeline; speed changes, text and stickers are not carried over.",
    ].join("\n"),
  );
  return dir;
}

/** Optional auto-captions with the learner's own OpenAI key (Whisper). Nothing is sent without one. */
export async function autoCaptions(p: Project, apiKey: string, onStep: (m: string) => void): Promise<Project> {
  if (!isDesktop) throw new Error("Auto-captions need the desktop app (it extracts the audio with FFmpeg).");
  if (!apiKey.trim().startsWith("sk-")) throw new Error("Paste an OpenAI API key that starts with sk-.");
  checkMedia(p);
  onStep("Extracting the soundtrack…");
  const out = await joinPath(await cacheDir("captions"), `audio-${Date.now()}.m4a`);
  const { args } = buildFfmpegArgs({ project: p, opts: { width: 2, height: 2, fps: p.fps, output: out }, rasters: {}, pathOf: (m) => m.path!, audioOnly: true });
  const h = await runFfmpeg(args);
  const r = await h.done;
  if (r.code !== 0) throw new Error("Could not extract the audio for captions.");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(out);
  if (bytes.byteLength > 24 * 1024 * 1024) throw new Error("The soundtrack is over 25 MB; split the video into shorter parts.");
  onStep("Transcribing with Whisper…");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/mp4" }), "audio.m4a");
  form.append("model", "whisper-1");
  form.append("response_format", "srt");
  const res = await httpFetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey.trim()}` }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Whisper said ${res.status}: ${text.slice(0, 200)}`);
  const caps = parseSrt(text);
  if (!caps.length) throw new Error("Whisper returned no captions (is there speech on the timeline?)");
  return caps.reduce((acc, c) => addCaption(acc, c.start, c.end, c.text), p);
}
