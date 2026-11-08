// Core data model for a LahLah Video project (.lahlah files are this, as JSON).

export type MediaKind = "video" | "image" | "audio";

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  /** Absolute file path on disk (desktop app). Missing in the browser-only mode. */
  path?: string;
  /** URL the preview can load (asset:// URL, blob: URL, data: URL or https URL). */
  url: string;
  duration: number; // seconds (images: 0)
  width?: number;
  height?: number;
  hasAudio?: boolean;
  /** Frame rate of a video, from the FFmpeg probe (desktop). */
  fps?: number;
  thumb?: string;
  origin?: "local" | "higgsfield" | "recording" | "demo" | "handoff";
}

export type TrackType = "main" | "overlay" | "text" | "caption" | "audio";

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  muted?: boolean;
  hidden?: boolean;
}

export type TransitionType = "cut" | "crossfade" | "slide" | "zoom" | "wipe" | "dip";
export const TRANSITIONS: TransitionType[] = ["cut", "crossfade", "slide", "zoom", "wipe", "dip"];

export interface Transform {
  x: number; // offset from centre, fraction of canvas width
  y: number; // offset from centre, fraction of canvas height
  scale: number; // 1 = fit inside the canvas
  rotation: number; // degrees
  flipH: boolean;
  flipV: boolean;
  opacity: number; // 0..1
  crop: { l: number; t: number; r: number; b: number }; // fractions trimmed from each edge
}

export interface Adjust {
  brightness: number; // -1..1 (0 = none)
  contrast: number; // 0..2 (1 = none)
  saturation: number; // 0..3 (1 = none)
  temperature: number; // -1 (cool) .. 1 (warm)
  vignette: number; // 0..1
  look?: string; // named look id
}

export interface Keyframe {
  t: number; // seconds from clip start
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
}

export interface TextStyle {
  content: string;
  preset: string;
  font: string;
  size: number; // px on the 1080-wide reference canvas
  color: string;
  bg?: string; // box colour
  stroke?: string; // outline colour
  bold: boolean;
  italic?: boolean;
  align: "left" | "center" | "right";
}

export type ClipType = "video" | "image" | "audio" | "text" | "sticker";
export type AudioRole = "music" | "vo" | "sfx";

export interface Clip {
  id: string;
  trackId: string;
  type: ClipType;
  mediaId?: string;
  start: number; // seconds on the timeline
  inPoint: number; // seconds into the source
  duration: number; // seconds on the timeline (source used = duration * speed)
  speed: number;
  volume: number; // 0..2
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transform: Transform;
  adjust: Adjust;
  transitionIn?: { type: TransitionType; duration: number };
  keyframes?: Keyframe[];
  text?: TextStyle;
  sticker?: string;
  audioRole?: AudioRole;
  label?: string;
}

export type AspectId = "9:16" | "16:9" | "1:1" | "4:5";

export interface Project {
  schema: "lahlah-project/1";
  id: string;
  name: string;
  aspect: AspectId;
  fps: number;
  background: { type: "color" | "blur"; color: string };
  ducking: boolean;
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
  higgsfield?: { name?: string; url?: string };
  platform?: string;
  createdAt: number;
  updatedAt: number;
}

export const ASPECTS: Record<AspectId, { w: number; h: number; label: string; hint: string }> = {
  "9:16": { w: 1080, h: 1920, label: "9:16", hint: "TikTok, Shorts, Reels" },
  "16:9": { w: 1920, h: 1080, label: "16:9", hint: "YouTube" },
  "1:1": { w: 1080, h: 1080, label: "1:1", hint: "Square feed post" },
  "4:5": { w: 1080, h: 1350, label: "4:5", hint: "Instagram portrait" },
};

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flipH: false,
  flipV: false,
  opacity: 1,
  crop: { l: 0, t: 0, r: 0, b: 0 },
};

export const DEFAULT_ADJUST: Adjust = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  vignette: 0,
};
