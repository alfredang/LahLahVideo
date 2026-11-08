// Frame-rate matching: a 30 fps project built from 24 fps Higgsfield clips repeats every
// fifth frame (visible judder), so the project follows the clips' own rate.
import { Project } from "./types";
import { clipsOnTrack, mainTrack } from "./project";

export const PROJECT_RATES = [24, 25, 30, 50, 60] as const;

/** Nearest supported project rate: 23.976 -> 24, 29.97 -> 30, 59.94 -> 60, 48 -> 50. */
export function snapFps(raw: number | undefined): number | undefined {
  if (!raw || !isFinite(raw) || raw <= 0) return undefined;
  let best: number = PROJECT_RATES[0];
  for (const r of PROJECT_RATES) if (Math.abs(r - raw) < Math.abs(best - raw)) best = r;
  return best;
}

/** The rate most of the main-track video clips share (by clip time), or undefined if unknown. */
export function clipsFrameRate(p: Project): number | undefined {
  const weight = new Map<number, number>();
  for (const c of clipsOnTrack(p, mainTrack(p).id)) {
    const m = p.media.find((x) => x.id === c.mediaId);
    const rate = m?.kind === "video" ? snapFps(m.fps) : undefined;
    if (rate) weight.set(rate, (weight.get(rate) ?? 0) + c.duration);
  }
  let best: number | undefined;
  let most = 0;
  for (const [rate, w] of weight) if (w > most) [best, most] = [rate, w];
  return best;
}

/** Match the project to its clips. Returns the new project and the change, if any. */
export function matchClipFrameRate(p: Project): { project: Project; from?: number; to?: number } {
  const rate = clipsFrameRate(p);
  if (!rate || rate === p.fps) return { project: p };
  return { project: { ...p, fps: rate }, from: p.fps, to: rate };
}
