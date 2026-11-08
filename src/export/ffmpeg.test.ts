import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atempoChain, buildFfmpegArgs, kfExpr, outputSize, parseProbe, parseProgress } from "./ffmpeg";
import { addMediaToTimeline, addSticker, addText, newProject, setSpeed, setTransition, updateClip, addCaption } from "../lib/project";
import { MediaItem, Project } from "../lib/types";

function sampleProject(dir: string): { p: Project; rasters: Record<string, { path: string; w: number; h: number }> } {
  let p = newProject("Test", "9:16");
  const v1: MediaItem = { id: "v1", name: "v1.mp4", kind: "video", url: "", path: join(dir, "v1.mp4"), duration: 5, width: 1280, height: 720, hasAudio: true };
  const v2: MediaItem = { id: "v2", name: "v2.mp4", kind: "video", url: "", path: join(dir, "v2.mp4"), duration: 4, width: 720, height: 1280, hasAudio: false };
  const img: MediaItem = { id: "img", name: "img.png", kind: "image", url: "", path: join(dir, "img.png"), duration: 0, width: 800, height: 600 };
  const mus: MediaItem = { id: "mus", name: "music.m4a", kind: "audio", url: "", path: join(dir, "music.m4a"), duration: 12 };
  p = { ...p, media: [v1, v2, img, mus] };
  const ids: string[] = [];
  for (const m of [v1, img, v2, v1, img, v2]) {
    const r = addMediaToTimeline(p, m);
    p = r.project;
    ids.push(r.clip.id);
  }
  p = setTransition(p, ids[1], "crossfade", 0.5);
  p = setTransition(p, ids[2], "slide", 0.4);
  p = setTransition(p, ids[3], "zoom", 0.5);
  p = setTransition(p, ids[4], "wipe", 0.5);
  p = setTransition(p, ids[5], "dip", 0.6);
  p = setSpeed(p, ids[0], 2);
  p = setSpeed(p, ids[3], 0.5);
  p = updateClip(p, ids[2], (c) => ({
    keyframes: [
      { t: 0, x: -0.2, scale: 1 },
      { t: 2, x: 0.2, scale: 1.4 },
    ],
    transform: { ...c.transform, rotation: 0, flipH: true },
    adjust: { ...c.adjust, brightness: 0.1, temperature: 0.5, vignette: 0.4 },
    fadeIn: 0.3,
  }));
  const ov = addMediaToTimeline(p, v1, { trackId: "t_overlay", at: 1 });
  p = updateClip(ov.project, ov.clip.id, (c) => ({
    transform: { ...c.transform, rotation: 15, opacity: 0.8, x: 0.2, y: -0.2 },
    keyframes: [
      { t: 0, opacity: 0, scale: 0.3 },
      { t: 1, opacity: 1, scale: 0.6 },
    ],
    fadeOut: 0.5,
    volume: 0.5,
  }));
  const tx = addText(p, "Save first", { at: 2 });
  p = tx.project;
  const st = addSticker(p, "🔥", 3);
  p = st.project;
  p = addCaption(p, 0, 2, "Hello there");
  const capId = p.clips.find((c) => c.trackId === "t_caption")!.id;
  const music = addMediaToTimeline(p, mus, { trackId: "t_music", at: 0 });
  p = updateClip(music.project, music.clip.id, { volume: 0.6, fadeOut: 1, audioRole: "music" });
  const vo = addMediaToTimeline(p, mus, { trackId: "t_voice", at: 2 });
  p = updateClip(vo.project, vo.clip.id, { duration: 3, audioRole: "vo" });
  const rasters = {
    [tx.clip.id]: { path: join(dir, "text.png"), w: 400, h: 120 },
    [st.clip.id]: { path: join(dir, "text.png"), w: 400, h: 120 },
    [capId]: { path: join(dir, "text.png"), w: 400, h: 120 },
  };
  return { p, rasters };
}

describe("ffmpeg builder", () => {
  it("chains atempo stages for extreme speeds", () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(atempoChain(1.5)).toEqual(["atempo=1.5"]);
  });

  it("builds piecewise keyframe expressions", () => {
    expect(kfExpr(undefined, "x", 0, "t")).toBeNull();
    expect(kfExpr([{ t: 1, x: 0.5 }], "x", 0, "t")).toBe("0.5");
    const e = kfExpr([{ t: 0, x: 0 }, { t: 2, x: 1 }], "x", 0, "t")!;
    expect(e).toContain("if(lt(t,2)");
  });

  it("sizes outputs by quality", () => {
    const p = newProject("x", "9:16");
    expect(outputSize(p, "1080p")).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(p, "720p")).toEqual({ width: 720, height: 1280 });
    expect(outputSize({ ...p, aspect: "16:9" }, "4k")).toEqual({ width: 3840, height: 2160 });
  });

  it("parses progress and probe output", () => {
    expect(parseProgress("out_time_ms=2500000")).toBe(2.5);
    expect(parseProgress("out_time=00:00:03.500000")).toBe(3.5);
    const probe = parseProbe(
      "  Duration: 00:00:05.02, start: 0.000000, bitrate: 1 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1280x720, 25 fps\n  Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo",
    );
    expect(probe).toMatchObject({ duration: 5.02, width: 1280, height: 720, hasAudio: true, hasVideo: true });
  });

  it("produces one filter graph with transitions, overlays and ducked audio", () => {
    const { p, rasters } = sampleProject("/tmp/x");
    const { args, filter, duration } = buildFfmpegArgs({ project: p, opts: { width: 540, height: 960, fps: 30, output: "/tmp/x/out.mp4" }, rasters, pathOf: (m) => m.path! });
    expect(duration).toBeGreaterThan(10);
    for (const t of ["xfade=transition=fade", "slideleft", "zoomin", "wipeleft", "fadeblack", "sidechaincompress", "gblur", "colortemperature"]) {
      expect(filter).toContain(t);
    }
    expect(args.at(-1)).toBe("/tmp/x/out.mp4");
  });

  // Renders for real when LAHLAH_FFMPEG points at an ffmpeg binary.
  const bin = process.env.LAHLAH_FFMPEG;
  it.skipIf(!bin)("renders the sample project with a real ffmpeg", () => {
    const dir = join(tmpdir(), "lahlah-export-test");
    mkdirSync(dir, { recursive: true });
    const ff = (a: string[]) => execFileSync(bin!, ["-hide_banner", "-loglevel", "error", "-y", ...a], { stdio: "pipe" });
    if (!existsSync(join(dir, "v1.mp4"))) {
      ff(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=5", "-f", "lavfi", "-i", "sine=f=440:d=5", "-c:v", "libx264", "-c:a", "aac", "-shortest", join(dir, "v1.mp4")]);
      ff(["-f", "lavfi", "-i", "smptebars=s=720x1280:r=30:d=4", "-c:v", "libx264", join(dir, "v2.mp4")]);
      ff(["-f", "lavfi", "-i", "mandelbrot=s=800x600", "-frames:v", "1", join(dir, "img.png")]);
      ff(["-f", "lavfi", "-i", "sine=f=220:d=12", "-c:a", "aac", join(dir, "music.m4a")]);
      ff(["-f", "lavfi", "-i", "color=c=red@0.7:s=400x120,format=rgba", "-frames:v", "1", join(dir, "text.png")]);
    }
    const { p, rasters } = sampleProject(dir);
    const out = join(dir, "out.mp4");
    const { args, duration } = buildFfmpegArgs({ project: p, opts: { width: 540, height: 960, fps: 30, output: out, preset: "ultrafast" }, rasters, pathOf: (m) => m.path! });
    execFileSync(bin!, args, { stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
    let info = "";
    try {
      execFileSync(bin!, ["-hide_banner", "-i", out], { stdio: "pipe" });
    } catch (e: any) {
      info = String(e.stderr);
    }
    const probe = parseProbe(info);
    expect(probe.width).toBe(540);
    expect(probe.height).toBe(960);
    expect(probe.hasAudio).toBe(true);
    expect(Math.abs((probe.duration ?? 0) - duration)).toBeLessThan(0.2);
  }, 180_000);
});
