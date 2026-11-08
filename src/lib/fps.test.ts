import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clipsFrameRate, matchClipFrameRate, snapFps } from "./fps";
import { parseProbe, buildFfmpegArgs } from "../export/ffmpeg";
import { projectFromHandoff } from "./handoff";
import { MediaItem } from "./types";
import { addMediaToTimeline, newProject } from "./project";

// What `ffmpeg -i` prints for a Higgsfield Seedance 2.0 Mini clip.
const HIGGSFIELD_PROBE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'S01.mp4':
  Duration: 00:00:05.09, start: 0.000000, bitrate: 2483 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 496x864, 2335 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)`;

const clip = (id: string, fps?: number): MediaItem => ({ id, name: `${id}.mp4`, kind: "video", url: "", path: `/x/${id}.mp4`, duration: 5, width: 496, height: 864, hasAudio: true, fps });

describe("frame-rate matching", () => {
  it("reads the clip frame rate from the probe", () => {
    expect(parseProbe(HIGGSFIELD_PROBE)).toMatchObject({ fps: 24, width: 496, height: 864, hasAudio: true });
    expect(parseProbe("Stream #0:0: Video: h264, yuv420p, 1920x1080, 29.97 fps, 29.97 tbr").fps).toBeCloseTo(29.97);
    expect(parseProbe("Stream #0:0: Video: h264, yuv420p, 1920x1080, 25 tbr, 90k tbn").fps).toBe(25);
  });

  it("snaps to the supported project rates", () => {
    expect([23.976, 24, 25, 29.97, 30, 48, 59.94, 60, 120].map(snapFps)).toEqual([24, 24, 25, 30, 30, 50, 60, 60, 60]);
    expect(snapFps(undefined)).toBeUndefined();
  });

  it("follows 24 fps Higgsfield clips when the hand-off says 30", () => {
    const h = { schema: "lahlah-edit/1", fps: 30, clips: ["S01", "S02", "S03"].map((s) => ({ src: `${s}.mp4` })) };
    const media = new Map(h.clips.map((c) => [c.src, clip(c.src.replace(".mp4", ""), 24)] as const));
    const p = projectFromHandoff(h, media);
    expect(p.fps).toBe(30);
    expect(clipsFrameRate(p)).toBe(24);
    const m = matchClipFrameRate(p);
    expect(m).toMatchObject({ from: 30, to: 24 });
    expect(m.project.fps).toBe(24);
    expect(matchClipFrameRate(m.project).to).toBeUndefined(); // already matching: no notice
  });

  it("goes with the clips that cover the most time and ignores unknown rates", () => {
    let p = newProject();
    const a = { ...clip("a", 30), duration: 2 };
    const b = { ...clip("b", 24), duration: 8 };
    p = { ...p, media: [a, b, clip("c")] };
    for (const m of p.media) p = addMediaToTimeline(p, m).project;
    expect(clipsFrameRate(p)).toBe(24);
  });

  // With LAHLAH_FFMPEG set: a 24 fps source exported at the matched rate has no repeated frames.
  const bin = process.env.LAHLAH_FFMPEG;
  it.skipIf(!bin)("exports 24 fps clips without duplicate frames", () => {
    const dir = join(tmpdir(), "lahlah-fps-test");
    mkdirSync(dir, { recursive: true });
    const src = join(dir, "seedance24.mp4");
    execFileSync(bin!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=496x864:r=24:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", src]);
    let stderr = "";
    try {
      execFileSync(bin!, ["-hide_banner", "-i", src], { stdio: "pipe" });
    } catch (e: any) {
      stderr = String(e.stderr);
    }
    const probe = parseProbe(stderr);
    expect(probe.fps).toBe(24);
    let p = newProject("fps", "9:16");
    const m: MediaItem = { ...clip("seedance24"), path: src, duration: probe.duration ?? 4, fps: probe.fps, hasAudio: false };
    p = addMediaToTimeline({ ...p, media: [m] }, m).project;
    p = matchClipFrameRate(p).project;
    expect(p.fps).toBe(24);
    // Frame counts: decimate drops repeated frames; count what is left.
    const kept = (fps: number) => {
      const out = join(dir, `out${fps}.mp4`);
      const { args } = buildFfmpegArgs({ project: p, opts: { width: 540, height: 960, fps, output: out, preset: "ultrafast" }, rasters: {}, pathOf: (x) => x.path! });
      execFileSync(bin!, args, { stdio: "pipe" });
      const r = execFileSync(bin!, ["-hide_banner", "-i", out, "-vf", "mpdecimate", "-fps_mode", "vfr", "-f", "framemd5", "-"], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
      return r.split("\n").filter((l) => /^0,/.test(l)).length;
    };
    const at24 = kept(24);
    const at30 = kept(30);
    expect(at24).toBeGreaterThanOrEqual(4 * 24 - 2); // every source frame survives once
    expect(at30).toBeLessThanOrEqual(4 * 24 + 2); // at 30 fps the extra frames are repeats
  }, 120_000);
});
