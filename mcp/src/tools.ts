// The MCP tools. Each one maps to one call on LahLah Video's local API (src/control/protocol.ts).
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { LahLahClient } from "./client";
import { ApiOperation, EXPORT_PRESET_IDS } from "../../src/control/protocol";

export type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

export interface ToolDef {
  name: string;
  op: ApiOperation;
  title: string;
  description: string;
  input: z.ZodRawShape;
  readOnly?: boolean;
  run: (client: LahLahClient, args: any) => Promise<ToolResult>;
}

const json = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });

export const TOOLS: ToolDef[] = [
  {
    name: "status",
    op: "status",
    title: "LahLah Video status",
    description: "Check that LahLah Video is running (it is started if needed) and see its version, the open project, duration, canvas ratio and recent export jobs. Call this first.",
    input: {},
    readOnly: true,
    run: async (c) => json(await c.call("status")),
  },
  {
    name: "open_handoff",
    op: "open_handoff",
    title: "Open a hand-off",
    description:
      'Load a lahlah-edit/1 hand-off (the file the higgsfield-video skill writes) so every Higgsfield shot lands on the timeline in order with transitions, captions and music. Pass "path" (absolute path to lahlah-edit.json or a .lahlah project) OR "json" (the hand-off object or JSON text). Relative clip paths in inline JSON need "baseDir". Replaces the open project.',
    input: {
      path: z.string().optional().describe("Absolute path to lahlah-edit.json or a .lahlah project"),
      json: z.union([z.string(), z.record(z.any())]).optional().describe('The hand-off itself (schema "lahlah-edit/1")'),
      baseDir: z.string().optional().describe("Folder that relative src paths in inline json are relative to"),
    },
    run: async (c, a) => {
      if (!a.path && a.json === undefined) throw new Error("Give path or json");
      if (a.path && !existsSync(a.path)) throw new Error(`No file at ${a.path}`);
      const r = await c.call("open_handoff", { body: { path: a.path, json: a.json, baseDir: a.baseDir } });
      return json({ opened: true, summary: summarise(r.timeline) });
    },
  },
  {
    name: "add_clips",
    op: "add_clips",
    title: "Add clips",
    description:
      "Download Higgsfield result URLs (https://…mp4) or import local files (absolute paths) into the media bin and onto the timeline, in order. track: main (default for video/images, clips sit end to end), overlay (picture-in-picture), music or voice (audio), or none (bin only). at: start time in seconds for non-main tracks.",
    input: {
      sources: z.array(z.string()).min(1).describe("https:// URLs or absolute file paths, in order"),
      track: z.enum(["main", "overlay", "music", "voice", "audio", "none"]).optional(),
      at: z.number().min(0).optional().describe("Start time in seconds (non-main tracks)"),
    },
    run: async (c, a) => {
      const r = await c.call("add_clips", { body: { sources: a.sources, track: a.track, at: a.at } });
      return json({ added: r.added, summary: summarise(r.timeline) });
    },
  },
  {
    name: "run_command",
    op: "run_command",
    title: "Run an editing command",
    description:
      'Run one plain-English edit with the same parser as the command bar, e.g. "split at 3 seconds", "add crossfade", "trim start to 1.5 seconds", "speed up 2x", "add text \'Save first\' at 2 seconds", "make it vertical", "add filter kopi warm", "undo". Edits act on the selected clip, or the main-track clip under the playhead. Every edit can be undone with "undo". Use the export tool rather than "export for TikTok" to get a job id.',
    input: { text: z.string().min(1).describe("The command, in plain English") },
    run: async (c, a) => {
      const r = await c.call("run_command", { body: { text: a.text } });
      if (!r.ok) return { content: [{ type: "text", text: `Not understood: ${r.error} Try: ${(r.suggestions ?? []).join(" · ")}` }], isError: true };
      return json({ ok: true, message: r.message, command: r.command, summary: summarise(r.timeline) });
    },
  },
  {
    name: "get_timeline",
    op: "get_timeline",
    title: "Read the timeline",
    description: "Return the whole edit as JSON: tracks with clips (start, end, duration, speed, transitions, text), captions, media and the playhead.",
    input: {},
    readOnly: true,
    run: async (c) => json(await c.call("get_timeline")),
  },
  {
    name: "set_captions",
    op: "set_captions",
    title: "Set captions",
    description: "Replace the Captions track. Give srt (SRT text) or captions (a list of {start, end, text} in seconds).",
    input: {
      srt: z.string().optional().describe("SRT subtitle text"),
      captions: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).optional(),
    },
    run: async (c, a) => {
      let srt = a.srt;
      if (srt && !srt.includes("-->") && existsSync(srt)) srt = readFileSync(srt, "utf8");
      return json(await c.call("set_captions", { body: { srt, captions: a.captions } }));
    },
  },
  {
    name: "export",
    op: "export",
    title: "Export an MP4",
    description:
      "Start exporting the edit as an MP4 (H.264 + AAC). preset: tiktok or youtube_shorts (9:16) or youtube (16:9); the canvas switches to match. Returns a job id at once; call export_status until state is done, then report the output path.",
    input: {
      preset: z.enum(EXPORT_PRESET_IDS),
      resolution: z.enum(["720p", "1080p", "4k"]).optional().describe("Default 1080p"),
      fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(),
      path: z.string().optional().describe("Output .mp4 path. Default: Movies/LahLah Video (Mac) or Videos\\LahLah Video (Windows)"),
    },
    run: async (c, a) => json(await c.call("export", { body: a })),
  },
  {
    name: "export_status",
    op: "export_status",
    title: "Export progress",
    description: "Progress (0 to 1), state (running, done, failed) and output path of an export job from the export tool.",
    input: { job_id: z.string().describe("The id the export tool returned") },
    readOnly: true,
    run: async (c, a) => json(await c.call("export_status", { params: { id: a.job_id } })),
  },
  {
    name: "list_projects",
    op: "list_projects",
    title: "List projects",
    description: "The open project (name, file, unsaved changes) and recently opened .lahlah projects.",
    input: {},
    readOnly: true,
    run: async (c) => json(await c.call("list_projects")),
  },
  {
    name: "save_project",
    op: "save_project",
    title: "Save the project",
    description: "Save the open project as a .lahlah file: to path if given, else its own file, else Documents/LahLah Video/<name>.lahlah.",
    input: { path: z.string().optional() },
    run: async (c, a) => json(await c.call("save_project", { body: { path: a.path } })),
  },
  {
    name: "snapshot",
    op: "snapshot",
    title: "Snapshot a frame",
    description: "Render one frame of the edit (exactly as the export would) and return it as an image, so you can check framing, text and captions. t: seconds (default: the playhead).",
    input: { t: z.number().min(0).optional(), width: z.number().int().min(120).max(1920).optional().describe("Default 540") },
    readOnly: true,
    run: async (c, a) => {
      const r = await c.call("snapshot", { query: { t: a.t, width: a.width } });
      return { content: [{ type: "image", data: r.base64, mimeType: r.mimeType ?? "image/png" }, { type: "text", text: `Frame at ${Number(r.time).toFixed(2)}s, ${r.width}×${r.height}` }] };
    },
  },
];

/** A short human summary of a timeline (keeps tool answers small). */
export function summarise(t: any) {
  if (!t) return undefined;
  const main = t.tracks?.find((x: any) => x.type === "main");
  return {
    name: t.name,
    aspect: t.aspect,
    duration: t.duration,
    mainClips: main?.clips?.map((c: any) => `${c.label} ${c.start}-${c.end}s${c.transitionIn ? ` (${c.transitionIn.type} in)` : ""}`) ?? [],
    otherClips: t.tracks?.filter((x: any) => x.type !== "main").reduce((n: number, x: any) => n + x.clips.length, 0) ?? 0,
    captions: t.captions?.length ?? 0,
  };
}
