// End-to-end: drive a running LahLah Video through the bundled MCP server over stdio.
// Usage: node test/e2e.mjs <handoff.json> <out.mp4>   (LAHLAH_VIDEO_CONTROL_FILE may point at a dev build)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";

const [handoff, out] = process.argv.slice(2);
const client = new Client({ name: "e2e", version: "1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../dist/server.js", import.meta.url).pathname], env: { ...process.env } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.find((c) => c.type === "text")?.text ?? "";
  console.log(`\n# ${name} ${JSON.stringify(args).slice(0, 80)}${r.isError ? "  [ERROR]" : ""}\n${text.slice(0, 500)}`);
  if (r.isError) throw new Error(text);
  return r;
};
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
await call("status");
await call("open_handoff", { path: handoff });
await call("run_command", { text: "go to 6 seconds" });
await call("run_command", { text: "split here" });
await call("run_command", { text: "add crossfade" });
await call("run_command", { text: "undo" });
await call("run_command", { text: "add text 'Save first' at 1 second" });
await call("set_captions", { captions: [{ start: 0, end: 2, text: "Captions from Claude" }] });
const tl = JSON.parse((await call("get_timeline")).content[0].text);
console.log("main clips:", tl.tracks.find((t) => t.type === "main").clips.length, "captions:", tl.captions.length);
const snap = await call("snapshot", { t: 1.2, width: 360 });
const img = snap.content.find((c) => c.type === "image");
writeFileSync(out.replace(/\.mp4$/, "-snapshot.png"), Buffer.from(img.data, "base64"));
const job = JSON.parse((await call("export", { preset: "tiktok", resolution: "720p", path: out })).content[0].text).job;
for (let i = 0; i < 120; i++) {
  const s = JSON.parse((await client.callTool({ name: "export_status", arguments: { job_id: job.id } })).content[0].text).job;
  if (s.state !== "running") {
    console.log("\nexport:", s.state, s.output, s.error ?? "");
    if (s.state !== "done") process.exit(1);
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await call("save_project", { path: out.replace(/\.mp4$/, ".lahlah") });
await call("list_projects");
await client.close();
