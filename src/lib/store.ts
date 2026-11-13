// Tiny global store with undo/redo. Project edits go through apply(); the playhead
// lives in its own clock store so 60 fps playback does not re-render the whole app.
import { useRef, useSyncExternalStore } from "react";
import { Project } from "./types";
import { newProject, totalDuration } from "./project";
import { unlockAllMedia } from "./mediaUnlock";

export type LeftTab = "media" | "audio" | "text" | "captions" | "stickers" | "effects" | "transitions" | "filters" | "adjustment" | "templates";
export type MediaSource = "local" | "claude" | "library";
export type InspectorTab = "text" | "video" | "audio" | "speed" | "animation" | "adjust";

export interface UIState {
  selectedId: string | null;
  zoom: number; // timeline pixels per second
  snapping: boolean;
  leftTab: LeftTab;
  mediaSource: MediaSource;
  /** Ask the inspector to switch tab (and section), e.g. the Crop button. */
  inspectorTab?: InspectorTab;
  inspectorSection?: "crop";
  settingsOpen: boolean;
  fullscreen: boolean;
  detailsOpen: boolean;
  compact: boolean;
  previewAxis: boolean;
  lastAutoSave?: number;
  exportOpen: boolean;
  commandOpen: boolean;
  helpOpen: boolean;
  projectPath?: string;
  dirty: boolean;
  lastSaved?: number;
  exportPreset?: "tiktok" | "shorts" | "youtube";
  exportQuality?: "720p" | "1080p" | "4k";
  /** Start exporting as soon as the dialog opens ("export for TikTok now"). */
  exportNow?: boolean;
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  ui: UIState;
}

type Listener = () => void;

function makeStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(next: T) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export const store = makeStore<State>({
  project: newProject(),
  past: [],
  future: [],
  ui: { selectedId: null, zoom: 60, snapping: true, leftTab: "media", mediaSource: "local", settingsOpen: false, fullscreen: false, detailsOpen: false, compact: false, previewAxis: false, exportOpen: false, commandOpen: false, helpOpen: false, dirty: false },
});

export const clock = makeStore<{ t: number; playing: boolean }>({ t: 0, playing: false });

/**
 * Memoise a selector on (state, selector) so a selector that builds a new array or object
 * (`s.project.media.filter(...)`) returns the SAME value until the state changes.
 * useSyncExternalStore needs a stable snapshot; a fresh value on every read makes React
 * re-render forever and the app freezes (the Audio tab did exactly this in v1.1.2).
 */
export function cachedSnapshot<S, T>(get: () => S) {
  let last: { s: S; sel: (s: S) => T; v: T } | null = null;
  return (sel: (s: S) => T): T => {
    const s = get();
    if (last && last.s === s && last.sel === sel) return last.v;
    const v = sel(s);
    last = { s, sel, v };
    return v;
  };
}

function useSelector<S, T>(src: { get: () => S; subscribe: (l: Listener) => () => void }, sel: (s: S) => T): T {
  const read = useRef<((sel: (s: S) => T) => T) | null>(null);
  if (!read.current) read.current = cachedSnapshot<S, T>(src.get);
  const r = read.current;
  return useSyncExternalStore(src.subscribe, () => r(sel));
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSelector(store, sel);
}
export function useClock<T>(sel: (c: { t: number; playing: boolean }) => T): T {
  return useSelector(clock, sel);
}

const HISTORY = 100;
let lastKey = "";
let lastAt = 0;

/** Apply an edit. Edits with the same coalesce key within 800 ms share one undo step (slider drags). */
export function apply(fn: (p: Project) => Project, coalesce?: string) {
  const s = store.get();
  const next = fn(s.project);
  if (next === s.project) return;
  const now = Date.now();
  const merge = coalesce && coalesce === lastKey && now - lastAt < 800;
  lastKey = coalesce ?? "";
  lastAt = now;
  store.set({
    ...s,
    project: next,
    past: merge ? s.past : [...s.past.slice(-HISTORY + 1), s.project],
    future: [],
    ui: { ...s.ui, dirty: true },
  });
}

export function undo() {
  const s = store.get();
  const prev = s.past[s.past.length - 1];
  if (!prev) return false;
  lastKey = "";
  store.set({ ...s, project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], ui: { ...s.ui, dirty: true } });
  return true;
}

export function redo() {
  const s = store.get();
  const next = s.future[0];
  if (!next) return false;
  lastKey = "";
  store.set({ ...s, project: next, past: [...s.past, s.project], future: s.future.slice(1), ui: { ...s.ui, dirty: true } });
  return true;
}

export function setUI(patch: Partial<UIState>) {
  const s = store.get();
  store.set({ ...s, ui: { ...s.ui, ...patch } });
}

export function replaceProject(p: Project, path?: string) {
  const s = store.get();
  store.set({ project: p, past: [], future: [], ui: { ...s.ui, selectedId: null, projectPath: path, dirty: false } });
  seek(0);
}

export const project = () => store.get().project;
export const ui = () => store.get().ui;
export const selected = () => {
  const s = store.get();
  return s.project.clips.find((c) => c.id === s.ui.selectedId) ?? null;
};

export function seek(t: number) {
  const max = Math.max(0, totalDuration(project()));
  clock.set({ ...clock.get(), t: Math.min(Math.max(0, t), max) });
}

let raf = 0;
let lastTick = 0;

/**
 * While a main-track video plays, its own clock drives the playhead. Following requestAnimationFrame
 * time instead lets the two drift apart, and every correction is a visible seek (judder).
 */
type MasterClock = () => number | null;
let master: { id: string; read: MasterClock } | null = null;
export function setMasterClock(id: string, read: MasterClock | null) {
  if (read) master = { id, read };
  else if (master?.id === id) master = null;
}

let lastMaster = { value: -1, at: 0 };

function tick(now: number) {
  const c = clock.get();
  if (!c.playing) return;
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  const end = totalDuration(project());
  let t = c.t + dt;
  const m = master?.read();
  if (m !== null && m !== undefined) {
    if (m !== lastMaster.value) lastMaster = { value: m, at: now };
    const stalled = now - lastMaster.at > 250;
    // Trust the video when it is close to wall time and still moving (it may pull the playhead
    // back a few frames once, right after a clip starts). A stalled video must not freeze the clock.
    if (!stalled && Math.abs(m - t) < 0.25) t = m;
  }
  if (t >= end) {
    logPlayer("end", end);
    clock.set({ t: end, playing: false });
    return;
  }
  clock.set({ ...c, t });
  raf = requestAnimationFrame(tick);
}

export function play() {
  unlockAllMedia();
  const end = totalDuration(project());
  if (end <= 0) return;
  const c = clock.get();
  logPlayer("play", c.t);
  clock.set({ t: c.t >= end - 0.05 ? 0 : c.t, playing: true });
  lastTick = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}
/** Last few play/stop events, reported by the local API's status (helps diagnose playback). */
export const playerLog: { at: number; event: string; t: number; from?: string }[] = [];
function logPlayer(event: string, t: number) {
  const ev = typeof window !== "undefined" ? (window.event as Event | undefined) : undefined;
  const target = ev?.target as HTMLElement | undefined;
  const from = ev ? `${ev.type} on ${target?.tagName?.toLowerCase() ?? "?"}${target?.className ? "." + String(target.className).split(" ")[0] : ""}${ev.isTrusted ? "" : " (synthetic)"}` : new Error().stack?.split("\n").slice(2, 5).map((l) => l.trim().slice(0, 60)).join(" < ");
  playerLog.push({ at: Date.now(), event, t: Number(t.toFixed(3)), from });
  if (playerLog.length > 20) playerLog.shift();
}

export function pause() {
  logPlayer("pause", clock.get().t);
  cancelAnimationFrame(raf);
  clock.set({ ...clock.get(), playing: false });
}
export function togglePlay() {
  if (clock.get().playing) pause();
  else play();
}

/** Media › From Claude / Higgsfield. */
export function openClaudePanel() {
  setUI({ leftTab: "media", mediaSource: "claude" });
}
