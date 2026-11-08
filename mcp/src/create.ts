// Builds the LahLah Video MCP server (tools in tools.ts).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LahLahClient } from "./client";
import { TOOLS } from "./tools";

export const VERSION = "1.1.1";

export function createServer(client = new LahLahClient()) {
  const server = new McpServer(
    { name: "lahlah-video", version: VERSION },
    {
      instructions:
        "LahLah Video is a desktop video editor. Typical flow: status → open_handoff (the lahlah-edit.json from the higgsfield-video skill) or add_clips (Higgsfield URLs) → run_command for edits (\"add crossfade\", \"split at 3 seconds\") → snapshot to check a frame → export → export_status until done. Every edit is undoable with run_command(\"undo\").",
    },
  );
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: !!t.readOnly, openWorldHint: t.name === "add_clips" } },
      async (args: any) => {
        try {
          return (await t.run(client, args ?? {})) as any;
        } catch (e) {
          return { content: [{ type: "text", text: `LahLah Video: ${(e as Error).message}` }], isError: true };
        }
      },
    );
  }
  return server;
}

