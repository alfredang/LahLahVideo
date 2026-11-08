import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Plan, PlanScene } from "../types";
import { generateScript } from "./generateScript";
import { generateVoice } from "./generateVoice";
import { measureAudioFromVtt } from "./measureAudio";
import { renderVideo } from "./renderVideo";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const TAIL_PAD_SEC = 0.35;

async function main() {
  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) {
    console.error(
      'Usage: npm run make-video -- "your topic here"\n\nExample: npm run make-video -- "the history of pizza"'
    );
    process.exit(1);
  }

  console.log(`[script] topic: "${topic}"`);
  const script = await generateScript(topic);
  console.log(
    `[script] title: "${script.title}" with ${script.scenes.length} scenes`
  );
  for (const [i, s] of script.scenes.entries()) {
    console.log(`  ${i + 1}. ${s.caption}  —  "${s.narration}"`);
  }

  const voices = await generateVoice(script.scenes);

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
  console.log(
    `[plan] total duration: ${totalSec.toFixed(2)}s (${totalFrames} frames)`
  );

  const plan: Plan = {
    title: script.title,
    topic,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    totalFrames,
    scenes: planScenes,
  };

  const planPath = path.resolve("public", "plan.json");
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  console.log(`[plan] wrote ${planPath}`);

  const output = await renderVideo(plan);
  console.log(`\n✔ Done. Video: ${output}`);
}

main().catch((err) => {
  console.error("\n✘ Failed:", err.message ?? err);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
