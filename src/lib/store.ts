// Tiny global store with undo/redo. Project edits go through apply(); the playhead
// lives in its own clock store so 60 fps playback does not re-render the whole app.
import { useSyncExternalStore } from "react";
import { Project } from "./types";
import { newProject, totalDuration } from "./project";

export type LeftTab = "media" | "higgsfield" | "audio" | "text" | "stickers" | "transitions" | "filters" | "captions";

export interface UIState {
  selectedId: string | null;
  zoom: number; // timeline pixels per second
  snapping: boolean;
  leftTab: LeftTab;
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
  ui: { selectedId: null, zoom: 60, snapping: true, leftTab: "media", exportOpen: false, commandOpen: false, helpOpen: false, dirty: false },
});

export const clock = makeStore<{ t: number; playing: boolean }>({ t: 0, playing: false });

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}
export function useClock<T>(sel: (c: { t: number; playing: boolean }) => T): T {
  return useSyncExternalStore(clock.subscribe, () => sel(clock.get()));
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
function tick(now: number) {
  const c = clock.get();
  if (!c.playing) return;
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  const end = totalDuration(project());
  const t = c.t + dt;
  if (t >= end) {
    clock.set({ t: end, playing: false });
    return;
  }
  clock.set({ ...c, t });
  raf = requestAnimationFrame(tick);
}

export function play() {
  const end = totalDuration(project());
  if (end <= 0) return;
  const c = clock.get();
  clock.set({ t: c.t >= end - 0.05 ? 0 : c.t, playing: true });
  lastTick = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}
export function pause() {
  cancelAnimationFrame(raf);
  clock.set({ ...clock.get(), playing: false });
}
export function togglePlay() {
  if (clock.get().playing) pause();
  else play();
}
