import fs from "node:fs/promises";
import path from "node:path";
import { Plan, PlanScene, Scene } from "../types";
import { generateVoice } from "./generateVoice";
import { measureAudioFromVtt } from "./measureAudio";
import { renderVideo } from "./renderVideo";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const TAIL_PAD_SEC = 0.35;

const scenes: Scene[] = [
  {
    caption: "Pizza began in Naples",
    narration:
      "Pizza was born in Naples, Italy, in the late seventeen hundreds as cheap street food for working people.",
  },
  {
    caption: "Margherita, 1889",
    narration:
      "In eighteen eighty nine, a pizzamaker honored Queen Margherita with tomato, mozzarella, and basil, the red, white, and green of the Italian flag.",
  },
  {
    caption: "A worldwide icon",
    narration:
      "Today, billions of pizzas are served every year, making it one of the most beloved foods on the planet.",
  },
];

async function main() {
  const voices = await generateVoice(scenes);

  const planScenes: PlanScene[] = [];
  let totalFrames = 0;
  for (let i = 0; i < scenes.length; i++) {
    const audioSec = await measureAudioFromVtt(voices[i].subtitlesPath);
    const paddedSec = audioSec + TAIL_PAD_SEC;
    const frames = Math.ceil(paddedSec * FPS);
    totalFrames += frames;
    planScenes.push({
      caption: scenes[i].caption,
      narration: scenes[i].narration,
      audioFile: voices[i].audioFile,
      durationSec: paddedSec,
      durationFrames: frames,
    });
  }

  const plan: Plan = {
    title: "The Story of Pizza",
    topic: "the history of pizza",
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    totalFrames,
    scenes: planScenes,
  };

  await fs.writeFile(
    path.resolve("public", "plan.json"),
    JSON.stringify(plan, null, 2),
    "utf8"
  );

  console.log(`[smoke] total duration: ${(totalFrames / FPS).toFixed(2)}s`);
  const output = await renderVideo(plan);
  console.log(`\n✔ Smoke test passed: ${output}`);
}

main().catch((err) => {
  console.error("\n✘ Smoke test failed:", err);
  process.exit(1);
});
