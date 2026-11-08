import { z } from "zod";

export const SceneSchema = z.object({
  caption: z.string().min(1).max(80),
  narration: z.string().min(1),
});

export const ScriptSchema = z.object({
  title: z.string().min(1),
  scenes: z.array(SceneSchema).min(2).max(6),
});

export type Script = z.infer<typeof ScriptSchema>;
export type Scene = z.infer<typeof SceneSchema>;

export const PlanSceneSchema = SceneSchema.extend({
  audioFile: z.string(),
  durationSec: z.number().positive(),
  durationFrames: z.number().int().positive(),
});

export const PlanSchema = z.object({
  title: z.string(),
  topic: z.string(),
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  totalFrames: z.number().int().positive(),
  scenes: z.array(PlanSceneSchema).min(1),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanScene = z.infer<typeof PlanSceneSchema>;
