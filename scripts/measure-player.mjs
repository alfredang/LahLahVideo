#!/usr/bin/env node
// Player smoothness check in WebKit (the engine of the macOS app's web view).
// Needs the dev server (npm run dev) and: npm i -D playwright && npx playwright install webkit
// Usage: node scripts/measure-player.mjs "http://localhost:1420/?handoff=/path/served/handoff.json&coach=0"
// Prints seeks, play() rejections, animation frame rate and long frames during 16 s of playback,
// plus which clip is playing each second. Good: ~60 rAF fps, 0 long frames, a handful of seeks.
import { webkit } from "playwright";
const url = process.argv[2] ?? "http://localhost:1420/?handoff=/_screens/hf/handoff.json&coach=0";
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url);
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const w = (window.__m = { seeks: 0, rejects: [], frames: [], long: 0, running: true, samples: [] });
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { const p = op.call(this); p.catch((e) => w.rejects.push(this.src.split("/").pop() + " " + e.name)); return p; };
  document.addEventListener("seeking", () => w.seeks++, true);
  let last = performance.now();
  const loop = (now) => { const dt = now - last; last = now; if (dt > 34) w.long++; w.frames.push(dt); if (w.running) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  w.iv = setInterval(() => { const v = [...document.querySelectorAll(".main-wrap video")].filter((x) => x.dataset.active === "1").map((x) => `${x.src.split("/").pop()}:${x.paused ? "P" : "p"}${x.currentTime.toFixed(2)}${x.muted ? "m" : ""}`); w.samples.push(document.querySelector(".timecode b").textContent + " " + v.join(",")); }, 1000);
});
await page.click(".play-btn");
await page.waitForTimeout(16000);
const r = await page.evaluate(() => {
  const w = window.__m; w.running = false; clearInterval(w.iv);
  const s = w.frames.slice().sort((a, b) => a - b);
  return { seeks: w.seeks, rejects: [...new Set(w.rejects)], rafFps: +(w.frames.length / 16).toFixed(1), longFrames: w.long, p95ms: +s[Math.floor(s.length * 0.95)].toFixed(1), maxms: +s.at(-1).toFixed(1), samples: w.samples };
});
console.log(JSON.stringify({ ...r, samples: undefined }));
console.log(r.samples.join("\n"));
await browser.close();
