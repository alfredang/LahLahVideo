// Pure project operations. Every function returns a new Project; nothing mutates.
import {
  ASPECTS,
  AspectId,
  Adjust,
  Clip,
  DEFAULT_ADJUST,
  DEFAULT_TRANSFORM,
  Keyframe,
  MediaItem,
  Project,
  TextStyle,
  Track,
  TrackType,
  TransitionType,
} from "./types";

export const MIN_CLIP = 0.1;

let counter = 0;
export function uid(prefix = "id"): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function newProject(name = "Untitled video", aspect: AspectId = "9:16"): Project {
  const now = Date.now();
  return {
    schema: "lahlah-project/1",
    id: uid("prj"),
    name,
    aspect,
    fps: 30,
    background: { type: "blur", color: "#000000" },
    ducking: true,
    media: [],
    tracks: [
      { id: "t_text", type: "text", name: "Text" },
      { id: "t_caption", type: "caption", name: "Captions" },
      { id: "t_overlay", type: "overlay", name: "Overlay" },
      { id: "t_main", type: "main", name: "Main video" },
      { id: "t_music", type: "audio", name: "Music" },
      { id: "t_voice", type: "audio", name: "Voice-over & SFX" },
    ],
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function canvasSize(p: Pick<Project, "aspect">) {
  return ASPECTS[p.aspect] ?? ASPECTS["9:16"];
}

export const mainTrack = (p: Project): Track => p.tracks.find((t) => t.type === "main")!;
export const trackOf = (p: Project, clip: Clip) => p.tracks.find((t) => t.id === clip.trackId);
export const mediaOf = (p: Project, clip: Clip): MediaItem | undefined =>
  clip.mediaId ? p.media.find((m) => m.id === clip.mediaId) : undefined;
export const clipEnd = (c: Clip) => c.start + c.duration;
export const clipsOnTrack = (p: Project, trackId: string) =>
  p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);

export function firstTrackOfType(p: Project, type: TrackType): Track | undefined {
  return p.tracks.find((t) => t.type === type);
}

export function totalDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Effective transition length for a main-track clip (0 for cuts or the first clip). */
export function transitionLength(prev: Clip | undefined, c: Clip): number {
  if (!prev || !c.transitionIn || c.transitionIn.type === "cut") return 0;
  const max = Math.min(prev.duration, c.duration) / 2;
  return round3(clamp(c.transitionIn.duration, 0.1, Math.max(0.1, max)));
}

/** The main track is magnetic: clips sit end to end, overlapping only by their transition. */
export function layoutMain(p: Project): Project {
  const main = mainTrack(p);
  const ordered = clipsOnTrack(p, main.id);
  const placed = new Map<string, number>();
  let prev: Clip | undefined;
  let end = 0;
  for (const c of ordered) {
    const d = transitionLength(prev, c);
    const start = prev ? round3(end - d) : 0;
    placed.set(c.id, start);
    end = start + c.duration;
    prev = { ...c, start };
  }
  return {
    ...p,
    clips: p.clips.map((c) => (placed.has(c.id) && placed.get(c.id) !== c.start ? { ...c, start: placed.get(c.id)! } : c)),
  };
}

export function touch(p: Project): Project {
  return layoutMain({ ...p, updatedAt: Date.now() });
}

function baseClip(trackId: string, start: number, duration: number): Omit<Clip, "type"> {
  return {
    id: uid("clip"),
    trackId,
    start,
    inPoint: 0,
    duration,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM, crop: { ...DEFAULT_TRANSFORM.crop } },
    adjust: { ...DEFAULT_ADJUST },
  };
}

export const IMAGE_DEFAULT = 4;

/** Add a media item to the timeline. Video and images go to the main track unless a track is given. */
export function addMediaToTimeline(p: Project, media: MediaItem, opts: { trackId?: string; at?: number } = {}): { project: Project; clip: Clip } {
  let trackId = opts.trackId;
  if (!trackId) {
    if (media.kind === "audio") trackId = firstTrackOfType(p, "audio")!.id;
    else trackId = mainTrack(p).id;
  }
  const track = p.tracks.find((t) => t.id === trackId)!;
  const duration = media.kind === "image" ? IMAGE_DEFAULT : Math.max(MIN_CLIP, media.duration || IMAGE_DEFAULT);
  let start = opts.at ?? 0;
  if (track.type === "main") start = totalMain(p) + 0.001;
  else if (opts.at === undefined) start = trackEnd(p, trackId);
  const clip: Clip = {
    ...baseClip(trackId, start, duration),
    type: media.kind,
    mediaId: media.id,
    audioRole: media.kind === "audio" ? (media.origin === "recording" ? "vo" : track.name.toLowerCase().includes("music") ? "music" : "sfx") : undefined,
  };
  if (track.type === "overlay") clip.transform.scale = 0.5;
  return { project: touch({ ...p, clips: [...p.clips, clip] }), clip };
}

export function totalMain(p: Project): number {
  return clipsOnTrack(p, mainTrack(p).id).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}
export function trackEnd(p: Project, trackId: string): number {
  return clipsOnTrack(p, trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export const TEXT_PRESETS: Record<string, Omit<TextStyle, "content" | "preset">> = {
  clean: { font: "Inter, Arial, sans-serif", size: 72, color: "#ffffff", bold: true, align: "center", stroke: "#000000" },
  tiktok: { font: "Arial Black, Arial, sans-serif", size: 84, color: "#ffffff", bold: true, align: "center", stroke: "#000000" },
  boxed: { font: "Inter, Arial, sans-serif", size: 64, color: "#111111", bg: "#ffffff", bold: true, align: "center" },
  yellow: { font: "Arial Black, Arial, sans-serif", size: 76, color: "#ffd400", bold: true, align: "center", stroke: "#000000" },
  neon: { font: "Trebuchet MS, Arial, sans-serif", size: 80, color: "#33f6ff", bold: true, align: "center", stroke: "#ff2bd6" },
  headline: { font: "Georgia, serif", size: 110, color: "#ffffff", bold: true, align: "center", stroke: "#000000" },
  lowerthird: { font: "Inter, Arial, sans-serif", size: 54, color: "#ffffff", bg: "#000000b3", bold: false, align: "left" },
  caption: { font: "Arial, sans-serif", size: 60, color: "#ffffff", bold: true, align: "center", stroke: "#000000" },
};

export const TEXT_PRESET_LABELS: Record<string, string> = {
  clean: "Clean white",
  tiktok: "TikTok bold",
  boxed: "Boxed label",
  yellow: "Yellow pop",
  neon: "Neon night",
  headline: "Big headline",
  lowerthird: "Lower third",
  caption: "Caption",
};

export function makeTextStyle(content: string, preset = "clean"): TextStyle {
  return { content, preset, ...(TEXT_PRESETS[preset] ?? TEXT_PRESETS.clean) };
}

export function addText(p: Project, content: string, opts: { at?: number; duration?: number; preset?: string; trackId?: string; y?: number } = {}) {
  const trackId = opts.trackId ?? firstTrackOfType(p, "text")!.id;
  const clip: Clip = {
    ...baseClip(trackId, Math.max(0, opts.at ?? 0), opts.duration ?? 3),
    type: "text",
    text: makeTextStyle(content, opts.preset ?? "clean"),
  };
  if (opts.y !== undefined) clip.transform.y = opts.y;
  return { project: touch({ ...p, clips: [...p.clips, clip] }), clip };
}

export function addSticker(p: Project, emoji: string, at = 0) {
  const trackId = firstTrackOfType(p, "overlay")!.id;
  const clip: Clip = { ...baseClip(trackId, Math.max(0, at), 3), type: "sticker", sticker: emoji };
  clip.transform.y = -0.25;
  return { project: touch({ ...p, clips: [...p.clips, clip] }), clip };
}

export function addCaption(p: Project, start: number, end: number, text: string): Project {
  const trackId = firstTrackOfType(p, "caption")!.id;
  const clip: Clip = {
    ...baseClip(trackId, round3(start), round3(Math.max(MIN_CLIP, end - start))),
    type: "text",
    text: makeTextStyle(text, "caption"),
  };
  clip.transform.y = p.aspect === "16:9" ? 0.38 : 0.28;
  return touch({ ...p, clips: [...p.clips, clip] });
}

export function updateClip(p: Project, id: string, patch: Partial<Clip> | ((c: Clip) => Partial<Clip>)): Project {
  return touch({
    ...p,
    clips: p.clips.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)),
  });
}

export function removeClips(p: Project, ids: string[], ripple = false): Project {
  let clips = p.clips;
  if (ripple) {
    for (const id of ids) {
      const c = clips.find((x) => x.id === id);
      if (!c) continue;
      clips = clips.map((x) =>
        x.trackId === c.trackId && x.id !== c.id && x.start >= clipEnd(c) - 1e-6 ? { ...x, start: round3(x.start - c.duration) } : x,
      );
    }
  }
  return touch({ ...p, clips: clips.filter((c) => !ids.includes(c.id)) });
}

export function splitClip(p: Project, id: string, t: number): { project: Project; rightId?: string } {
  const c = p.clips.find((x) => x.id === id);
  if (!c || t <= c.start + MIN_CLIP / 2 || t >= clipEnd(c) - MIN_CLIP / 2) return { project: p };
  const leftDur = round3(t - c.start);
  const kfs = c.keyframes ?? [];
  const left: Clip = { ...c, duration: leftDur, fadeOut: 0, keyframes: kfs.filter((k) => k.t <= leftDur) };
  const right: Clip = {
    ...c,
    id: uid("clip"),
    start: round3(t),
    inPoint: round3(c.inPoint + leftDur * c.speed),
    duration: round3(c.duration - leftDur),
    transitionIn: undefined,
    fadeIn: 0,
    keyframes: kfs.filter((k) => k.t > leftDur).map((k) => ({ ...k, t: round3(k.t - leftDur) })),
  };
  const clips = p.clips.flatMap((x) => (x.id === id ? [left, right] : [x]));
  return { project: touch({ ...p, clips }), rightId: right.id };
}

/** Split every clip under the playhead on the selected clip's track, or the main track. */
export function splitAt(p: Project, t: number, preferId?: string | null) {
  const target =
    (preferId && p.clips.find((c) => c.id === preferId && c.start < t && clipEnd(c) > t)) ||
    clipsOnTrack(p, mainTrack(p).id).find((c) => c.start < t && clipEnd(c) > t) ||
    p.clips.find((c) => c.start < t && clipEnd(c) > t);
  if (!target) return { project: p };
  return splitClip(p, target.id, t);
}

export function duplicateClip(p: Project, id: string): { project: Project; clip?: Clip } {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return { project: p };
  const copy: Clip = { ...structuredClone(c), id: uid("clip"), start: round3(clipEnd(c) + (trackOf(p, c)?.type === "main" ? 0.0005 : 0)) };
  if (trackOf(p, c)?.type === "main") {
    // Insert right after the original on the magnetic track.
    const later = p.clips.map((x) => (x.trackId === c.trackId && x.start > c.start ? { ...x, start: x.start + c.duration } : x));
    return { project: touch({ ...p, clips: [...later, copy] }), clip: copy };
  }
  return { project: touch({ ...p, clips: [...p.clips, copy] }), clip: copy };
}

export function sourceLimit(p: Project, c: Clip): number {
  const m = mediaOf(p, c);
  if (!m || m.kind === "image" || !m.duration) return Infinity;
  return m.duration;
}

/** Drag the left (edge="start") or right edge by dt seconds of timeline time. */
export function trimClip(p: Project, id: string, edge: "start" | "end", dt: number): Project {
  return updateClip(p, id, (c) => {
    const limit = sourceLimit(p, c);
    if (edge === "start") {
      let d = dt;
      d = Math.max(d, -c.inPoint / c.speed); // cannot go before source start
      if (!isFinite(limit) && c.type !== "video" && c.type !== "audio") d = Math.max(d, -c.start);
      d = Math.min(d, c.duration - MIN_CLIP);
      if (c.type !== "video" && c.type !== "audio") {
        return { start: round3(Math.max(0, c.start + d)), duration: round3(c.duration - d) };
      }
      return { start: round3(Math.max(0, c.start + d)), inPoint: round3(c.inPoint + d * c.speed), duration: round3(c.duration - d) };
    }
    let dur = c.duration + dt;
    if (isFinite(limit)) dur = Math.min(dur, (limit - c.inPoint) / c.speed);
    return { duration: round3(Math.max(MIN_CLIP, dur)) };
  });
}

export function setSpeed(p: Project, id: string, speed: number): Project {
  return updateClip(p, id, (c) => {
    const s = round3(clamp(speed, 0.25, 4));
    const used = c.duration * c.speed;
    let duration = used / s;
    const limit = sourceLimit(p, c);
    if (isFinite(limit)) duration = Math.min(duration, (limit - c.inPoint) / s);
    return { speed: s, duration: round3(Math.max(MIN_CLIP, duration)) };
  });
}

/** Move a clip to a new start (and optionally another track of a compatible type). */
export function moveClip(p: Project, id: string, start: number, trackId?: string): Project {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const target = p.tracks.find((t) => t.id === (trackId ?? c.trackId));
  if (!target || !trackAccepts(target.type, c.type)) return p;
  if (target.type === "main") {
    // Reorder on the magnetic track by drop position.
    const others = clipsOnTrack(p, target.id).filter((x) => x.id !== id);
    let idx = others.findIndex((x) => start < x.start + x.duration / 2);
    if (idx < 0) idx = others.length;
    const order = [...others.slice(0, idx), { ...c, trackId: target.id }, ...others.slice(idx)];
    const seq = new Map(order.map((x, i) => [x.id, i * 1000]));
    const clips = p.clips.map((x) => (seq.has(x.id) ? { ...x, trackId: target.id, start: seq.get(x.id)! } : x));
    return touch({ ...p, clips });
  }
  return updateClip(p, id, { start: round3(Math.max(0, start)), trackId: target.id });
}

export function trackAccepts(track: TrackType, clip: Clip["type"]): boolean {
  switch (track) {
    case "main":
      return clip === "video" || clip === "image";
    case "overlay":
      return clip === "video" || clip === "image" || clip === "sticker";
    case "text":
    case "caption":
      return clip === "text";
    case "audio":
      return clip === "audio";
  }
}

export function setAspect(p: Project, aspect: AspectId): Project {
  return touch({ ...p, aspect });
}

export function setTransition(p: Project, id: string, type: TransitionType, duration = 0.5): Project {
  return updateClip(p, id, { transitionIn: type === "cut" ? undefined : { type, duration } });
}

export function addTrack(p: Project, type: TrackType): Project {
  const n = p.tracks.filter((t) => t.type === type).length + 1;
  const names: Record<TrackType, string> = { main: "Main", overlay: "Overlay", text: "Text", caption: "Captions", audio: "Audio" };
  const track: Track = { id: uid("trk"), type, name: `${names[type]} ${n}` };
  const idx = type === "audio" ? p.tracks.length : 0;
  const tracks = [...p.tracks];
  tracks.splice(idx, 0, track);
  return touch({ ...p, tracks });
}

// ---------- keyframes, fades and transitions shared by preview and export ----------

export interface VisualState {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export function interpolateKeyframes(c: Clip, local: number): VisualState {
  const base: VisualState = { x: c.transform.x, y: c.transform.y, scale: c.transform.scale, opacity: c.transform.opacity };
  const kfs = (c.keyframes ?? []).slice().sort((a, b) => a.t - b.t);
  if (!kfs.length) return base;
  const out = { ...base };
  for (const prop of ["x", "y", "scale", "opacity"] as const) {
    const pts = kfs.filter((k) => k[prop] !== undefined) as (Keyframe & Record<typeof prop, number>)[];
    if (!pts.length) continue;
    if (local <= pts[0].t) out[prop] = pts[0][prop];
    else if (local >= pts[pts.length - 1].t) out[prop] = pts[pts.length - 1][prop];
    else {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (local >= a.t && local <= b.t) {
          const f = b.t === a.t ? 0 : (local - a.t) / (b.t - a.t);
          out[prop] = a[prop] + (b[prop] - a[prop]) * f;
          break;
        }
      }
    }
  }
  return out;
}

export function fadeFactor(c: Clip, local: number): number {
  let f = 1;
  if (c.fadeIn > 0 && local < c.fadeIn) f = Math.min(f, local / c.fadeIn);
  if (c.fadeOut > 0 && local > c.duration - c.fadeOut) f = Math.min(f, (c.duration - local) / c.fadeOut);
  return clamp(f, 0, 1);
}

/** Upsert a keyframe at the playhead with the current values of the given props. */
export function upsertKeyframe(c: Clip, local: number, values: Partial<VisualState>): Keyframe[] {
  const t = round3(clamp(local, 0, c.duration));
  const kfs = [...(c.keyframes ?? [])];
  const i = kfs.findIndex((k) => Math.abs(k.t - t) < 1 / 60);
  if (i >= 0) kfs[i] = { ...kfs[i], ...values };
  else kfs.push({ t, ...values });
  return kfs.sort((a, b) => a.t - b.t);
}

// ---------- looks (named filter presets) ----------

export const LOOKS: { id: string; name: string; adjust: Partial<Adjust>; swatch: string }[] = [
  { id: "none", name: "Original", adjust: { brightness: 0, contrast: 1, saturation: 1, temperature: 0, vignette: 0 }, swatch: "#8a8f98" },
  { id: "kopi-warm", name: "Kopi Warm", adjust: { brightness: 0.02, contrast: 1.05, saturation: 1.15, temperature: 0.45, vignette: 0.15 }, swatch: "#b5783a" },
  { id: "shiok-pop", name: "Shiok Pop", adjust: { brightness: 0.03, contrast: 1.2, saturation: 1.55, temperature: 0.05, vignette: 0 }, swatch: "#ff4f8b" },
  { id: "noir", name: "Noir", adjust: { brightness: 0, contrast: 1.35, saturation: 0, temperature: 0, vignette: 0.35 }, swatch: "#222222" },
  { id: "vintage", name: "Vintage", adjust: { brightness: 0.02, contrast: 0.9, saturation: 0.7, temperature: 0.35, vignette: 0.5 }, swatch: "#c9a66b" },
  { id: "cool-night", name: "Cool Night", adjust: { brightness: -0.05, contrast: 1.1, saturation: 0.9, temperature: -0.55, vignette: 0.25 }, swatch: "#3a6df0" },
  { id: "soft-film", name: "Soft Film", adjust: { brightness: 0.05, contrast: 0.85, saturation: 0.9, temperature: 0.1, vignette: 0.1 }, swatch: "#d9c7b8" },
  { id: "golden-hour", name: "Golden Hour", adjust: { brightness: 0.05, contrast: 1.05, saturation: 1.25, temperature: 0.7, vignette: 0.2 }, swatch: "#ffb02e" },
];

export const STICKERS = ["🔥", "😂", "😍", "👍", "👏", "🎉", "💯", "✨", "❤️", "😮", "🤯", "🙌", "💰", "☕", "🌧️", "⭐", "✅", "❌", "👉", "📌", "🎬", "📈", "🪙", "🇸🇬"];

export function fmtTime(s: number, withFrames = false, fps = 30): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  if (!withFrames) return base;
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${base}:${String(f).padStart(2, "0")}`;
}
