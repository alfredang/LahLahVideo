// A built-in "Kopi & Coins" demo so learners can try every tool before Higgsfield clips arrive.
// Scenes are drawn on canvas and the music is synthesised, so nothing is downloaded.
import { MediaItem, Project } from "./types";
import { addCaption, addMediaToTimeline, addSticker, addText, newProject, setTransition, touch, uid, updateClip } from "./project";
import { cacheDir, isDesktop, joinPath, mediaFromPath, writeBinary } from "./platform";

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

const grad = (g: CanvasRenderingContext2D, h: number, a: string, b: string) => {
  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, a);
  lg.addColorStop(1, b);
  return lg;
};

const coin = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  g.fillStyle = "#c98a1b";
  g.beginPath();
  g.ellipse(x, y + r * 0.12, r, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffcf4a";
  g.beginPath();
  g.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#e3a82a";
  g.lineWidth = r * 0.08;
  g.beginPath();
  g.ellipse(x, y, r * 0.72, r * 0.3, 0, 0, Math.PI * 2);
  g.stroke();
};

const SCENES: { name: string; paint: Painter }[] = [
  {
    name: "01 rainy window.png",
    paint: (g, w, h) => {
      g.fillStyle = grad(g, h, "#0b1e3a", "#28507a");
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(190,220,255,0.35)";
      g.lineWidth = 4;
      for (let i = 0; i < 160; i++) {
        const x = (i * 97) % w;
        const y = (i * 263) % h;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 18, y + 70);
        g.stroke();
      }
      g.strokeStyle = "#3a2516";
      g.lineWidth = 40;
      g.strokeRect(120, 300, w - 240, h - 900);
      g.beginPath();
      g.moveTo(w / 2, 300);
      g.lineTo(w / 2, h - 600);
      g.stroke();
      g.fillStyle = "#5b3a22";
      g.fillRect(0, h - 520, w, 520);
    },
  },
  {
    name: "02 biscuit tin.png",
    paint: (g, w, h) => {
      g.fillStyle = grad(g, h, "#4a2a14", "#a0612c");
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#1f6f8b";
      g.beginPath();
      g.ellipse(w / 2, h * 0.62, 360, 140, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(w / 2 - 360, h * 0.45, 720, h * 0.17);
      g.fillStyle = "#2a8fb2";
      g.beginPath();
      g.ellipse(w / 2, h * 0.45, 360, 140, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#ffd36b";
      g.lineWidth = 16;
      g.beginPath();
      g.ellipse(w / 2, h * 0.45, 330, 120, 0, 0, Math.PI * 2);
      g.stroke();
    },
  },
  {
    name: "03 coins.png",
    paint: (g, w, h) => {
      g.fillStyle = grad(g, h, "#0f4c4a", "#1b8a7a");
      g.fillRect(0, 0, w, h);
      for (let s = 0; s < 3; s++) for (let i = 0; i < 6 + s * 3; i++) coin(g, 260 + s * 280, h * 0.72 - i * 46, 120);
    },
  },
  {
    name: "04 save first.png",
    paint: (g, w, h) => {
      g.fillStyle = grad(g, h, "#ff5f7e", "#ffb347");
      g.fillRect(0, 0, w, h);
      coin(g, w / 2, h * 0.5, 330);
      g.fillStyle = "#b5730f";
      g.font = "bold 260px Georgia, serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("$", w / 2, h * 0.5);
    },
  },
];

function paint(p: Painter): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  p(c.getContext("2d")!, c.width, c.height);
  return c;
}

/** A soft 12-second lo-fi loop as a 16-bit mono WAV. */
function synthMusic(seconds = 12, rate = 22050): Uint8Array {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  const chords = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
    [164.81, 207.65, 246.94],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const ch = chords[Math.floor(t / 1.5) % chords.length];
    const beat = t % 0.375;
    const note = ch[Math.floor(t / 0.375) % 3] * 2;
    let s = ch.reduce((a, f) => a + Math.sin(2 * Math.PI * f * t), 0) * 0.08;
    s += Math.sin(2 * Math.PI * note * t) * Math.exp(-beat * 9) * 0.18;
    const env = Math.min(1, t / 0.5, (seconds - t) / 1);
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * env)) * 32767, true);
  }
  return new Uint8Array(buf);
}

async function toMedia(name: string, bytes: Uint8Array, kind: "image" | "audio", mime: string, duration: number): Promise<MediaItem> {
  if (isDesktop) {
    const path = await joinPath(await cacheDir("demo"), name);
    await writeBinary(path, bytes);
    const m = await mediaFromPath(path, "demo");
    if (m) return m;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  return { id: uid("med"), name, kind, url, duration, width: kind === "image" ? 1080 : undefined, height: kind === "image" ? 1920 : undefined, thumb: kind === "image" ? url : undefined, origin: "demo" };
}

export async function buildDemoProject(): Promise<Project> {
  const media: MediaItem[] = [];
  for (const s of SCENES) {
    const cv = paint(s.paint);
    const blob: Blob = await new Promise((r) => cv.toBlob((b) => r(b!), "image/png"));
    media.push(await toMedia(s.name, new Uint8Array(await blob.arrayBuffer()), "image", "image/png", 0));
  }
  const music = await toMedia("lofi-kopi-loop.wav", synthMusic(), "audio", "audio/wav", 12);
  let p = newProject("Kopi & Coins - demo", "9:16");
  p = { ...p, media: [...media, music] };
  const ids: string[] = [];
  for (const m of media) {
    const r = addMediaToTimeline(p, m);
    p = updateClip(r.project, r.clip.id, { duration: 3.2 });
    ids.push(r.clip.id);
  }
  p = updateClip(p, ids[0], { keyframes: [{ t: 0, scale: 1 }, { t: 3.2, scale: 1.15 }], fadeIn: 0.4 });
  p = updateClip(p, ids[2], (c) => ({ adjust: { ...c.adjust, brightness: 0.02, contrast: 1.05, saturation: 1.15, temperature: 0.45, vignette: 0.15, look: "kopi-warm" } }));
  p = setTransition(p, ids[1], "crossfade", 0.5);
  p = setTransition(p, ids[2], "slide", 0.4);
  p = setTransition(p, ids[3], "zoom", 0.5);
  p = updateClip(p, ids[3], { fadeOut: 0.6 });
  p = addText(p, "Kopi & Coins", { at: 0.2, duration: 2.6, preset: "headline", y: -0.3 }).project;
  p = addText(p, "Save first, spend later", { at: 8.2, duration: 3.6, preset: "yellow", y: -0.28 }).project;
  p = addSticker(p, "☕", 3.2).project;
  const lines = ["Every rainy day, Ah Ma opened the same old tin.", "Inside: coins from every kopi she skipped.", "Small coins. Big rainy-day fund.", "Your turn. Save first."];
  lines.forEach((l, i) => (p = addCaption(p, i * 2.9 + 0.2, i * 2.9 + 3, l)));
  const r = addMediaToTimeline(p, music, { trackId: "t_music", at: 0 });
  p = updateClip(r.project, r.clip.id, { volume: 0.5, fadeOut: 1, audioRole: "music" });
  return touch(p);
}

/** Library: the built-in lo-fi loop, made on the fly (no download, no licence worries). */
export async function libraryMusic(): Promise<MediaItem> {
  return toMedia("lofi-kopi-loop.wav", synthMusic(), "audio", "audio/wav", 12);
}
