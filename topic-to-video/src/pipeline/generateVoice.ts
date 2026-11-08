import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Scene } from "../types";

const DEFAULT_VOICE = "en-US-AriaNeural";
const PUBLIC_DIR = path.resolve("public");

export type VoiceResult = {
  sceneIndex: number;
  audioFile: string;
  absPath: string;
  subtitlesPath: string;
};

function runEdgeTts(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = process.env.EDGE_TTS_CMD ?? "edge-tts";
    const child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "edge-tts not found. Install with: pip install edge-tts"
          )
        );
      } else {
        reject(err);
      }
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts exited with code ${code}`));
    });
  });
}

function quote(s: string): string {
  // cross-shell safe double-quoting
  return `"${s.replace(/"/g, '\\"')}"`;
}

export async function generateVoice(scenes: Scene[]): Promise<VoiceResult[]> {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const voice = process.env.EDGE_TTS_VOICE ?? DEFAULT_VOICE;

  const results: VoiceResult[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const fileName = `scene_${i}.mp3`;
    const absPath = path.join(PUBLIC_DIR, fileName);
    const subtitlesPath = path.join(PUBLIC_DIR, `scene_${i}.vtt`);

    for (const p of [absPath, subtitlesPath]) {
      try {
        await fs.unlink(p);
      } catch {
        // ignore missing
      }
    }

    console.log(`[tts] scene ${i + 1}/${scenes.length}: "${scene.caption}"`);
    await runEdgeTts([
      "--voice",
      quote(voice),
      "--text",
      quote(scene.narration),
      "--write-media",
      quote(absPath),
      "--write-subtitles",
      quote(subtitlesPath),
    ]);

    const stat = await fs.stat(absPath);
    if (stat.size === 0) {
      throw new Error(`edge-tts produced empty file: ${absPath}`);
    }

    results.push({ sceneIndex: i, audioFile: fileName, absPath, subtitlesPath });
  }
  return results;
}
