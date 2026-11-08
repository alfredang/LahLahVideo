import { useEffect, useState } from "react";
import { setUI } from "../lib/store";
import { isDesktop, openExternal } from "../lib/platform";
import { toast } from "../lib/toast";
import { Btn, Modal } from "./ui";

interface ApiInfo {
  enabled: boolean;
  apiKey: string;
  port: number;
  baseUrl: string;
  controlFile: string;
  version: string;
}

const DOCS = "https://github.com/alfredang/LahLahVideo/blob/main/docs/API.md";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export function SettingsDialog() {
  const [info, setInfo] = useState<ApiInfo | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isDesktop) call<ApiInfo>("api_info").then(setInfo).catch(() => setInfo(null));
  }, []);
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    toast(`${what} copied`, "ok");
  };
  return (
    <Modal title="Settings" onClose={() => setUI({ settingsOpen: false })} wide>
      <section className="settings-section">
        <h3>API</h3>
        <p className="hint">
          Let Claude (through the LahLah Video MCP server), LahLah Voice or your own scripts drive this window. It listens on this computer only (127.0.0.1); nothing on your network or the internet can reach it, and every call needs the key below.
        </p>
        {!isDesktop ? (
          <div className="empty-hint">The API runs in the desktop app.</div>
        ) : !info ? (
          <div className="empty-hint">Starting the API…</div>
        ) : (
          <div className="api-grid">
            <span className="field-label">Allow API control</span>
            <label className="switch" title="Off: the API answers 403 and control.json is removed">
              <input
                type="checkbox"
                checked={info.enabled}
                onChange={async (e) => setInfo(await call<ApiInfo>("api_set_enabled", { enabled: e.target.checked }))}
              />
              <span>{info.enabled ? "On" : "Off"}</span>
            </label>
            <span className="field-label">API key</span>
            <div className="row">
              <code className="key">{show ? info.apiKey : `${info.apiKey.slice(0, 8)}${"•".repeat(24)}`}</code>
              <Btn label={show ? "Hide" : "Show"} onClick={() => setShow(!show)} />
              <Btn label="Copy" onClick={() => copy(info.apiKey, "API key")} />
              <Btn
                label="Regenerate"
                kind="danger"
                tip="Make a new key. Scripts using the old one stop working; the MCP server picks up the new one by itself."
                onClick={async () => {
                  setInfo(await call<ApiInfo>("api_regenerate_key"));
                  toast("New API key made", "ok");
                }}
              />
            </div>
            <span className="field-label">Base URL</span>
            <div className="row">
              <code>{info.baseUrl}</code>
              <Btn label="Copy" onClick={() => copy(info.baseUrl, "Base URL")} />
            </div>
            <span className="field-label">For tools</span>
            <p className="hint">
              The port changes each launch. Tools read it and the key from <code>{info.controlFile}</code> (only your user account can read it).
            </p>
            <span className="field-label">Docs</span>
            <div className="row">
              <Btn label="API reference" icon="link" onClick={() => openExternal(DOCS)} />
              <Btn label="OpenAPI JSON" icon="link" onClick={() => openExternal(`${info.baseUrl}/openapi.json`)} />
            </div>
          </div>
        )}
      </section>
      <section className="settings-section">
        <h3>Use LahLah Video from Claude</h3>
        <p className="hint">
          Install the LahLah Video extension in Claude Desktop (double-click <code>lahlah-video.mcpb</code> from the latest release), or in Claude Code run{" "}
          <code>claude mcp add lahlah-video -- npx -y https://github.com/alfredang/LahLahVideo/releases/latest/download/lahlah-video-mcp.tgz</code>. Then ask Claude to open your hand-off, add a crossfade and export for TikTok.
        </p>
      </section>
    </Modal>
  );
}
