// Finds the running LahLah Video (control.json), starts it if needed, and calls its local API.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { API_ROUTES, ApiOperation, ControlFile } from "../../src/control/protocol";

export const BUNDLE_ID = "com.tertiaryinfotech.lahlahvideo";

export function controlFilePath(platform = process.platform, env = process.env, home = homedir()): string {
  if (env.LAHLAH_VIDEO_CONTROL_FILE) return env.LAHLAH_VIDEO_CONTROL_FILE;
  if (platform === "darwin") return join(home, "Library", "Application Support", BUNDLE_ID, "control.json");
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), BUNDLE_ID, "control.json");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), BUNDLE_ID, "control.json");
}

export class ApiCallError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Connection {
  baseUrl: string;
  apiKey: string;
  version?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class LahLahClient {
  private conn: Connection | null = null;

  constructor(
    private opts: {
      fetch?: FetchLike;
      readControl?: () => ControlFile | null;
      launch?: () => Promise<void>;
      waitMs?: number;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {}

  private get fetch(): FetchLike {
    return this.opts.fetch ?? ((u, i) => fetch(u, i));
  }

  readControl(): ControlFile | null {
    if (this.opts.readControl) return this.opts.readControl();
    const path = controlFilePath(process.platform, this.opts.env ?? process.env);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as ControlFile;
    } catch {
      return null;
    }
  }

  /** Connection details: env vars win (for scripts), then control.json. */
  private current(): Connection | null {
    const env = this.opts.env ?? process.env;
    const file = this.readControl();
    const apiKey = env.LAHLAH_VIDEO_API_KEY || file?.apiKey || file?.token;
    const baseUrl = env.LAHLAH_VIDEO_URL || file?.baseUrl || (file?.port ? `http://127.0.0.1:${file.port}` : undefined);
    if (!apiKey || !baseUrl) return null;
    return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), version: file?.version };
  }

  private async healthy(c: Connection): Promise<boolean> {
    try {
      const r = await this.fetch(`${c.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Connect to the running app, starting it if it isn't running. */
  async connect(): Promise<Connection> {
    if (this.conn && (await this.healthy(this.conn))) return this.conn;
    let c = this.current();
    if (c && (await this.healthy(c))) return (this.conn = c);
    await (this.opts.launch ?? launchApp)();
    const until = Date.now() + (this.opts.waitMs ?? 30_000);
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 500));
      c = this.current();
      if (c && (await this.healthy(c))) {
        // The window needs a moment after the server starts to register its listener.
        await new Promise((r) => setTimeout(r, 800));
        return (this.conn = c);
      }
    }
    throw new ApiCallError(
      503,
      "LahLah Video is not running and did not start. Install it (https://github.com/alfredang/LahLahVideo#1-minute-install), open it once, and check Settings › API › Allow API control is on.",
    );
  }

  /** Call one API operation. */
  async call(op: ApiOperation, opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string | number | undefined> } = {}): Promise<any> {
    const c = await this.connect();
    const route = API_ROUTES[op];
    let path: string = route.path;
    for (const [k, v] of Object.entries(opts.params ?? {})) path = path.replace(`{${k}}`, encodeURIComponent(v));
    const qs = Object.entries(opts.query ?? {})
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const res = await this.fetch(`${c.baseUrl}${path}${qs ? `?${qs}` : ""}`, {
      method: route.method,
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      body: route.method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new ApiCallError(res.status, json?.error ?? `LahLah Video answered ${res.status}`);
    return json;
  }
}

/** Start the desktop app the way a learner would. */
export async function launchApp(): Promise<void> {
  const run = (cmd: string, args: string[]) =>
    new Promise<void>((resolve) => {
      try {
        const p = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
        p.on("error", () => resolve());
        p.unref();
        setTimeout(resolve, 300);
      } catch {
        resolve();
      }
    });
  if (process.platform === "darwin") return run("open", ["-b", BUNDLE_ID]);
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    const exe = [join(local, "LahLah Video", "lahlah-video.exe"), join(process.env.ProgramFiles ?? "C:\\Program Files", "LahLah Video", "lahlah-video.exe")].find((p) => existsSync(p));
    if (exe) return run(exe, []);
    return run("cmd", ["/c", "start", "", "lahlahvideo://command?text=help"]);
  }
  return run("xdg-open", ["lahlahvideo://command?text=help"]);
}
