import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { Plan, PlanScene } from "./types";
import { generateScript } from "./pipeline/generateScript";
import { generateVoice } from "./pipeline/generateVoice";
import { measureAudioFromVtt } from "./pipeline/measureAudio";
import { renderVideo } from "./pipeline/renderVideo";

const PORT = Number(process.env.PORT ?? 3000);
const FPS = 30;
const TAIL_PAD_SEC = 0.35;

const FORMATS: Record<string, { width: number; height: number; label: string }> = {
  tiktok: { width: 1080, height: 1920, label: "TikTok (9:16)" },
  youtube: { width: 1920, height: 1080, label: "YouTube (16:9)" },
};

let busy = false;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Video Creator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #09090b;
      color: #e4e4e7;
      min-height: 100vh;
    }

    .page {
      display: flex;
      min-height: 100vh;
    }

    /* ── Left panel ── */
    .panel {
      width: 480px;
      flex-shrink: 0;
      border-right: 1px solid #1e1e22;
      padding: 48px 40px;
      display: flex;
      flex-direction: column;
      background: #0c0c0f;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 40px;
    }
    .logo-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #818cf8, #c084fc);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-icon svg { width: 20px; height: 20px; }
    .logo-text {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
    }

    h1 {
      font-size: 32px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 6px;
      letter-spacing: -0.02em;
    }
    .subtitle {
      color: #71717a;
      font-size: 15px;
      margin-bottom: 36px;
      line-height: 1.5;
    }

    form { display: flex; flex-direction: column; gap: 24px; flex: 1; }

    .field { display: flex; flex-direction: column; gap: 8px; }
    .field label {
      font-size: 13px;
      font-weight: 600;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    input[type="text"] {
      width: 100%;
      padding: 12px 16px;
      font-size: 16px;
      border: 1px solid #27272a;
      border-radius: 10px;
      background: #18181b;
      color: #fff;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input[type="text"]:focus {
      border-color: #818cf8;
      box-shadow: 0 0 0 3px rgba(129,140,248,0.15);
    }
    input[type="text"]::placeholder, textarea::placeholder { color: #52525b; }

    textarea {
      width: 100%;
      padding: 12px 16px;
      font-size: 15px;
      border: 1px solid #27272a;
      border-radius: 10px;
      background: #18181b;
      color: #fff;
      outline: none;
      resize: vertical;
      min-height: 90px;
      font-family: inherit;
      line-height: 1.5;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    textarea:focus {
      border-color: #818cf8;
      box-shadow: 0 0 0 3px rgba(129,140,248,0.15);
    }

    /* ── Format picker ── */
    .format-group {
      display: flex;
      gap: 12px;
    }
    .format-option {
      flex: 1;
      position: relative;
    }
    .format-option input { display: none; }
    .format-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 20px 16px;
      border: 2px solid #27272a;
      border-radius: 12px;
      background: #18181b;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
    }
    .format-card:hover {
      border-color: #3f3f46;
      background: #1e1e23;
    }
    .format-option input:checked + .format-card {
      border-color: #818cf8;
      background: rgba(129,140,248,0.08);
      box-shadow: 0 0 0 3px rgba(129,140,248,0.12);
    }
    .format-preview {
      border: 2px solid #52525b;
      border-radius: 4px;
      background: #27272a;
      transition: border-color 0.2s;
    }
    .format-option input:checked + .format-card .format-preview {
      border-color: #818cf8;
      background: rgba(129,140,248,0.15);
    }
    .format-label {
      font-size: 14px;
      font-weight: 600;
      color: #d4d4d8;
    }
    .format-dims {
      font-size: 12px;
      color: #71717a;
    }

    /* ── Button ── */
    .btn-row { margin-top: auto; }
    button[type="submit"] {
      width: 100%;
      padding: 14px 24px;
      font-size: 16px;
      font-weight: 600;
      border: none;
      border-radius: 10px;
      background: linear-gradient(135deg, #818cf8, #a78bfa);
      color: #fff;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
      letter-spacing: 0.01em;
    }
    button[type="submit"]:hover { opacity: 0.9; transform: translateY(-1px); }
    button[type="submit"]:active { transform: translateY(0); }
    button[type="submit"]:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
    }

    /* ── Right panel ── */
    .output {
      flex: 1;
      padding: 48px 40px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow: hidden;
    }
    .output-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .output-title {
      font-size: 14px;
      font-weight: 600;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    #status {
      display: none;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 500;
    }
    #status.visible { display: flex; }
    #status .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #818cf8;
      animation: pulse 1.5s ease-in-out infinite;
    }
    #status.done .dot { background: #4ade80; animation: none; }
    #status.error .dot { background: #f87171; animation: none; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    #log {
      flex: 1;
      padding: 20px;
      background: #111113;
      border: 1px solid #1e1e22;
      border-radius: 12px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 13px;
      line-height: 1.7;
      overflow-y: auto;
      white-space: pre-wrap;
      color: #a1a1aa;
    }
    #log:empty::before {
      content: 'Output will appear here...';
      color: #3f3f46;
    }
    #log .line-done { color: #4ade80; }
    #log .line-error { color: #f87171; }
    #log .line-step { color: #818cf8; font-weight: 600; }

    #video-result {
      display: none;
      padding: 20px;
      background: rgba(74,222,128,0.06);
      border: 1px solid rgba(74,222,128,0.2);
      border-radius: 12px;
    }
    #video-result.visible { display: flex; align-items: center; gap: 16px; }
    #video-result .icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: rgba(74,222,128,0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    #video-result .icon svg { width: 22px; height: 22px; color: #4ade80; }
    #video-result .info { flex: 1; }
    #video-result .info strong {
      display: block;
      font-size: 15px;
      color: #fff;
      margin-bottom: 2px;
    }
    #video-result .info span { font-size: 13px; color: #71717a; }
    #video-result a {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 8px;
      background: #4ade80;
      color: #09090b;
      text-decoration: none;
      transition: opacity 0.2s;
      white-space: nowrap;
    }
    #video-result a:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="page">
    <!-- Left panel -->
    <div class="panel">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>
        <span class="logo-text">Video Creator</span>
      </div>

      <h1>Create a video</h1>
      <p class="subtitle">Enter a topic and choose a format. We'll write the script, generate voiceover, and render your video.</p>

      <form id="form">
        <div class="field">
          <label for="topic">Topic</label>
          <input type="text" id="topic" name="topic" placeholder="e.g. the history of pizza" required autofocus />
        </div>

        <div class="field">
          <label for="description">Description <span style="text-transform:none;color:#52525b;font-weight:400;">(optional)</span></label>
          <textarea id="description" name="description" placeholder="Add details, angle, audience, key points to cover..."></textarea>
        </div>

        <div class="field">
          <label>Format</label>
          <div class="format-group">
            <label class="format-option">
              <input type="radio" name="format" value="tiktok" checked />
              <div class="format-card">
                <div class="format-preview" style="width:36px;height:64px;"></div>
                <span class="format-label">TikTok</span>
                <span class="format-dims">1080 x 1920</span>
              </div>
            </label>
            <label class="format-option">
              <input type="radio" name="format" value="youtube" />
              <div class="format-card">
                <div class="format-preview" style="width:72px;height:40px;"></div>
                <span class="format-label">YouTube</span>
                <span class="format-dims">1920 x 1080</span>
              </div>
            </label>
          </div>
        </div>

        <div class="btn-row">
          <button type="submit" id="btn">Generate Video</button>
        </div>
      </form>
    </div>

    <!-- Right panel -->
    <div class="output">
      <div class="output-header">
        <span class="output-title">Output</span>
        <div id="status">
          <span class="dot"></span>
          <span id="status-text">Generating...</span>
        </div>
      </div>
      <div id="log"></div>
      <div id="video-result">
        <div class="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <div class="info">
          <strong>Video ready</strong>
          <span id="result-meta"></span>
        </div>
        <a href="/video" target="_blank">Download</a>
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('form');
    const btn = document.getElementById('btn');
    const log = document.getElementById('log');
    const status = document.getElementById('status');
    const statusText = document.getElementById('status-text');
    const videoResult = document.getElementById('video-result');
    const resultMeta = document.getElementById('result-meta');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const topic = document.getElementById('topic').value.trim();
      const description = document.getElementById('description').value.trim();
      const format = document.querySelector('input[name="format"]:checked').value;
      if (!topic) return;

      btn.disabled = true;
      btn.textContent = 'Generating...';
      log.textContent = '';
      status.className = 'visible';
      statusText.textContent = 'Generating...';
      videoResult.classList.remove('visible');

      const params = new URLSearchParams({ topic, format });
      if (description) params.set('description', description);
      const evtSource = new EventSource('/generate?' + params.toString());

      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          const span = document.createElement('span');
          const msg = data.message;
          if (msg.startsWith('[')) span.className = 'line-step';
          span.textContent = msg + '\\n';
          log.appendChild(span);
          log.scrollTop = log.scrollHeight;
        } else if (data.type === 'done') {
          const span = document.createElement('span');
          span.className = 'line-done';
          span.textContent = '\\n' + data.message + '\\n';
          log.appendChild(span);
          btn.disabled = false;
          btn.textContent = 'Generate Video';
          status.className = 'visible done';
          statusText.textContent = 'Complete';
          videoResult.classList.add('visible');
          resultMeta.textContent = format === 'youtube' ? '1920x1080 MP4' : '1080x1920 MP4';
          evtSource.close();
        } else if (data.type === 'error') {
          const span = document.createElement('span');
          span.className = 'line-error';
          span.textContent = '\\n' + data.message + '\\n';
          log.appendChild(span);
          btn.disabled = false;
          btn.textContent = 'Generate Video';
          status.className = 'visible error';
          statusText.textContent = 'Failed';
          evtSource.close();
        }
      };
      evtSource.onerror = () => {
        const span = document.createElement('span');
        span.className = 'line-error';
        span.textContent = 'Connection lost.\\n';
        log.appendChild(span);
        btn.disabled = false;
        btn.textContent = 'Generate Video';
        status.className = 'visible error';
        statusText.textContent = 'Disconnected';
        evtSource.close();
      };
    });
  </script>
  <footer style="text-align:center;padding:18px 0 10px;color:#888;font-size:0.85rem;letter-spacing:0.02em;">
    Powered by <a href="https://www.tertiarycourses.com.sg/" target="_blank" rel="noopener noreferrer" style="color:#a78bfa;text-decoration:none;">Tertiary Infotech Academy Pte Ltd</a>
  </footer>
</body>
</html>`;

function send(res: http.ServerResponse, type: string, message: string) {
  res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
}

function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "video";
}

async function buildVideoFilename(): Promise<string> {
  try {
    const planRaw = await fs.readFile(path.resolve("public", "plan.json"), "utf8");
    const plan = JSON.parse(planRaw);
    const source =
      (typeof plan?.topic === "string" && plan.topic.trim()) ||
      (typeof plan?.title === "string" && plan.title.trim());
    if (source) {
      return `${sanitizeFilename(source)}.mp4`;
    }
  } catch {
    // fall through
  }
  return "video.mp4";
}

async function handleGenerate(
  topic: string,
  format: string,
  res: http.ServerResponse,
  description?: string,
) {
  if (busy) {
    send(res, "error", "A video is already being generated. Please wait.");
    res.end();
    return;
  }

  const { width, height, label } = FORMATS[format] ?? FORMATS.tiktok;

  busy = true;
  try {
    send(res, "log", `[format] ${label} (${width}x${height})`);
    send(res, "log", `[script] Generating script for: "${topic}"`);
    if (description) {
      send(res, "log", `[script] Using description (${description.length} chars)`);
    }
    const script = await generateScript(topic, description);
    send(
      res,
      "log",
      `[script] Title: "${script.title}" (${script.scenes.length} scenes)`,
    );
    for (const [i, s] of script.scenes.entries()) {
      send(res, "log", `  ${i + 1}. ${s.caption} — "${s.narration}"`);
    }

    send(res, "log", `\n[tts] Generating voiceover...`);
    const voices = await generateVoice(script.scenes);
    send(res, "log", `[tts] Done — ${voices.length} audio files generated`);

    send(res, "log", `\n[plan] Measuring audio and building plan...`);
    const planScenes: PlanScene[] = [];
    let totalFrames = 0;
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      const voice = voices[i];
      const audioSec = await measureAudioFromVtt(voice.subtitlesPath);
      const paddedSec = audioSec + TAIL_PAD_SEC;
      const frames = Math.ceil(paddedSec * FPS);
      totalFrames += frames;
      planScenes.push({
        caption: scene.caption,
        narration: scene.narration,
        audioFile: voice.audioFile,
        durationSec: paddedSec,
        durationFrames: frames,
      });
    }

    const totalSec = totalFrames / FPS;
    send(
      res,
      "log",
      `[plan] Total duration: ${totalSec.toFixed(2)}s (${totalFrames} frames)`,
    );

    const plan: Plan = {
      title: script.title,
      topic,
      fps: FPS,
      width,
      height,
      totalFrames,
      scenes: planScenes,
    };

    const planPath = path.resolve("public", "plan.json");
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
    send(res, "log", `[plan] Wrote ${planPath}`);

    send(res, "log", `\n[render] Rendering video (${width}x${height})...`);
    const output = await renderVideo(plan);

    send(res, "done", `Done! Video saved to: ${output}`);
  } catch (err: any) {
    send(res, "error", `Failed: ${err.message ?? err}`);
  } finally {
    busy = false;
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
    return;
  }

  if (url.pathname === "/generate" && req.method === "GET") {
    const topic = url.searchParams.get("topic")?.trim();
    const format = url.searchParams.get("format") ?? "tiktok";
    const description = url.searchParams.get("description")?.trim() || undefined;
    if (!topic) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing topic parameter");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    await handleGenerate(topic, format, res, description);
    return;
  }

  if (url.pathname === "/video" && req.method === "GET") {
    const videoPath = path.resolve("out", "video.mp4");
    try {
      const data = await fs.readFile(videoPath);
      const filename = await buildVideoFilename();
      const asciiName = filename.replace(/[^\x20-\x7e]/g, "_");
      const encodedName = encodeURIComponent(filename);
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Content-Length": data.length,
      });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("No video found. Generate one first.");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\nVideo Creator ready at http://localhost:${PORT}\n`);
});
