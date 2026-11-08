// Text and stickers are drawn with <canvas> for both the preview and the export,
// so what you see is what FFmpeg burns into the MP4 (emoji included).
import { Clip, TextStyle } from "./types";

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw a text style at scale k (k = output pixels per reference pixel). maxWidth is in reference px. */
export function drawText(style: TextStyle, k: number, maxWidth: number): HTMLCanvasElement {
  const size = Math.max(8, style.size * k);
  const font = `${style.italic ? "italic " : ""}${style.bold ? "700" : "500"} ${size}px ${style.font}`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  const lines = wrap(probe, style.content || " ", maxWidth * k);
  const lineH = size * 1.2;
  const textW = Math.max(...lines.map((l) => probe.measureText(l).width), size);
  const pad = style.bg ? size * 0.35 : style.stroke ? size * 0.12 : size * 0.05;
  const c = document.createElement("canvas");
  c.width = Math.ceil(textW + pad * 2);
  c.height = Math.ceil(lineH * lines.length + pad * 2);
  const ctx = c.getContext("2d")!;
  if (style.bg) {
    ctx.fillStyle = style.bg;
    roundRect(ctx, 0, 0, c.width, c.height, size * 0.25);
    ctx.fill();
  }
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = style.align;
  const x = style.align === "left" ? pad : style.align === "right" ? c.width - pad : c.width / 2;
  lines.forEach((l, i) => {
    const y = pad + lineH * i + lineH / 2;
    if (style.stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.14;
      ctx.strokeStyle = style.stroke;
      ctx.strokeText(l, x, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(l, x, y);
  });
  return c;
}

export function drawSticker(emoji: string, k: number): HTMLCanvasElement {
  const size = 220 * k;
  const c = document.createElement("canvas");
  c.width = Math.ceil(size * 1.3);
  c.height = Math.ceil(size * 1.3);
  const ctx = c.getContext("2d")!;
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, c.width / 2, c.height / 2 + size * 0.05);
  return c;
}

export function drawClip(c: Clip, k: number, canvasW: number): HTMLCanvasElement | null {
  if (c.type === "text" && c.text) return drawText(c.text, k, canvasW * 0.88);
  if (c.type === "sticker" && c.sticker) return drawSticker(c.sticker, k);
  return null;
}

const cache = new Map<string, { url: string; w: number; h: number }>();

/** Data URL for the preview, cached per style. Sizes are in reference px (k = 1). */
export function previewImage(c: Clip, canvasW: number): { url: string; w: number; h: number } | null {
  const key = JSON.stringify([c.type, c.text, c.sticker, canvasW]);
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = drawClip(c, 1, canvasW);
  if (!cv) return null;
  const v = { url: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
  if (cache.size > 300) cache.clear();
  cache.set(key, v);
  return v;
}

export async function canvasToPng(cv: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Could not render text"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
