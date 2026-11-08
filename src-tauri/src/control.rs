//! LahLah Video local control API.
//!
//! A tiny HTTP server on 127.0.0.1 (random free port) that lets Claude (through the MCP server in
//! `mcp/`), LahLah Voice or your own scripts drive the running editor. Every request needs the API
//! key from Settings › API. Rust only checks the key and forwards `/v1/...` calls to the editor
//! (the web view), which runs them through the same undoable actions as the buttons.
//!
//! Files in the app-data folder (macOS: ~/Library/Application Support/com.tertiaryinfotech.lahlahvideo,
//! Windows: %APPDATA%\com.tertiaryinfotech.lahlahvideo):
//!   api-key        the key, created on first launch, user-only permissions
//!   settings.json  { "apiEnabled": true }
//!   control.json   { port, baseUrl, apiKey, version, pid } while the app runs with the API on
//!
//! The key is never logged.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

const OPENAPI: &str = include_str!("../../docs/openapi.json");
const MAX_BODY: u64 = 32 * 1024 * 1024;

pub struct Control {
    enabled: AtomicBool,
    key: Mutex<String>,
    port: Mutex<u16>,
    dir: PathBuf,
    version: String,
    pending: Mutex<HashMap<u64, mpsc::Sender<(u16, Value)>>>,
    next_id: AtomicU64,
}

pub type ControlHandle = Arc<Control>;

fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn new_key() -> String {
    let mut bytes = [0u8; 24];
    if getrandom::fill(&mut bytes).is_err() {
        // Extremely unlikely; fall back to time-based entropy rather than failing to start.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = (nanos >> ((i % 16) * 8)) as u8 ^ (i as u8).wrapping_mul(97);
        }
    }
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("llv_{hex}")
}

/// Compares without stopping at the first different byte.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Control {
    fn control_file(&self) -> PathBuf {
        self.dir.join("control.json")
    }

    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port.lock().unwrap())
    }

    pub fn info(&self) -> Value {
        json!({
            "enabled": self.enabled.load(Ordering::SeqCst),
            "apiKey": *self.key.lock().unwrap(),
            "port": *self.port.lock().unwrap(),
            "baseUrl": self.base_url(),
            "controlFile": self.control_file().to_string_lossy(),
            "version": self.version,
        })
    }

    /// Publishes (or removes) control.json so the MCP server and LahLah Voice can find the app.
    fn publish(&self) {
        let path = self.control_file();
        if self.enabled.load(Ordering::SeqCst) && *self.port.lock().unwrap() != 0 {
            let doc = json!({
                "app": "LahLah Video",
                "version": self.version,
                "port": *self.port.lock().unwrap(),
                "baseUrl": self.base_url(),
                "apiKey": *self.key.lock().unwrap(),
                "token": *self.key.lock().unwrap(),
                "pid": std::process::id(),
            });
            let _ = write_private(&path, &serde_json::to_string_pretty(&doc).unwrap_or_default());
        } else {
            let _ = fs::remove_file(&path);
        }
    }

    pub fn shutdown(&self) {
        let _ = fs::remove_file(self.control_file());
    }

    fn save_settings(&self) {
        let doc = json!({ "apiEnabled": self.enabled.load(Ordering::SeqCst) });
        let _ = write_private(&self.dir.join("settings.json"), &doc.to_string());
    }
}

/// Creates the key and settings if needed and starts the server on a background thread.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> ControlHandle {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("com.tertiaryinfotech.lahlahvideo"));
    let _ = fs::create_dir_all(&dir);

    let key_path = dir.join("api-key");
    let key = match fs::read_to_string(&key_path) {
        Ok(k) if k.trim().len() >= 20 => k.trim().to_string(),
        _ => {
            let k = new_key();
            let _ = write_private(&key_path, &k);
            k
        }
    };
    let enabled = fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("apiEnabled").and_then(Value::as_bool))
        .unwrap_or(true);

    let control = Arc::new(Control {
        enabled: AtomicBool::new(enabled),
        key: Mutex::new(key),
        port: Mutex::new(0),
        dir,
        version: app.package_info().version.to_string(),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
    });

    match tiny_http::Server::http("127.0.0.1:0") {
        Ok(server) => {
            let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
            *control.port.lock().unwrap() = port;
            control.publish();
            let server = Arc::new(server);
            let ctl = control.clone();
            let handle = app.clone();
            thread::spawn(move || {
                for request in server.incoming_requests() {
                    let ctl = ctl.clone();
                    let handle = handle.clone();
                    thread::spawn(move || serve(request, &ctl, &handle));
                }
            });
        }
        Err(e) => eprintln!("LahLah Video: control API could not start: {e}"),
    }
    control
}

fn respond(request: tiny_http::Request, status: u16, body: &Value) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap();
    let response = tiny_http::Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(header);
    let _ = request.respond(response);
}

fn serve<R: Runtime>(mut request: tiny_http::Request, ctl: &Control, app: &AppHandle<R>) {
    let method = request.method().as_str().to_uppercase();
    let url = request.url().to_string();
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (url.clone(), String::new()),
    };

    if path == "/openapi.json" {
        let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
        let _ = request.respond(tiny_http::Response::from_string(OPENAPI).with_header(header));
        return;
    }
    if !ctl.enabled.load(Ordering::SeqCst) {
        return respond(request, 403, &json!({ "error": "API control is off. Turn it on in LahLah Video › Settings › API." }));
    }

    let supplied = request
        .headers()
        .iter()
        .find_map(|h| {
            let name = h.field.as_str().as_str().to_ascii_lowercase();
            let value = h.value.as_str().trim().to_string();
            match name.as_str() {
                "authorization" => value.strip_prefix("Bearer ").map(|v| v.trim().to_string()),
                "x-api-key" => Some(value),
                _ => None,
            }
        })
        .unwrap_or_default();
    let key = ctl.key.lock().unwrap().clone();
    if !same(&supplied, &key) {
        return respond(request, 401, &json!({ "error": "Missing or wrong API key. Send: Authorization: Bearer <key>" }));
    }

    if path == "/v1/health" {
        return respond(request, 200, &json!({ "ok": true, "app": "LahLah Video", "version": ctl.version }));
    }
    if !path.starts_with("/v1/") {
        return respond(request, 404, &json!({ "error": format!("No route {method} {path}. See /openapi.json") }));
    }

    let mut raw = String::new();
    if request.as_reader().take(MAX_BODY).read_to_string(&mut raw).is_err() {
        return respond(request, 400, &json!({ "error": "Body must be UTF-8 JSON" }));
    }
    let body: Value = if raw.trim().is_empty() {
        Value::Null
    } else {
        match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => return respond(request, 400, &json!({ "error": format!("Body is not valid JSON: {e}") })),
        }
    };

    let id = ctl.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    ctl.pending.lock().unwrap().insert(id, tx);
    let event = json!({ "id": id, "method": method, "path": path, "query": query, "body": body });
    if app.emit("lahlah-control", event).is_err() {
        ctl.pending.lock().unwrap().remove(&id);
        return respond(request, 503, &json!({ "error": "The editor window is not ready" }));
    }
    // Hand-offs with many downloads can take a while; exports return a job id straight away.
    match rx.recv_timeout(Duration::from_secs(600)) {
        Ok((status, value)) => respond(request, status, &value),
        Err(_) => {
            ctl.pending.lock().unwrap().remove(&id);
            respond(request, 504, &json!({ "error": "The editor did not answer in time" }))
        }
    }
}

/// The editor's answer to a forwarded request.
#[tauri::command]
pub fn control_reply(state: State<'_, ControlHandle>, id: u64, status: u16, body: Value) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send((status, body));
    }
}

#[tauri::command]
pub fn api_info(state: State<'_, ControlHandle>) -> Value {
    state.info()
}

#[tauri::command]
pub fn api_set_enabled(state: State<'_, ControlHandle>, enabled: bool) -> Value {
    state.enabled.store(enabled, Ordering::SeqCst);
    state.save_settings();
    state.publish();
    state.info()
}

#[tauri::command]
pub fn api_regenerate_key(state: State<'_, ControlHandle>) -> Value {
    let key = new_key();
    let _ = write_private(&state.dir.join("api-key"), &key);
    *state.key.lock().unwrap() = key;
    state.publish();
    state.info()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_long_and_different() {
        let a = new_key();
        let b = new_key();
        assert!(a.starts_with("llv_") && a.len() == 52);
        assert_ne!(a, b);
    }

    #[test]
    fn compare_is_exact() {
        assert!(same("llv_abc", "llv_abc"));
        assert!(!same("llv_abc", "llv_abd"));
        assert!(!same("llv_abc", "llv_ab"));
    }

    #[test]
    fn openapi_is_valid_json() {
        let v: Value = serde_json::from_str(OPENAPI).unwrap();
        assert_eq!(v["info"]["title"], "LahLah Video local API");
    }

    #[cfg(unix)]
    #[test]
    fn private_files_are_user_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("llv-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("api-key");
        write_private(&p, "secret").unwrap();
        assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        fs::remove_dir_all(dir).unwrap();
    }
}
