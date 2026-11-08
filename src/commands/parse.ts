// Plain-English command parser. Rule based, runs offline, no API key.
// Typed or dictated (LahLah Voice on Mac, Win+H on Windows) text comes in; a Command comes out.
import type { AspectId, TransitionType } from "../lib/types";

export type Command =
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "seek"; t: number }
  | { kind: "seek-rel"; dt: number }
  | { kind: "split"; at?: number }
  | { kind: "delete"; ripple: boolean }
  | { kind: "duplicate" }
  | { kind: "trim"; edge: "start" | "end"; to?: number; by?: number }
  | { kind: "speed"; value: number }
  | { kind: "mute"; on: boolean }
  | { kind: "volume"; value?: number; step?: 1 | -1 }
  | { kind: "add-text"; text: string; at?: number; duration?: number }
  | { kind: "transition"; type: TransitionType; duration?: number }
  | { kind: "aspect"; aspect: AspectId }
  | { kind: "add-music" }
  | { kind: "import" }
  | { kind: "record-vo" }
  | { kind: "zoom"; dir: 1 | -1 }
  | { kind: "scale"; dir: 1 | -1 }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "export"; preset?: "tiktok" | "shorts" | "youtube"; quality?: "720p" | "1080p" | "4k" }
  | { kind: "save" }
  | { kind: "open" }
  | { kind: "fade"; which: "in" | "out" | "both"; duration?: number }
  | { kind: "look"; look: string }
  | { kind: "sticker"; emoji: string }
  | { kind: "select"; which: "next" | "prev" | "first" | "last" }
  | { kind: "flip"; axis: "h" | "v" }
  | { kind: "rotate"; deg: number }
  | { kind: "auto-captions" }
  | { kind: "background"; type: "blur" | "color" }
  | { kind: "help" };

export type ParseResult = { ok: true; command: Command; say: string } | { ok: false; error: string; suggestions: string[] };

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Replace spelled-out numbers ("one point five", "twenty two", "two and a half") with digits. */
export function wordsToDigits(input: string): string {
  const toks = input.split(/(\s+|-)/);
  const words = toks.filter((t) => !/^(\s+|-)$/.test(t));
  const out: string[] = [];
  const isNumWord = (w: string) => w in UNITS || w in TENS;
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    // "a"/"an" only count as one when followed by a unit word ("a second" is handled below by context)
    if (isNumWord(w) && !(w === "a" || w === "an" || w === "oh")) {
      let v = 0;
      if (w in TENS) {
        v = TENS[w];
        if (words[i + 1] && words[i + 1] in UNITS && UNITS[words[i + 1]] < 10 && !["a", "an", "oh"].includes(words[i + 1])) {
          v += UNITS[words[i + 1]];
          i++;
        }
      } else v = UNITS[w];
      i++;
      let num = String(v);
      if (words[i] === "point" && words[i + 1] && (words[i + 1] in UNITS || /^\d$/.test(words[i + 1]))) {
        let dec = "";
        i++;
        while (words[i] && (words[i] in UNITS || /^\d$/.test(words[i])) && !["a", "an"].includes(words[i])) {
          dec += words[i] in UNITS ? String(UNITS[words[i]]) : words[i];
          i++;
        }
        num = `${v}.${dec}`;
      } else if (words[i] === "and" && words[i + 1] === "a" && words[i + 2] === "half") {
        num = String(v + 0.5);
        i += 3;
      }
      out.push(num);
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(w) && words[i + 1] === "and" && words[i + 2] === "a" && words[i + 3] === "half") {
      out.push(String(Number(w) + 0.5));
      i += 4;
      continue;
    }
    if (w === "half" && (words[i + 1] === "a" || words[i + 1] === "second")) {
      // "half a second" -> 0.5
      out.push("0.5");
      i += words[i + 1] === "a" ? 2 : 1;
      continue;
    }
    out.push(w);
    i++;
  }
  return out.join(" ");
}

/** Strip wake words and punctuation that dictation adds. Returns lower-case text. */
export function normalise(raw: string): string {
  let s = raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
  s = s.replace(/^(hey\s+|ok(ay)?\s+)?(lah\s*lah\s*video|lahlah|lah\s*lah|video)\s*[,:.!-]?\s+/i, "");
  s = s.replace(/[.!?]+$/g, "").trim();
  return s;
}

const TIME_RE = /(\d+):(\d{1,2}(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min|m)\b\s*(?:and\s*)?(?:(\d+(?:\.\d+)?)\s*(?:seconds|second|secs|sec|s)\b)?|(\d+(?:\.\d+)?)\s*(?:seconds|second|secs|sec|s)\b|(\d+(?:\.\d+)?)/;

/** Parse the first time mention in a string, in seconds. */
export function parseTime(s: string): number | undefined {
  const m = TIME_RE.exec(s);
  if (!m) return undefined;
  if (m[1] !== undefined) return Number(m[1]) * 60 + Number(m[2]);
  if (m[3] !== undefined) return Number(m[3]) * 60 + (m[4] ? Number(m[4]) : 0);
  if (m[5] !== undefined) return Number(m[5]);
  if (m[6] !== undefined) return Number(m[6]);
  return undefined;
}

function timeAfter(s: string, words: string[]): number | undefined {
  for (const w of words) {
    const idx = s.search(new RegExp(`\\b${w}\\b`));
    if (idx >= 0) {
      const t = parseTime(s.slice(idx + w.length));
      if (t !== undefined) return t;
    }
  }
  return undefined;
}

const TRANSITION_WORDS: [RegExp, TransitionType][] = [
  [/cross\s*-?\s*fade|crossfade|dissolve|fade (between|transition)/, "crossfade"],
  [/\bslide\b|\bpush\b/, "slide"],
  [/\bzoom (transition|between)|zoom transition|\bzoom\b/, "zoom"],
  [/\bwipe\b/, "wipe"],
  [/dip|fade (to|through) black|black fade/, "dip"],
  [/\bcut\b|hard cut|no transition|remove (the )?transition/, "cut"],
];

const LOOK_WORDS: [RegExp, string][] = [
  [/kopi|warm/, "kopi-warm"],
  [/shiok|pop|vivid|vibrant/, "shiok-pop"],
  [/noir|black and white|b ?& ?w|grayscale|greyscale|mono/, "noir"],
  [/vintage|retro|old/, "vintage"],
  [/cool|night|blue/, "cool-night"],
  [/soft|film/, "soft-film"],
  [/golden|sunset/, "golden-hour"],
  [/original|no filter|remove (the )?filter|clear (the )?filter/, "none"],
];

const STICKER_WORDS: Record<string, string> = {
  fire: "🔥", laugh: "😂", laughing: "😂", heart: "❤️", love: "😍", thumbs: "👍", "thumbs up": "👍", clap: "👏", party: "🎉",
  hundred: "💯", sparkle: "✨", sparkles: "✨", wow: "😮", "mind blown": "🤯", money: "💰", coffee: "☕", kopi: "☕", rain: "🌧️",
  star: "⭐", tick: "✅", check: "✅", cross: "❌", pin: "📌", coin: "🪙", singapore: "🇸🇬",
};

export const EXAMPLES = [
  "play",
  "pause",
  "split at 3 seconds",
  "split here",
  "delete clip",
  "ripple delete",
  "trim start to 1.5 seconds",
  "trim end to 4 seconds",
  "speed up 2x",
  "slow down",
  "mute",
  "volume 50%",
  "add text 'Save first' at 2 seconds",
  "add crossfade",
  "add slide transition",
  "make it vertical",
  "make it YouTube",
  "make it square",
  "add music",
  "record voice-over",
  "zoom in",
  "make it bigger",
  "fade in",
  "add filter kopi warm",
  "add sticker fire",
  "go to 10 seconds",
  "next clip",
  "duplicate",
  "undo",
  "redo",
  "export for TikTok",
  "export for YouTube in 4K",
  "save project",
];

function ok(command: Command, say: string): ParseResult {
  return { ok: true, command, say };
}

export function parseCommand(raw: string): ParseResult {
  const original = normalise(raw);
  if (!original) return { ok: false, error: "Type or say a command.", suggestions: EXAMPLES.slice(0, 6) };

  // Text content keeps its case, so pull it out before lower-casing.
  const textMatch = /^(?:please\s+)?(?:add|put|insert|write|type|show)\s+(?:a\s+|the\s+)?(?:text|title|caption|words?|label)\s*(?:saying|that says|reading|:)?\s*(.+)$/i.exec(original);
  if (textMatch) {
    let body = textMatch[1].trim();
    let quoted = /^["'](.+?)["']\s*(.*)$/.exec(body);
    let text: string;
    let rest: string;
    if (quoted) {
      text = quoted[1];
      rest = quoted[2];
    } else {
      const cut = body.search(/\s+(?:at|from|for)\s+(?:\d|[a-z]+\s+(?:second|sec|seconds))/i);
      const lowerCut = cut >= 0 ? cut : body.search(/\s+(?:at|from|for)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
      text = (lowerCut >= 0 ? body.slice(0, lowerCut) : body).trim();
      rest = lowerCut >= 0 ? body.slice(lowerCut) : "";
    }
    const r = wordsToDigits(rest.toLowerCase());
    const at = timeAfter(r, ["at", "from"]);
    const duration = timeAfter(r, ["for"]);
    if (!text) return { ok: false, error: "What should the text say? Try: add text 'Save first' at 2 seconds", suggestions: [] };
    return ok({ kind: "add-text", text, at, duration }, `Adding text "${text}"${at !== undefined ? ` at ${at}s` : ""}`);
  }

  const s = wordsToDigits(original.toLowerCase()).replace(/\bplease\b|\bcan you\b|\bcould you\b|\bnow\b/g, " ").replace(/\s+/g, " ").trim();

  // ----- help, history, project -----
  if (/^(help|commands|what can (i|you) (say|do)|show commands|cheat ?sheet)$/.test(s)) return ok({ kind: "help" }, "Here is what you can say");
  if (/^(undo|undo that|go back|oops)$/.test(s)) return ok({ kind: "undo" }, "Undo");
  if (/^(redo|redo that)$/.test(s)) return ok({ kind: "redo" }, "Redo");
  if (/^(save|save (the )?project|save (it|my work)|save video project)$/.test(s)) return ok({ kind: "save" }, "Saving project");
  if (/^open( (a |the )?(project|file|hand-?off))?$/.test(s)) return ok({ kind: "open" }, "Open a project");
  if (/\b(auto[- ]?captions?|generate captions|transcribe)\b/.test(s)) return ok({ kind: "auto-captions" }, "Auto-captions");

  // ----- export -----
  if (/^(export|render|publish|download)\b/.test(s)) {
    const quality = /\b4 ?k\b|2160/.test(s) ? "4k" : /\b720\b/.test(s) ? "720p" : /\b1080\b/.test(s) ? "1080p" : undefined;
    const preset = /tik ?tok|reels?|instagram/.test(s) ? "tiktok" : /shorts?/.test(s) ? "shorts" : /you ?tube|landscape|16 ?: ?9|wide/.test(s) ? "youtube" : undefined;
    return ok({ kind: "export", preset, quality }, `Export${preset ? ` for ${preset === "youtube" ? "YouTube" : preset === "shorts" ? "YouTube Shorts" : "TikTok"}` : ""}`);
  }

  // ----- playback and navigation -----
  if (/^(play|start|resume|go|play (it|video|from here)|preview)$/.test(s)) return ok({ kind: "play" }, "Playing");
  if (/^(pause|stop|hold on|wait|freeze)$/.test(s)) return ok({ kind: "pause" }, "Paused");
  if (/^(play from (the )?(start|beginning)|restart)$/.test(s)) return ok({ kind: "seek", t: 0 }, "Back to the start");
  if (/^(go to|jump to|skip to|move to|seek to)\b/.test(s)) {
    if (/\b(start|beginning)\b/.test(s)) return ok({ kind: "seek", t: 0 }, "Back to the start");
    if (/\bend\b/.test(s)) return ok({ kind: "seek", t: Number.MAX_SAFE_INTEGER }, "Jump to the end");
    const t = parseTime(s);
    if (t !== undefined) return ok({ kind: "seek", t }, `Jump to ${t}s`);
  }
  {
    const m = /^(?:skip|go|jump) (forward|ahead|back|backward|backwards)(?: by)? ?(.*)$/.exec(s);
    if (m) {
      const amt = parseTime(m[2]) ?? 5;
      return ok({ kind: "seek-rel", dt: m[1].startsWith("back") ? -amt : amt }, `Skip ${m[1].startsWith("back") ? "back" : "forward"} ${amt}s`);
    }
  }
  if (/^(next|following) clip$|^select (the )?next( clip)?$/.test(s)) return ok({ kind: "select", which: "next" }, "Next clip");
  if (/^(previous|prev|last) clip$|^select (the )?previous( clip)?$/.test(s)) return ok({ kind: "select", which: "prev" }, "Previous clip");
  if (/^(first|select (the )?first) clip$/.test(s)) return ok({ kind: "select", which: "first" }, "First clip");

  // ----- editing -----
  if (/^(split|cut|split here|cut here|split (it|the clip|clip)( here)?|split at (the )?playhead|cut at (the )?playhead)$/.test(s)) return ok({ kind: "split" }, "Split at the playhead");
  if (/^(split|cut)\b.*\b(at|on)\b/.test(s)) {
    const t = parseTime(s.replace(/^.*\b(at|on)\b/, ""));
    if (t !== undefined) return ok({ kind: "split", at: t }, `Split at ${t}s`);
  }
  if (/ripple delete|delete and close (the )?gap|remove and close/.test(s)) return ok({ kind: "delete", ripple: true }, "Ripple delete");
  if (/^(delete|remove|trash|get rid of)( (this|that|the|selected))?( clip| it| this| that| selection)?$/.test(s)) return ok({ kind: "delete", ripple: false }, "Delete clip");
  if (/^(duplicate|copy|clone)( (this|the|that))?( clip| it)?$/.test(s)) return ok({ kind: "duplicate" }, "Duplicate clip");

  {
    const m = /^(?:trim|cut|set) (?:the )?(start|beginning|in|end|out)(?: point)?(?: of (?:the |this )?clip)? (?:to|at) (.+)$/.exec(s);
    if (m) {
      const t = parseTime(m[2]);
      if (t !== undefined) {
        const edge = /start|beginning|in/.test(m[1]) ? "start" : "end";
        return ok({ kind: "trim", edge, to: t }, `Trim ${edge} to ${t}s`);
      }
    }
    const m2 = /^(?:trim|cut|remove) (?:off )?(?:the )?(first|last) (.+)$/.exec(s);
    if (m2) {
      const t = parseTime(m2[2]);
      if (t !== undefined) return ok({ kind: "trim", edge: m2[1] === "first" ? "start" : "end", by: t }, `Trim ${t}s off the ${m2[1] === "first" ? "start" : "end"}`);
    }
    const m3 = /^trim (\S+(?: seconds?| secs?|s)?) (?:from|off) (?:the )?(start|beginning|end)$/.exec(s);
    if (m3) {
      const t = parseTime(m3[1]);
      if (t !== undefined) return ok({ kind: "trim", edge: m3[2] === "end" ? "end" : "start", by: t }, `Trim ${t}s off the ${m3[2]}`);
    }
  }

  // ----- speed -----
  {
    const factor = (() => {
      const x = /(\d+(?:\.\d+)?)\s*(?:x|times)\b/.exec(s);
      if (x) return Number(x[1]);
      if (/double/.test(s)) return 2;
      if (/half|halve/.test(s)) return 0.5;
      if (/quarter/.test(s)) return 0.25;
      return undefined;
    })();
    if (/^(normal|reset) speed$|^speed (to )?(normal|1x|1 x)$|^real ?time$/.test(s)) return ok({ kind: "speed", value: 1 }, "Normal speed");
    if (/speed up|faster|fast forward|speed it up|^speed\b|double speed|time ?lapse/.test(s)) {
      const v = factor ?? 2;
      return ok({ kind: "speed", value: v }, `Speed ${v}x`);
    }
    if (/slow (it )?down|slower|slow ?mo|slow motion|half speed/.test(s)) {
      const v = factor && factor < 1 ? factor : factor && factor > 1 ? 1 / factor : 0.5;
      return ok({ kind: "speed", value: v }, `Speed ${v}x`);
    }
  }

  // ----- audio -----
  if (/^(unmute|sound on|turn (the )?sound on|unmute (it|clip|the clip))$/.test(s)) return ok({ kind: "mute", on: false }, "Sound on");
  if (/^(mute|silence|sound off|turn (the )?sound off|mute (it|clip|the clip|this))$/.test(s)) return ok({ kind: "mute", on: true }, "Muted");
  {
    const m = /volume (?:to )?(\d+(?:\.\d+)?)\s*(%|percent)?/.exec(s);
    if (m) {
      const v = Number(m[1]);
      const value = m[2] || v > 4 ? v / 100 : v;
      return ok({ kind: "volume", value }, `Volume ${Math.round(value * 100)}%`);
    }
    if (/^(louder|volume up|turn (it )?up)$/.test(s)) return ok({ kind: "volume", step: 1 }, "Louder");
    if (/^(quieter|softer|volume down|turn (it )?down)$/.test(s)) return ok({ kind: "volume", step: -1 }, "Quieter");
  }
  if (/(add|insert|put in|import) (some |background )?(music|song|track|soundtrack|bgm)|^music$/.test(s)) return ok({ kind: "add-music" }, "Pick a music file");
  if (/record|voice ?-?over|narrat/.test(s)) return ok({ kind: "record-vo" }, "Record a voice-over");
  if (/^(import|add|open) (a |some )?(video|clip|photo|image|picture|media|file)s?$|^import$/.test(s)) return ok({ kind: "import" }, "Import media");

  // ----- transitions -----
  if (/transition|crossfade|cross fade|dissolve|\bwipe\b|\bslide\b|dip to black|fade to black|fade through black/.test(s) && !/^fade (in|out)/.test(s)) {
    for (const [re, type] of TRANSITION_WORDS) {
      if (re.test(s)) {
        const d = timeAfter(s, ["for", "of", "lasting"]);
        return ok({ kind: "transition", type, duration: d }, type === "cut" ? "Removed the transition" : `Added a ${type} transition`);
      }
    }
    return ok({ kind: "transition", type: "crossfade" }, "Added a crossfade transition");
  }

  // ----- fades -----
  {
    const m = /^(?:add (?:a )?)?fade (in|out|in and out|both)(.*)$/.exec(s);
    if (m) {
      const which = m[1] === "in" ? "in" : m[1] === "out" ? "out" : "both";
      return ok({ kind: "fade", which, duration: parseTime(m[2]) }, `Fade ${m[1]}`);
    }
  }

  // ----- canvas -----
  if (/^(make it|switch to|change to|set|canvas|format|aspect|resize( to)?|ratio)\b|vertical|portrait|landscape|square|widescreen|9 ?: ?16|16 ?: ?9|1 ?: ?1|4 ?: ?5/.test(s)) {
    if (/9 ?: ?16|vertical|portrait|tik ?tok|shorts|reels?|story/.test(s)) return ok({ kind: "aspect", aspect: "9:16" }, "Vertical 9:16 for TikTok and Shorts");
    if (/16 ?: ?9|you ?tube|landscape|horizontal|widescreen|wide/.test(s)) return ok({ kind: "aspect", aspect: "16:9" }, "Landscape 16:9 for YouTube");
    if (/1 ?: ?1|square/.test(s)) return ok({ kind: "aspect", aspect: "1:1" }, "Square 1:1");
    if (/4 ?: ?5|instagram|feed/.test(s)) return ok({ kind: "aspect", aspect: "4:5" }, "Portrait 4:5");
    if (/bigger|larger/.test(s)) return ok({ kind: "scale", dir: 1 }, "Bigger");
    if (/smaller/.test(s)) return ok({ kind: "scale", dir: -1 }, "Smaller");
  }
  if (/blur(red)? background|background blur/.test(s)) return ok({ kind: "background", type: "blur" }, "Blurred background");
  if (/black background|background (black|colou?r)|solid background/.test(s)) return ok({ kind: "background", type: "color" }, "Solid background");

  // ----- zoom, scale, flip, rotate -----
  if (/^zoom (in|closer)( on (the )?timeline)?$/.test(s)) return ok({ kind: "zoom", dir: 1 }, "Timeline zoom in");
  if (/^zoom out( on (the )?timeline)?$/.test(s)) return ok({ kind: "zoom", dir: -1 }, "Timeline zoom out");
  if (/bigger|scale up|enlarge|zoom in on (the )?(clip|video)|larger/.test(s)) return ok({ kind: "scale", dir: 1 }, "Bigger");
  if (/smaller|scale down|shrink|zoom out on (the )?(clip|video)/.test(s)) return ok({ kind: "scale", dir: -1 }, "Smaller");
  if (/^flip( it)?( horizontal(ly)?| sideways| left| right| mirror)?$|^mirror( it)?$/.test(s)) return ok({ kind: "flip", axis: "h" }, "Flipped horizontally");
  if (/flip (it )?(vertical(ly)?|upside down)/.test(s)) return ok({ kind: "flip", axis: "v" }, "Flipped vertically");
  {
    const m = /^rotate(?: it)?(?: by)?(?: (\-?\d+(?:\.\d+)?))?(?: degrees?)?( left| right| anticlockwise| counterclockwise| clockwise)?$/.exec(s);
    if (m) {
      const deg = m[1] ? Number(m[1]) : 90;
      const sign = /left|anti|counter/.test(m[2] ?? "") ? -1 : 1;
      return ok({ kind: "rotate", deg: deg * sign }, `Rotate ${deg * sign}°`);
    }
  }

  // ----- looks and stickers -----
  if (/filter|look|effect|black and white|grayscale|greyscale|vintage|noir/.test(s)) {
    for (const [re, look] of LOOK_WORDS) if (re.test(s.replace(/filter|look|effect|add|apply|use/g, ""))) return ok({ kind: "look", look }, `Look: ${look}`);
    return ok({ kind: "look", look: "kopi-warm" }, "Look: kopi-warm");
  }
  if (/sticker|emoji/.test(s)) {
    const key = Object.keys(STICKER_WORDS)
      .sort((a, b) => b.length - a.length)
      .find((k) => s.includes(k));
    return ok({ kind: "sticker", emoji: key ? STICKER_WORDS[key] : "🔥" }, `Sticker ${key ? STICKER_WORDS[key] : "🔥"}`);
  }

  return {
    ok: false,
    error: `I didn't catch "${raw.trim()}".`,
    suggestions: suggest(s),
  };
}

function suggest(s: string): string[] {
  const words = new Set(s.split(" "));
  const scored = EXAMPLES.map((e) => ({ e, score: e.split(" ").filter((w) => words.has(w)).length })).sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((x) => x.e);
}
