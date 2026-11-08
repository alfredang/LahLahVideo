import { describe, expect, it } from "vitest";
import { Command, EXAMPLES, parseCommand, parseTime, wordsToDigits } from "./parse";
import { VOICE_GROUPS } from "./cheatsheet";

const cmd = (s: string): Command => {
  const r = parseCommand(s);
  if (!r.ok) throw new Error(`Did not parse: ${s} (${r.error})`);
  return r.command;
};

describe("number words", () => {
  it("turns spoken numbers into digits", () => {
    expect(wordsToDigits("split at three seconds")).toBe("split at 3 seconds");
    expect(wordsToDigits("trim start to one point five seconds")).toBe("trim start to 1.5 seconds");
    expect(wordsToDigits("go to twenty two seconds")).toBe("go to 22 seconds");
    expect(wordsToDigits("two and a half seconds")).toBe("2.5 seconds");
    expect(wordsToDigits("half a second")).toBe("0.5 second");
  });
  it("parses time formats", () => {
    expect(parseTime("at 3 seconds")).toBe(3);
    expect(parseTime("1:05")).toBe(65);
    expect(parseTime("1.5s")).toBe(1.5);
    expect(parseTime("2 minutes 10 seconds")).toBe(130);
    expect(parseTime("nothing")).toBeUndefined();
  });
});

describe("parseCommand", () => {
  it("handles every cheat-sheet example", () => {
    for (const e of EXAMPLES) expect(parseCommand(e).ok, e).toBe(true);
    for (const g of VOICE_GROUPS) for (const e of g.items) expect(parseCommand(e).ok, e).toBe(true);
  });

  it("covers the course command list", () => {
    expect(cmd("play")).toEqual({ kind: "play" });
    expect(cmd("pause")).toEqual({ kind: "pause" });
    expect(cmd("split at 3 seconds")).toEqual({ kind: "split", at: 3 });
    expect(cmd("split here")).toEqual({ kind: "split" });
    expect(cmd("delete clip")).toEqual({ kind: "delete", ripple: false });
    expect(cmd("trim start to 1.5 seconds")).toEqual({ kind: "trim", edge: "start", to: 1.5 });
    expect(cmd("speed up 2x")).toEqual({ kind: "speed", value: 2 });
    expect(cmd("slow down")).toEqual({ kind: "speed", value: 0.5 });
    expect(cmd("mute")).toEqual({ kind: "mute", on: true });
    expect(cmd("add text 'Save first' at 2 seconds")).toEqual({ kind: "add-text", text: "Save first", at: 2, duration: undefined });
    expect(cmd("add crossfade")).toMatchObject({ kind: "transition", type: "crossfade" });
    expect(cmd("make it vertical")).toEqual({ kind: "aspect", aspect: "9:16" });
    expect(cmd("make it 9:16")).toEqual({ kind: "aspect", aspect: "9:16" });
    expect(cmd("make it YouTube")).toEqual({ kind: "aspect", aspect: "16:9" });
    expect(cmd("add music")).toEqual({ kind: "add-music" });
    expect(cmd("zoom in")).toEqual({ kind: "zoom", dir: 1 });
    expect(cmd("undo")).toEqual({ kind: "undo" });
    expect(cmd("redo")).toEqual({ kind: "redo" });
    expect(cmd("export for TikTok")).toMatchObject({ kind: "export", preset: "tiktok" });
    expect(cmd("save project")).toEqual({ kind: "save" });
  });

  it("copes with dictation: wake words, punctuation, spelled numbers", () => {
    expect(cmd("Video, split at three seconds.")).toEqual({ kind: "split", at: 3 });
    expect(cmd("LahLah Video, play.")).toEqual({ kind: "play" });
    expect(cmd("Video: add text save first at two seconds")).toEqual({ kind: "add-text", text: "save first", at: 2, duration: undefined });
    expect(cmd("add title “Kopi & Coins” at 1 second for 3 seconds")).toEqual({ kind: "add-text", text: "Kopi & Coins", at: 1, duration: 3 });
    expect(cmd("Trim start to one point five seconds")).toEqual({ kind: "trim", edge: "start", to: 1.5 });
  });

  it("understands variations", () => {
    expect(cmd("ripple delete")).toEqual({ kind: "delete", ripple: true });
    expect(cmd("cut the first 2 seconds")).toEqual({ kind: "trim", edge: "start", by: 2 });
    expect(cmd("trim end to 4 seconds")).toEqual({ kind: "trim", edge: "end", to: 4 });
    expect(cmd("slow down 4x")).toEqual({ kind: "speed", value: 0.25 });
    expect(cmd("half speed")).toEqual({ kind: "speed", value: 0.5 });
    expect(cmd("normal speed")).toEqual({ kind: "speed", value: 1 });
    expect(cmd("unmute")).toEqual({ kind: "mute", on: false });
    expect(cmd("volume 50%")).toEqual({ kind: "volume", value: 0.5 });
    expect(cmd("make it square")).toEqual({ kind: "aspect", aspect: "1:1" });
    expect(cmd("make it bigger")).toEqual({ kind: "scale", dir: 1 });
    expect(cmd("add slide transition")).toMatchObject({ kind: "transition", type: "slide" });
    expect(cmd("dip to black")).toMatchObject({ kind: "transition", type: "dip" });
    expect(cmd("add wipe")).toMatchObject({ kind: "transition", type: "wipe" });
    expect(cmd("remove transition")).toMatchObject({ kind: "transition", type: "cut" });
    expect(cmd("fade in")).toMatchObject({ kind: "fade", which: "in" });
    expect(cmd("fade out")).toMatchObject({ kind: "fade", which: "out" });
    expect(cmd("make it black and white")).toEqual({ kind: "look", look: "noir" });
    expect(cmd("add filter kopi warm")).toEqual({ kind: "look", look: "kopi-warm" });
    expect(cmd("add sticker fire")).toEqual({ kind: "sticker", emoji: "🔥" });
    expect(cmd("go to 10 seconds")).toEqual({ kind: "seek", t: 10 });
    expect(cmd("go to the start")).toEqual({ kind: "seek", t: 0 });
    expect(cmd("skip forward 5 seconds")).toEqual({ kind: "seek-rel", dt: 5 });
    expect(cmd("next clip")).toEqual({ kind: "select", which: "next" });
    expect(cmd("export for YouTube in 4K")).toEqual({ kind: "export", preset: "youtube", quality: "4k" });
    expect(cmd("export for YouTube Shorts")).toMatchObject({ kind: "export", preset: "shorts" });
    expect(cmd("record voice-over")).toEqual({ kind: "record-vo" });
    expect(cmd("rotate 90 degrees")).toEqual({ kind: "rotate", deg: 90 });
    expect(cmd("flip")).toEqual({ kind: "flip", axis: "h" });
    expect(cmd("auto captions")).toEqual({ kind: "auto-captions" });
    expect(cmd("help")).toEqual({ kind: "help" });
  });

  it("fails politely with suggestions", () => {
    const r = parseCommand("make me a sandwich");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestions.length).toBeGreaterThan(0);
    expect(parseCommand("   ").ok).toBe(false);
  });
});
