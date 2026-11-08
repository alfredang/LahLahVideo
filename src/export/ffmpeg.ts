// Turns a LahLah project into one FFmpeg command line. Pure and unit-tested:
// the desktop app runs the result through the bundled FFmpeg sidecar.
import { Adjust, Clip, Keyframe, MediaItem, Project, TransitionType } from "../lib/types";
import { canvasSize, clipEnd, clipsOnTrack, mainTrack, totalDuration, transitionLength } from "../lib/project";

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  output: string;
  crf?: number;
  preset?: string;
}

/** A text or sticker clip pre-rendered to a transparent PNG at output scale, scale 1, no rotation. */
export interface RasterLayer {
  path: string;
  w: number;
  h: number;
}

export interface BuildInput {
  project: Project;
  opts: ExportOptions;
  rasters: Record<string, RasterLayer>;
  /** Absolute path for a media item. */
  pathOf: (m: MediaItem) => string;
  /** Mix the audio only (used for auto-captions). */
  audioOnly?: boolean;
  /** Render one PNG frame at this time instead of a video (API snapshot). */
  snapshotAt?: number;
}

export interface BuildResult {
  args: string[];
  duration: number;
  filter: string;
}

export const XFADE: Record<Exclude<TransitionType, "cut">, string> = {
  crossfade: "fade",
  slide: "slideleft",
  zoom: "zoomin",
  wipe: "wipeleft",
  dip: "fadeblack",
};

const n = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
};
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
const hex = (c: string) => "0x" + (c || "#000000").replace("#", "").slice(0, 6).padEnd(6, "0");

/** Piecewise-linear expression of a keyframed property, in terms of variable `tv`. */
export function kfExpr(kfs: Keyframe[] | undefined, prop: "x" | "y" | "scale" | "opacity", base: number, tv: string): string | null {
  void base;
  const pts = (kfs ?? []).filter((k) => k[prop] !== undefined).sort((a, b) => a.t - b.t);
  const v = (k: Keyframe) => k[prop] as number;
  if (pts.length === 0) return null;
  if (pts.length === 1) return n(v(pts[0]));
  let expr = n(v(pts[pts.length - 1]));
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i];
    const b = pts[i + 1];
    const span = Math.max(1e-3, b.t - a.t);
    const seg = `${n(v(a))}+(${n(v(b) - v(a))})*(${tv}-${n(a.t)})/${n(span)}`;
    expr = `if(lt(${tv},${n(b.t)}),${seg},${expr})`;
  }
  return `if(lt(${tv},${n(pts[0].t)}),${n(v(pts[0]))},${expr})`;
}

export function adjustFilters(a: Adjust): string[] {
  const f: string[] = [];
  if (a.brightness !== 0 || a.contrast !== 1 || a.saturation !== 1) {
    f.push(`eq=brightness=${n(a.brightness * 0.5)}:contrast=${n(a.contrast)}:saturation=${n(a.saturation)}`);
  }
  if (a.temperature) {
    // Lower kelvin reads warmer; 6500K is neutral.
    f.push(`colortemperature=temperature=${Math.round(6500 - a.temperature * 3000)}`);
  }
  if (a.vignette > 0) f.push(`vignette=angle=${n(0.25 + (1 - a.vignette) * 0.6)}`);
  return f;
}

/** atempo only accepts 0.5..2 per stage, so chain stages for 0.25x and 4x. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2) {
    out.push("atempo=2");
    s /= 2;
  }
  while (s < 0.5) {
    out.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${n(s)}`);
  return out;
}

export function buildFfmpegArgs({ project: p, opts, rasters, pathOf, audioOnly, snapshotAt }: BuildInput): BuildResult {
  const T = totalDuration(p);
  if (T <= 0) throw new Error("The timeline is empty. Add a clip first.");
  const W = even(opts.width);
  const H = even(opts.height);
  const F = opts.fps;
  const k = W / canvasSize(p).w; // reference canvas -> output pixels
  const args: string[] = ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1"];
  const graph: string[] = [];
  let inputs = 0;
  const media = (c: Clip) => p.media.find((m) => m.id === c.mediaId);
  const hiddenTrack = (c: Clip) => p.tracks.find((t) => t.id === c.trackId)?.hidden;
  const mutedTrack = (c: Clip) => p.tracks.find((t) => t.id === c.trackId)?.muted;

  const addInput = (c: Clip): number => {
    const m = media(c);
    if (c.type === "text" || c.type === "sticker") {
      const r = rasters[c.id];
      if (!r) throw new Error(`Missing rendered layer for ${c.type} clip`);
      args.push("-loop", "1", "-framerate", String(F), "-t", n(c.duration), "-i", r.path);
    } else if (!m) {
      throw new Error("A clip points at media that is no longer in the project.");
    } else if (m.kind === "image") {
      args.push("-loop", "1", "-framerate", String(F), "-t", n(c.duration), "-i", pathOf(m));
    } else {
      args.push("-ss", n(c.inPoint), "-t", n(c.duration * c.speed), "-i", pathOf(m));
    }
    return inputs++;
  };

  // Common per-layer video chain: timing, crop, size, colour, flips, rotation, opacity.
  const layerChain = (c: Clip, idx: number, boxW: number, boxH: number, forMain: boolean): { pre: string; post: string[] } => {
    const m = media(c);
    const parts: string[] = [];
    if (m && m.kind === "video") parts.push(`setpts=(PTS-STARTPTS)/${n(c.speed)}`);
    else parts.push("setpts=PTS-STARTPTS");
    parts.push(`fps=${F}`);
    const cr = c.transform.crop;
    if (cr.l || cr.t || cr.r || cr.b) {
      parts.push(`crop=iw*${n(1 - cr.l - cr.r)}:ih*${n(1 - cr.t - cr.b)}:iw*${n(cr.l)}:ih*${n(cr.t)}`);
    }
    const scaleKf = kfExpr(c.keyframes, "scale", c.transform.scale, "t");
    if (c.type === "text" || c.type === "sticker") {
      const r = rasters[c.id];
      if (scaleKf) parts.push(`scale=w='max(2,trunc(${r.w}*(${scaleKf})/2)*2)':h=-2:eval=frame`);
      else if (Math.abs(c.transform.scale - 1) > 1e-3) parts.push(`scale=${even(r.w * c.transform.scale)}:-2`);
    } else {
      parts.push(`scale=${even(boxW)}:${even(boxH)}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
      if (scaleKf) {
        const rel = `(${scaleKf})/${n(Math.max(0.01, c.transform.scale))}`;
        parts.push(`scale=w='max(2,trunc(iw*${rel}/2)*2)':h=-2:eval=frame`);
      }
    }
    parts.push(...adjustFilters(c.adjust));
    if (c.transform.flipH) parts.push("hflip");
    if (c.transform.flipV) parts.push("vflip");
    parts.push("format=yuva420p");
    if (c.transform.rotation % 360 !== 0) {
      const a = `${n(c.transform.rotation)}*PI/180`;
      parts.push(`rotate=${a}:c=none:ow=rotw(${a}):oh=roth(${a})`);
    }
    const opKf = kfExpr(c.keyframes, "opacity", c.transform.opacity, "T");
    if (opKf) parts.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip(${opKf},0,1)'`);
    else if (c.transform.opacity < 0.999) parts.push(`colorchannelmixer=aa=${n(c.transform.opacity)}`);
    const post: string[] = [];
    if (!forMain) {
      if (c.fadeIn > 0) post.push(`fade=t=in:st=0:d=${n(c.fadeIn)}:alpha=1`);
      if (c.fadeOut > 0) post.push(`fade=t=out:st=${n(Math.max(0, c.duration - c.fadeOut))}:d=${n(c.fadeOut)}:alpha=1`);
    }
    return { pre: `[${idx}:v]` + parts.join(","), post };
  };

  const posExpr = (c: Clip, tv: string) => {
    const xk = kfExpr(c.keyframes, "x", c.transform.x, tv);
    const yk = kfExpr(c.keyframes, "y", c.transform.y, tv);
    return {
      x: `(W-w)/2+(${xk ?? n(c.transform.x)})*W`,
      y: `(H-h)/2+(${yk ?? n(c.transform.y)})*H`,
      dynamic: !!(xk || yk),
    };
  };

  const clipInput = new Map<string, number>();
  if (!audioOnly) {
  // ---------- main track ----------
  graph.push(`color=c=black:s=${W}x${H}:r=${F}:d=${n(T)},format=yuv420p,settb=AVTB[base]`);
  const mainClips = clipsOnTrack(p, mainTrack(p).id).filter((c) => !hiddenTrack(c));
  mainClips.forEach((c, i) => {
    const idx = addInput(c);
    clipInput.set(c.id, idx);
    const s = c.transform.scale;
    const { pre } = layerChain(c, idx, W * s, H * s, true);
    const d = n(c.duration);
    const pos = posExpr(c, "t");
    if (p.background.type === "blur") {
      graph.push(`${pre},split=2[mf${i}][mb${i}]`);
      graph.push(
        `[mb${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=${Math.round(30 * k)},format=yuv420p[mbg${i}]`,
      );
    } else {
      graph.push(`${pre}[mf${i}]`);
      graph.push(`color=c=${hex(p.background.color)}:s=${W}x${H}:r=${F}:d=${d},format=yuv420p[mbg${i}]`);
    }
    const fades: string[] = [];
    if (c.fadeIn > 0) fades.push(`fade=t=in:st=0:d=${n(c.fadeIn)}`);
    if (c.fadeOut > 0) fades.push(`fade=t=out:st=${n(Math.max(0, c.duration - c.fadeOut))}:d=${n(c.fadeOut)}`);
    graph.push(
      `[mbg${i}][mf${i}]overlay=x='${pos.x}':y='${pos.y}'${pos.dynamic ? ":eval=frame" : ""}:eof_action=repeat,` +
        `tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,` +
        [...fades, "format=yuv420p", "setsar=1", `fps=${F}`, "settb=AVTB"].join(",") +
        `[m${i}]`,
    );
  });

  let cur = "base";
  if (mainClips.length) {
    let acc = "m0";
    let accDur = mainClips[0].duration;
    for (let i = 1; i < mainClips.length; i++) {
      const c = mainClips[i];
      const d = transitionLength(mainClips[i - 1], c);
      const out = `mx${i}`;
      if (d > 0 && c.transitionIn && c.transitionIn.type !== "cut") {
        const offset = Math.max(0, accDur - d);
        graph.push(`[${acc}][m${i}]xfade=transition=${XFADE[c.transitionIn.type]}:duration=${n(d)}:offset=${n(offset)},settb=AVTB[${out}]`);
        accDur = accDur + c.duration - d;
      } else {
        graph.push(`[${acc}][m${i}]concat=n=2:v=1:a=0,settb=AVTB[${out}]`);
        accDur += c.duration;
      }
      acc = out;
    }
    graph.push(`[base][${acc}]overlay=eof_action=pass[vmain]`);
    cur = "vmain";
  }

  // ---------- overlays, text and captions (bottom to top) ----------
  const layerTracks = [...p.tracks].reverse().filter((t) => t.type === "overlay" || t.type === "caption" || t.type === "text");
  let li = 0;
  for (const t of layerTracks) {
    if (t.hidden) continue;
    for (const c of clipsOnTrack(p, t.id)) {
      if (c.type === "text" && !c.text?.content.trim()) continue;
      const idx = addInput(c);
      clipInput.set(c.id, idx);
      const s = c.transform.scale;
      const { pre, post } = layerChain(c, idx, W * s, H * s, false);
      const lbl = `l${li}`;
      graph.push(`${pre}${post.length ? "," + post.join(",") : ""},setpts=PTS+${n(c.start)}/TB[${lbl}]`);
      const pos = posExpr(c, `(t-${n(c.start)})`);
      const out = `v${li}`;
      graph.push(
        `[${cur}][${lbl}]overlay=x='${pos.x}':y='${pos.y}'${pos.dynamic ? ":eval=frame" : ""}:enable='between(t,${n(c.start)},${n(clipEnd(c))})':eof_action=pass[${out}]`,
      );
      cur = out;
      li++;
    }
  }
  if (snapshotAt !== undefined) {
    const at = Math.max(0, Math.min(snapshotAt, T - 1 / F));
    graph.push(`[${cur}]trim=start=${n(at)},setpts=PTS-STARTPTS,format=rgb24[vout]`);
    const filter = graph.join(";\n");
    args.push("-filter_complex", filter, "-map", "[vout]", "-frames:v", "1", "-update", "1", opts.output);
    return { args, duration: T, filter };
  }
  graph.push(`[${cur}]format=yuv420p[vout]`);
  }

  // ---------- audio ----------
  const music: string[] = [];
  const voice: string[] = [];
  const other: string[] = [];
  let ai = 0;
  for (const c of p.clips) {
    if (c.muted || c.volume <= 0 || mutedTrack(c)) continue;
    const m = media(c);
    if (!m) continue;
    const track = p.tracks.find((t) => t.id === c.trackId);
    if (!track || track.hidden) continue;
    const audible = m.kind === "audio" || (m.kind === "video" && m.hasAudio);
    if (!audible) continue;
    let idx = clipInput.get(c.id);
    if (idx === undefined) idx = addInput(c);
    const chain = ["asetpts=PTS-STARTPTS", ...(m.kind === "video" || m.kind === "audio" ? atempoChain(c.speed) : [])];
    chain.push("aresample=48000", "aformat=channel_layouts=stereo");
    if (Math.abs(c.volume - 1) > 1e-3) chain.push(`volume=${n(c.volume)}`);
    if (c.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${n(c.fadeIn)}`);
    if (c.fadeOut > 0) chain.push(`afade=t=out:st=${n(Math.max(0, c.duration - c.fadeOut))}:d=${n(c.fadeOut)}`);
    chain.push(`atrim=duration=${n(c.duration)}`);
    const ms = Math.round(c.start * 1000);
    if (ms > 0) chain.push(`adelay=${ms}|${ms}`);
    const lbl = `a${ai++}`;
    graph.push(`[${idx}:a]${chain.join(",")}[${lbl}]`);
    if (c.audioRole === "music") music.push(lbl);
    else if (c.audioRole === "vo") voice.push(lbl);
    else other.push(lbl);
  }

  const mix = (labels: string[], out: string) => {
    if (labels.length === 1) graph.push(`[${labels[0]}]anull[${out}]`);
    else graph.push(`${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[${out}]`);
  };

  const finalLabels: string[] = [];
  if (p.ducking && music.length && voice.length) {
    mix(music, "mus");
    mix(voice, "vox");
    graph.push(`[vox]asplit=2[vox1][voxsc]`);
    graph.push(`[mus][voxsc]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[duck]`);
    finalLabels.push("duck", "vox1");
  } else {
    finalLabels.push(...music, ...voice);
  }
  finalLabels.push(...other);

  let audioMap: string;
  if (finalLabels.length) {
    mix(finalLabels, "amixed");
    graph.push(`[amixed]apad,atrim=duration=${n(T)}[aout]`);
    audioMap = "[aout]";
  } else {
    args.push("-f", "lavfi", "-t", n(T), "-i", "anullsrc=r=48000:cl=stereo");
    audioMap = `${inputs++}:a`;
  }

  const filter = graph.join(";\n");
  if (audioOnly) {
    if (!finalLabels.length) throw new Error("There is no sound on the timeline to transcribe.");
    args.push("-filter_complex", filter, "-map", audioMap, "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", "-t", n(T), opts.output);
    return { args, duration: T, filter };
  }
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    "-preset",
    opts.preset ?? "medium",
    "-crf",
    String(opts.crf ?? 20),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(F),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-t",
    n(T),
    opts.output,
  );
  return { args, duration: T, filter };
}

export interface ExportPreset {
  id: string;
  label: string;
  aspect: "9:16" | "16:9";
  height: number;
  fps: number;
  hint: string;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "tiktok", label: "TikTok", aspect: "9:16", height: 1080, fps: 30, hint: "1080 x 1920, 30 fps" },
  { id: "shorts", label: "YouTube Shorts", aspect: "9:16", height: 1080, fps: 30, hint: "1080 x 1920, 30 fps" },
  { id: "youtube", label: "YouTube 16:9", aspect: "16:9", height: 1080, fps: 30, hint: "1920 x 1080, 30 fps" },
];

/** Output size for a project at a quality level ("720p", "1080p", "4k" = short side). */
export function outputSize(p: Project, quality: "720p" | "1080p" | "4k"): { width: number; height: number } {
  const short = quality === "720p" ? 720 : quality === "4k" ? 2160 : 1080;
  const { w, h } = canvasSize(p);
  const f = short / Math.min(w, h);
  return { width: even(w * f), height: even(h * f) };
}

/** Parse FFmpeg `-progress` output lines; returns seconds rendered, if present. */
export function parseProgress(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  if (m) return Number(m[1]) / 1e6;
  const t = /^out_time=(\d+):(\d+):([\d.]+)/.exec(line.trim());
  if (t) return Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
  return null;
}

/** Parse `ffmpeg -i file` stderr for duration, size and an audio stream. */
export function parseProbe(stderr: string): { duration?: number; width?: number; height?: number; fps?: number; hasAudio: boolean; hasVideo: boolean } {
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  // "24 fps" is the average rate; "24 tbr" is FFmpeg's real base rate (ffprobe r_frame_rate). Prefer fps.
  const line = /Stream #[^\n]*Video:[^\n]*/.exec(stderr)?.[0] ?? "";
  const f = /([\d.]+)\s*fps/.exec(line) ?? /([\d.]+)(k?)\s*tbr/.exec(line);
  const fps = f ? Number(f[1]) * (f[2] === "k" ? 1000 : 1) : undefined;
  return {
    fps: fps && isFinite(fps) && fps > 0 && fps < 1000 ? fps : undefined,
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : undefined,
    width: v ? Number(v[1]) : undefined,
    height: v ? Number(v[2]) : undefined,
    hasAudio: /Stream #[^\n]*Audio:/.test(stderr),
    hasVideo: /Stream #[^\n]*Video:/.test(stderr),
  };
}
