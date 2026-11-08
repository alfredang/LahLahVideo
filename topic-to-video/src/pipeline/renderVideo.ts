import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs/promises";
import { Plan } from "../types";

const COMPOSITION_ID = "TopicVideo";

export async function renderVideo(plan: Plan): Promise<string> {
  const outDir = path.resolve("out");
  await fs.mkdir(outDir, { recursive: true });
  const outputLocation = path.join(outDir, "video.mp4");

  console.log("[render] bundling...");
  const bundled = await bundle({
    entryPoint: path.resolve("src/index.ts"),
    webpackOverride: (c) => c,
  });

  console.log("[render] selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundled,
    id: COMPOSITION_ID,
    inputProps: { plan },
  });

  composition.durationInFrames = plan.totalFrames;
  composition.fps = plan.fps;
  composition.width = plan.width;
  composition.height = plan.height;

  console.log(
    `[render] rendering ${plan.totalFrames} frames @ ${plan.fps}fps (${plan.width}x${plan.height})...`
  );

  let lastLogged = -1;
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation,
    inputProps: { plan },
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct !== lastLogged && pct % 5 === 0) {
        console.log(`[render] ${pct}%`);
        lastLogged = pct;
      }
    },
  });

  console.log(`[render] done -> ${outputLocation}`);
  return outputLocation;
}
