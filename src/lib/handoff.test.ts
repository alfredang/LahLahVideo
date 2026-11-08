import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aspectFor, checkHandoff, handoffSources, parseSrt, projectFromHandoff, toSrt, transitionFor, captionsOf } from "./handoff";
import { MediaItem } from "./types";
import { clipsOnTrack, mainTrack } from "./project";

const example = JSON.parse(readFileSync(new URL("../../examples/lahlah-edit.example.json", import.meta.url), "utf8"));

function resolve(h: any) {
  const map = new Map<string, MediaItem>();
  handoffSources(h).forEach((s, i) => map.set(s.src, { id: `m${i}`, name: s.src, kind: s.kind, url: s.src, duration: s.kind === "audio" ? 30 : 5, hasAudio: false }));
  return map;
}

describe("lahlah-edit/1 hand-off", () => {
  it("validates the example and tolerates missing optional fields", () => {
    expect(checkHandoff(example).ok).toBe(true);
    expect(checkHandoff({ schema: "lahlah-edit/1", clips: [{ src: "a.mp4" }] }).ok).toBe(true);
    expect(checkHandoff({ schema: "other", clips: [] }).ok).toBe(false);
    expect(checkHandoff({ schema: "lahlah-edit/1", clips: [] }).ok).toBe(false);
  });

  it("maps platform and transitions", () => {
    expect(aspectFor({ platform: "youtube" })).toBe("16:9");
    expect(aspectFor({ platform: "microdrama" })).toBe("9:16");
    expect(aspectFor({ aspect: "1:1", platform: "youtube" })).toBe("1:1");
    expect(transitionFor("crossfade")).toBe("crossfade");
    expect(transitionFor("dip")).toBe("dip");
    expect(transitionFor(undefined)).toBe("cut");
  });

  it("lays clips in order with trims, transitions, text, captions and music", () => {
    const p = projectFromHandoff(example, resolve(example));
    expect(p.name).toBe("Kopi & Coins Ep1 - The Rainy-Day Tin");
    expect(p.aspect).toBe("9:16");
    const main = clipsOnTrack(p, mainTrack(p).id);
    expect(main).toHaveLength(3);
    expect(main[1].inPoint).toBe(0.5);
    expect(main[1].duration).toBe(4);
    expect(main[1].transitionIn?.type).toBe("crossfade");
    expect(main[1].start).toBeCloseTo(4.5, 3); // 5s first clip minus a 0.5s crossfade
    expect(main[0].label).toBe("S01-SH01");
    expect(p.clips.filter((c) => c.trackId === "t_text")).toHaveLength(2);
    expect(captionsOf(p)).toHaveLength(2);
    const music = p.clips.find((c) => c.audioRole === "music");
    expect(music?.volume).toBe(0.6);
  });

  it("turns voice-over lines into subtitles when there is no captions array", () => {
    const h = { ...example, captions: undefined };
    const p = projectFromHandoff(h, resolve(h));
    expect(captionsOf(p).map((c) => c.text)[0]).toContain("Ah Ma");
  });
});

describe("SRT", () => {
  it("round-trips", () => {
    const caps = [
      { start: 0, end: 2.5, text: "Hello" },
      { start: 2.5, end: 65.123, text: "Two\nlines" },
    ];
    const srt = toSrt(caps);
    expect(srt).toContain("00:01:05,123");
    expect(parseSrt(srt)).toEqual(caps);
  });
});
