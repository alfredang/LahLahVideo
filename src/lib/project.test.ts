import { describe, expect, it } from "vitest";
import { addMediaToTimeline, clipsOnTrack, duplicateClip, interpolateKeyframes, mainTrack, moveClip, newProject, removeClips, setSpeed, setTransition, splitClip, totalDuration, trimClip } from "./project";
import { MediaItem } from "./types";

const vid = (id: string, duration = 5): MediaItem => ({ id, name: id, kind: "video", url: "", duration });

function three() {
  let p = newProject();
  p = { ...p, media: [vid("a"), vid("b"), vid("c")] };
  const ids: string[] = [];
  for (const m of p.media) {
    const r = addMediaToTimeline(p, m);
    p = r.project;
    ids.push(r.clip.id);
  }
  return { p, ids };
}

describe("timeline operations", () => {
  it("keeps the main track magnetic", () => {
    const { p, ids } = three();
    expect(clipsOnTrack(p, mainTrack(p).id).map((c) => c.start)).toEqual([0, 5, 10]);
    const q = removeClips(p, [ids[1]]);
    expect(clipsOnTrack(q, mainTrack(q).id).map((c) => c.start)).toEqual([0, 5]);
  });

  it("overlaps clips by the transition length", () => {
    const { p, ids } = three();
    const q = setTransition(p, ids[1], "crossfade", 1);
    expect(totalDuration(q)).toBe(14);
  });

  it("splits at the playhead and keeps the source offsets", () => {
    const { p, ids } = three();
    const { project, rightId } = splitClip(p, ids[0], 2);
    const right = project.clips.find((c) => c.id === rightId)!;
    expect(right.inPoint).toBe(2);
    expect(right.duration).toBe(3);
    expect(totalDuration(project)).toBe(15);
  });

  it("changes speed and duration together", () => {
    const { p, ids } = three();
    const q = setSpeed(p, ids[0], 2);
    expect(q.clips.find((c) => c.id === ids[0])!.duration).toBe(2.5);
    const r = setSpeed(p, ids[0], 0.25);
    expect(r.clips.find((c) => c.id === ids[0])!.duration).toBe(20);
  });

  it("trims within the source", () => {
    const { p, ids } = three();
    let q = trimClip(p, ids[0], "start", 1);
    const c = q.clips.find((x) => x.id === ids[0])!;
    expect(c.inPoint).toBe(1);
    expect(c.duration).toBe(4);
    q = trimClip(q, ids[0], "end", 10);
    expect(q.clips.find((x) => x.id === ids[0])!.duration).toBe(4);
  });

  it("reorders, duplicates and interpolates keyframes", () => {
    const { p, ids } = three();
    const q = moveClip(p, ids[2], 0);
    expect(clipsOnTrack(q, mainTrack(q).id)[0].id).toBe(ids[2]);
    const d = duplicateClip(p, ids[0]);
    const order = clipsOnTrack(d.project, mainTrack(p).id).map((c) => c.id);
    expect(order[1]).toBe(d.clip!.id);
    const c = { ...p.clips[0], keyframes: [{ t: 0, x: 0 }, { t: 2, x: 1 }] };
    expect(interpolateKeyframes(c, 1).x).toBeCloseTo(0.5);
    const r = removeClips(p, [ids[0]], true);
    expect(totalDuration(r)).toBe(10);
  });
});
