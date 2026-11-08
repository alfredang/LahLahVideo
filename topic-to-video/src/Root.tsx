import React from "react";
import { Composition, staticFile } from "remotion";
import { TopicVideo } from "./Video";
import { Plan, PlanSchema } from "./types";

const FALLBACK_PLAN: Plan = {
  title: "Placeholder",
  topic: "Placeholder",
  fps: 30,
  width: 1080,
  height: 1920,
  totalFrames: 300,
  scenes: [
    {
      caption: "Run `npm run make-video -- \"your topic\"` first",
      narration: "",
      audioFile: "",
      durationSec: 10,
      durationFrames: 300,
    },
  ],
};

async function fetchPlan(): Promise<Plan> {
  try {
    const res = await fetch(staticFile("plan.json"));
    if (!res.ok) return FALLBACK_PLAN;
    const json = await res.json();
    return PlanSchema.parse(json);
  } catch {
    return FALLBACK_PLAN;
  }
}

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TopicVideo"
      component={TopicVideo}
      defaultProps={{ plan: FALLBACK_PLAN }}
      durationInFrames={FALLBACK_PLAN.totalFrames}
      fps={FALLBACK_PLAN.fps}
      width={FALLBACK_PLAN.width}
      height={FALLBACK_PLAN.height}
      calculateMetadata={async () => {
        const plan = await fetchPlan();
        return {
          durationInFrames: plan.totalFrames,
          fps: plan.fps,
          width: plan.width,
          height: plan.height,
          props: { plan },
        };
      }}
    />
  );
};
