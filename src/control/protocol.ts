// The local API contract, shared by the editor (handler.ts), the MCP server (mcp/) and the
// OpenAPI document (docs/openapi.json). A test checks all three agree.

export const API_ROUTES = {
  status: { method: "GET", path: "/v1/status" },
  open_handoff: { method: "POST", path: "/v1/handoff" },
  add_clips: { method: "POST", path: "/v1/clips" },
  run_command: { method: "POST", path: "/v1/commands" },
  get_timeline: { method: "GET", path: "/v1/timeline" },
  set_captions: { method: "PUT", path: "/v1/captions" },
  export: { method: "POST", path: "/v1/exports" },
  export_status: { method: "GET", path: "/v1/exports/{id}" },
  list_projects: { method: "GET", path: "/v1/projects" },
  save_project: { method: "POST", path: "/v1/projects/save" },
  snapshot: { method: "GET", path: "/v1/snapshot" },
} as const;

export type ApiOperation = keyof typeof API_ROUTES;

export const EXPORT_PRESET_IDS = ["tiktok", "youtube_shorts", "youtube"] as const;
export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export interface ControlFile {
  app: string;
  version: string;
  port: number;
  baseUrl: string;
  apiKey: string;
  token?: string;
  pid?: number;
}

export interface ExportJob {
  id: string;
  state: "running" | "done" | "failed" | "cancelled";
  progress: number;
  output: string;
  preset: ExportPresetId;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** Match an incoming request to an operation. Returns the operation and path params. */
export function matchRoute(method: string, path: string): { op: ApiOperation; params: Record<string, string> } | null {
  for (const [op, r] of Object.entries(API_ROUTES) as [ApiOperation, { method: string; path: string }][]) {
    if (r.method !== method.toUpperCase()) continue;
    const want = r.path.split("/");
    const got = path.replace(/\/+$/, "").split("/");
    if (want.length !== got.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    want.forEach((w, i) => {
      if (w.startsWith("{")) params[w.slice(1, -1)] = decodeURIComponent(got[i]);
      else if (w !== got[i]) ok = false;
    });
    if (ok) return { op, params };
  }
  return null;
}
