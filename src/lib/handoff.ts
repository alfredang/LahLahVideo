// lahlah-edit/1: the hand-off file Claude's higgsfield-video skill writes after Higgsfield
// renders the shots. LahLah Video lays the clips out in order with transitions and captions.
import { AspectId, MediaItem, Project, TransitionType } from "./types";
import { addCaption, addMediaToTimeline, addText, clipsOnTrack, firstTrackOfType, mainTrack, newProject, touch, updateClip } from "./project";

export interface HandoffClip {
  id?: string;
  scene?: number;
  shot?: number;
  src: string;
  duration?: number;
  trim_in?: number;
  trim_out?: number;
  transition_in?: string;
  caption?: string;
  voiceover?: string;
}
export interface HandoffAudio {
  src: string;
  start?: number;
  volume?: number;
  type?: "music" | "vo" | "sfx" | string;
}
export interface HandoffCaption {
  start: number;
  end: number;
  text: string;
}
export interface Handoff {
  schema: string;
  title?: string;
  platform?: string;
  aspect?: string;
  fps?: number;
  higgsfield_project?: { name?: string; url?: string };
  clips: HandoffClip[];
  audio?: HandoffAudio[];
  captions?: HandoffCaption[];
}

export type HandoffCheck = { ok: true; handoff: Handoff; warnings: string[] } | { ok: false; error: string };

const ASPECTS: AspectId[] = ["9:16", "16:9", "1:1", "4:5"];

export function aspectFor(h: Pick<Handoff, "aspect" | "platform">): AspectId {
  const a = (h.aspect ?? "").replace(/\s/g, "") as AspectId;
  if (ASPECTS.includes(a)) return a;
  const p = (h.platform ?? "").toLowerCase();
  if (p === "youtube") return "16:9";
  return "9:16";
}

export function transitionFor(v?: string): TransitionType {
  const s = (v ?? "cut").toLowerCase().trim();
  if (/cross|fade|dissolve|mix/.test(s) && !/black|dip/.test(s)) return "crossfade";
  if (/slide|push/.test(s)) return "slide";
  if (/zoom/.test(s)) return "zoom";
  if (/wipe/.test(s)) return "wipe";
  if (/dip|black/.test(s)) return "dip";
  return "cut";
}

export function isHandoff(json: unknown): boolean {
  return !!json && typeof json === "object" && String((json as any).schema ?? "").startsWith("lahlah-edit/");
}

export function checkHandoff(json: unknown): HandoffCheck {
  if (!json || typeof json !== "object") return { ok: false, error: "This file is not JSON." };
  const h = json as Handoff;
  const warnings: string[] = [];
  if (!String(h.schema ?? "").startsWith("lahlah-edit/")) return { ok: false, error: 'This is not a LahLah hand-off file (schema should be "lahlah-edit/1").' };
  if (h.schema !== "lahlah-edit/1") warnings.push(`Schema ${h.schema} is newer than this app knows; reading it as lahlah-edit/1.`);
  if (!Array.isArray(h.clips) || h.clips.length === 0) return { ok: false, error: "The hand-off file has no clips." };
  h.clips.forEach((c, i) => {
    if (!c || typeof c.src !== "string" || !c.src.trim()) warnings.push(`Clip ${i + 1} has no src and will be skipped.`);
  });
  return { ok: true, handoff: h, warnings };
}

/** Every distinct source the hand-off needs, with a guess at its kind. */
export function handoffSources(h: Handoff): { src: string; kind: "video" | "image" | "audio" }[] {
  const out = new Map<string, "video" | "image" | "audio">();
  for (const c of h.clips) if (c?.src) out.set(c.src, /\.(png|jpe?g|webp|gif)(\?|$)/i.test(c.src) ? "image" : "video");
  for (const a of h.audio ?? []) if (a?.src) out.set(a.src, "audio");
  return [...out.entries()].map(([src, kind]) => ({ src, kind }));
}

/** Build a project from a hand-off once each src has been resolved to a MediaItem. */
export function projectFromHandoff(h: Handoff, media: Map<string, MediaItem>): Project {
  let p = newProject(h.title?.trim() || "Higgsfield edit", aspectFor(h));
  p = {
    ...p,
    fps: [24, 25, 30, 50, 60].includes(Number(h.fps)) ? Number(h.fps) : 30,
    higgsfield: h.higgsfield_project,
    platform: h.platform,
    media: [...new Map([...media.values()].map((m) => [m.id, m])).values()],
  };
  const mainId = mainTrack(p).id;
  const placed: { clipId: string; caption?: string; voiceover?: string }[] = [];
  for (const hc of h.clips) {
    const m = hc?.src ? media.get(hc.src) : undefined;
    if (!m) continue;
    const r = addMediaToTimeline(p, m, { trackId: mainId });
    p = r.project;
    const inPoint = Math.max(0, Number(hc.trim_in) || 0);
    const srcLen = m.kind === "image" ? Infinity : m.duration || Number(hc.duration) || 5;
    let end = hc.trim_out !== undefined ? Number(hc.trim_out) : hc.duration !== undefined ? inPoint + Number(hc.duration) : srcLen;
    if (!isFinite(end)) end = inPoint + (Number(hc.duration) || 4);
    end = Math.min(end, srcLen);
    const duration = Math.max(0.1, end - inPoint);
    const t = transitionFor(hc.transition_in);
    p = updateClip(p, r.clip.id, {
      inPoint: m.kind === "image" ? 0 : inPoint,
      duration,
      transitionIn: t === "cut" ? undefined : { type: t, duration: 0.5 },
      label: hc.id ?? (hc.scene !== undefined ? `S${String(hc.scene).padStart(2, "0")}-SH${String(hc.shot ?? 1).padStart(2, "0")}` : undefined),
    });
    placed.push({ clipId: r.clip.id, caption: hc.caption, voiceover: hc.voiceover });
  }
  p = touch(p);

  // On-screen text per clip, on the Text track, across that clip's time on the timeline.
  const mainClips = clipsOnTrack(p, mainId);
  for (const pl of placed) {
    const c = mainClips.find((x) => x.id === pl.clipId);
    if (!c || !pl.caption?.trim()) continue;
    p = addText(p, pl.caption.trim(), { at: c.start, duration: c.duration, preset: "tiktok", y: p.aspect === "16:9" ? -0.32 : -0.3 }).project;
  }

  // Subtitles: the captions array wins; otherwise voice-over lines become subtitles.
  if (h.captions?.length) {
    for (const cap of h.captions) {
      if (cap && cap.text?.trim() && Number(cap.end) > Number(cap.start)) p = addCaption(p, Number(cap.start), Number(cap.end), cap.text.trim());
    }
  } else {
    for (const pl of placed) {
      const c = mainClips.find((x) => x.id === pl.clipId);
      if (c && pl.voiceover?.trim()) p = addCaption(p, c.start, c.start + c.duration, pl.voiceover.trim());
    }
  }

  for (const a of h.audio ?? []) {
    const m = a?.src ? media.get(a.src) : undefined;
    if (!m) continue;
    const role = a.type === "music" ? "music" : a.type === "vo" ? "vo" : "sfx";
    const track = role === "music" ? firstTrackOfType(p, "audio")! : p.tracks.filter((t) => t.type === "audio")[1] ?? firstTrackOfType(p, "audio")!;
    const r = addMediaToTimeline(p, m, { trackId: track.id, at: Math.max(0, Number(a.start) || 0) });
    p = updateClip(r.project, r.clip.id, { volume: a.volume !== undefined ? Math.max(0, Math.min(2, Number(a.volume))) : 1, audioRole: role });
  }
  return touch(p);
}

// ---------------- SRT ----------------

export function parseSrtTime(s: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0").slice(0, 3)) / 1000;
}

export function parseSrt(text: string): HandoffCaption[] {
  const blocks = text.replace(/\r/g, "").replace(/^﻿/, "").split(/\n\s*\n/);
  const out: HandoffCaption[] = [];
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() !== "");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split("-->");
    const start = parseSrtTime(a);
    const end = parseSrtTime(z);
    const body = lines.slice(ti + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (isFinite(start) && isFinite(end) && body) out.push({ start, end, text: body });
  }
  return out;
}

export function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

export function toSrt(caps: HandoffCaption[]): string {
  return (
    caps
      .slice()
      .sort((a, b) => a.start - b.start)
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
      .join("\n")
  );
}

export function captionsOf(p: Project): HandoffCaption[] {
  const ids = new Set(p.tracks.filter((t) => t.type === "caption").map((t) => t.id));
  return p.clips
    .filter((c) => ids.has(c.trackId) && c.text?.content)
    .map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text!.content }))
    .sort((a, b) => a.start - b.start);
}
