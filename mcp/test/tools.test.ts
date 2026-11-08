import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttp, IncomingMessage, Server, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/create";
import { controlFilePath, LahLahClient } from "../src/client";
import { TOOLS } from "../src/tools";
import { API_ROUTES, matchRoute } from "../../src/control/protocol";

const KEY = "llv_test_key_0123456789abcdef";
const calls: { method: string; path: string; query: string; body: any; auth?: string }[] = [];

/** A stand-in for LahLah Video's local API. */
function mockApp(req: IncomingMessage, res: ServerResponse) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const [path, query = ""] = (req.url ?? "").split("?");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: "Missing or wrong API key" });
    if (path === "/v1/health") return send(200, { ok: true, version: "1.1.0" });
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method!, path, query, body, auth: req.headers.authorization });
    const timeline = { name: "Kopi", aspect: "9:16", duration: 13.5, tracks: [{ type: "main", clips: [{ label: "S01-SH01", start: 0, end: 5, transitionIn: null }] }], captions: [] };
    const m = matchRoute(req.method!, path);
    if (!m) return send(404, { error: "no route" });
    switch (m.op) {
      case "status":
        return send(200, { app: "LahLah Video", version: "1.1.0", running: true, project: { name: "Kopi" } });
      case "run_command":
        return body.text === "make me a sandwich"
          ? send(200, { ok: false, error: "I didn't catch that.", suggestions: ["split here"] })
          : send(200, { ok: true, message: "Split at 3s", command: { kind: "split", at: 3 }, timeline });
      case "export":
        return send(200, { job: { id: "exp_1", state: "running", progress: 0, output: "/tmp/out.mp4", preset: body.preset } });
      case "export_status":
        return m.params.id === "exp_1" ? send(200, { job: { id: "exp_1", state: "done", progress: 1, output: "/tmp/out.mp4" } }) : send(404, { error: "No export job" });
      case "snapshot":
        return send(200, { mimeType: "image/png", base64: "iVBORw0KGgo=", time: 2, width: 540, height: 960 });
      case "open_handoff":
      case "add_clips":
        return send(200, { opened: true, added: [], timeline });
      default:
        return send(200, { ok: true, op: m.op });
    }
  });
}

let http: Server;
let base = "";
let mcp: Client;

beforeAll(async () => {
  http = createHttp(mockApp);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as any).port;
  base = `http://127.0.0.1:${port}`;
  const client = new LahLahClient({ readControl: () => ({ app: "LahLah Video", version: "1.1.0", port, baseUrl: base, apiKey: KEY }), launch: async () => undefined, waitMs: 1000, env: {} });
  const server = createServer(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  mcp = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
});

afterAll(() => http?.close());

const text = (r: any) => r.content.find((c: any) => c.type === "text")?.text ?? "";

describe("LahLah Video MCP server", () => {
  it("lists every tool with a description and input schema", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["add_clips", "export", "export_status", "get_timeline", "list_projects", "open_handoff", "run_command", "save_project", "set_captions", "snapshot", "status"].sort(),
    );
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("runs commands through the API with the key", async () => {
    const r: any = await mcp.callTool({ name: "run_command", arguments: { text: "split at 3 seconds" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Split at 3s");
    const last = calls.at(-1)!;
    expect(last).toMatchObject({ method: "POST", path: "/v1/commands", body: { text: "split at 3 seconds" }, auth: `Bearer ${KEY}` });
  });

  it("reports commands the parser did not understand as errors", async () => {
    const r: any = await mcp.callTool({ name: "run_command", arguments: { text: "make me a sandwich" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("split here");
  });

  it("exports and polls a job", async () => {
    const r: any = await mcp.callTool({ name: "export", arguments: { preset: "tiktok", resolution: "720p" } });
    expect(JSON.parse(text(r)).job.id).toBe("exp_1");
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/exports", body: { preset: "tiktok", resolution: "720p" } });
    const s: any = await mcp.callTool({ name: "export_status", arguments: { job_id: "exp_1" } });
    expect(JSON.parse(text(s)).job.state).toBe("done");
    expect(calls.at(-1)).toMatchObject({ method: "GET", path: "/v1/exports/exp_1" });
    const missing: any = await mcp.callTool({ name: "export_status", arguments: { job_id: "nope" } });
    expect(missing.isError).toBe(true);
  });

  it("rejects presets outside the list", async () => {
    const r: any = await mcp.callTool({ name: "export", arguments: { preset: "vimeo" } });
    expect(r.isError).toBe(true);
  });

  it("returns snapshots as images", async () => {
    const r: any = await mcp.callTool({ name: "snapshot", arguments: { t: 2 } });
    expect(r.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(calls.at(-1)).toMatchObject({ method: "GET", path: "/v1/snapshot", query: "t=2" });
  });

  it("opens inline hand-offs and adds clips", async () => {
    const h = { schema: "lahlah-edit/1", clips: [{ src: "https://example.com/a.mp4" }] };
    await mcp.callTool({ name: "open_handoff", arguments: { json: h } });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/handoff", body: { json: h } });
    await mcp.callTool({ name: "add_clips", arguments: { sources: ["https://example.com/b.mp4"], track: "overlay", at: 2 } });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/clips", body: { sources: ["https://example.com/b.mp4"], track: "overlay", at: 2 } });
  });

  it("covers the remaining routes", async () => {
    for (const [name, args, path, method] of [
      ["status", {}, "/v1/status", "GET"],
      ["get_timeline", {}, "/v1/timeline", "GET"],
      ["set_captions", { captions: [{ start: 0, end: 1, text: "Hi" }] }, "/v1/captions", "PUT"],
      ["list_projects", {}, "/v1/projects", "GET"],
      ["save_project", { path: "/tmp/a.lahlah" }, "/v1/projects/save", "POST"],
    ] as const) {
      const r: any = await mcp.callTool({ name, arguments: args });
      expect(r.isError, name).toBeFalsy();
      expect(calls.at(-1)).toMatchObject({ path, method });
    }
  });

  it("explains a wrong key instead of failing silently", async () => {
    const bad = new LahLahClient({ readControl: () => ({ app: "x", version: "1", port: 1, baseUrl: base, apiKey: "wrong" }), launch: async () => undefined, waitMs: 600, env: {} });
    await expect(bad.call("status")).rejects.toThrow(/not running/);
  });

  it("lets scripts override the key and URL with environment variables", async () => {
    const c = new LahLahClient({ readControl: () => null, launch: async () => undefined, waitMs: 600, env: { LAHLAH_VIDEO_API_KEY: KEY, LAHLAH_VIDEO_URL: base } });
    expect((await c.call("status")).running).toBe(true);
  });
});

describe("contract", () => {
  const openapi = JSON.parse(readFileSync(new URL("../../docs/openapi.json", import.meta.url), "utf8"));

  it("every tool maps to a documented route with the same method", () => {
    for (const t of TOOLS) {
      const r = API_ROUTES[t.op];
      const doc = openapi.paths[r.path]?.[r.method.toLowerCase()];
      expect(doc, `${t.name} -> ${r.method} ${r.path}`).toBeTruthy();
      expect(doc.operationId).toBe(t.op);
    }
  });

  it("every documented /v1 route except health is reachable from a tool", () => {
    const ops = new Set(TOOLS.map((t) => t.op));
    for (const [path, methods] of Object.entries<any>(openapi.paths)) {
      if (path === "/v1/health") continue;
      for (const m of Object.keys(methods)) expect(ops.has(methods[m].operationId), `${m} ${path}`).toBe(true);
    }
  });

  it("finds control.json where the app writes it", () => {
    expect(controlFilePath("darwin", {}, "/Users/ah")).toBe("/Users/ah/Library/Application Support/com.tertiaryinfotech.lahlahvideo/control.json");
    expect(controlFilePath("win32", { APPDATA: "C:\\Users\\ah\\AppData\\Roaming" }, "C:\\Users\\ah")).toContain("com.tertiaryinfotech.lahlahvideo");
    expect(controlFilePath("darwin", { LAHLAH_VIDEO_CONTROL_FILE: "/x/control.json" }, "/h")).toBe("/x/control.json");
  });
});
