# LahLah Video local API

Drive the running editor from Claude, LahLah Voice or your own scripts. Every edit lands in the same undo history as a click, so **Cmd/Ctrl+Z** takes back anything a script did.

- **Local only.** The server listens on `127.0.0.1`, on a random free port chosen at launch. Nothing on your network or the internet can reach it.
- **API key.** Every call needs the key from **Settings › API** (gear icon, top right). Send it as `Authorization: Bearer <key>` or `X-API-Key: <key>`. Regenerate it there at any time.
- **On/off.** **Settings › API › Allow API control** (on by default). Off means every call gets `403` and `control.json` is removed.
- **Machine-readable spec:** `GET /openapi.json` on the running app, or [`docs/openapi.json`](openapi.json) in this repo.

## Finding the port and key

While the app runs with the API on, it writes `control.json`, readable only by your user account:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/com.tertiaryinfotech.lahlahvideo/control.json` |
| Windows | `%APPDATA%\com.tertiaryinfotech.lahlahvideo\control.json` |

```json
{ "app": "LahLah Video", "version": "1.1.0", "port": 51234, "baseUrl": "http://127.0.0.1:51234", "apiKey": "llv_…", "pid": 4242 }
```

`apiKey` and `token` hold the same value: `token` is kept for tools written against the first draft of this file. Both are the bearer key, so treat `control.json` like a password file. On macOS it is created with mode `0600` (owner read/write only), as is `api-key`; on Windows both sit in your own `%APPDATA%` profile. The file exists only while the app runs with **Allow API control** on, and is removed when you quit or switch the API off. The key itself lives in `api-key` in the same folder (user-only permissions). The app never writes it to a log. Scripts can also set `LAHLAH_VIDEO_API_KEY` and `LAHLAH_VIDEO_URL` (the MCP server honours both).

```bash
CTL=~/Library/Application\ Support/com.tertiaryinfotech.lahlahvideo/control.json
URL=$(python3 -c "import json;print(json.load(open('$CTL'))['baseUrl'])")
KEY=$(python3 -c "import json;print(json.load(open('$CTL'))['apiKey'])")
curl -s -H "Authorization: Bearer $KEY" "$URL/v1/status"
```

## Endpoints

| Method and path | MCP tool | Does |
|---|---|---|
| `GET /v1/health` | | Is the app up? Answered without touching the editor. |
| `GET /v1/status` | `status` | Version, open project (name, file, duration, ratio, canvas, clip and caption counts), recent export jobs. |
| `POST /v1/handoff` | `open_handoff` | `{ "path": "/abs/lahlah-edit.json" }` or `{ "json": { "schema": "lahlah-edit/1", … }, "baseDir": "/abs/folder" }`. Opens a hand-off (or a `.lahlah` project); downloads `https://` clips. Returns the timeline. |
| `POST /v1/clips` | `add_clips` | `{ "sources": ["https://…mp4", "/abs/clip.mov"], "track": "main\|overlay\|music\|voice\|audio\|none", "at": 2.5 }`. Imports in order and places on the timeline. |
| `POST /v1/commands` | `run_command` | `{ "text": "split at 3 seconds" }`. The command-bar parser; returns `{ ok, command, message, timeline }` or `{ ok: false, error, suggestions }`. |
| `GET /v1/timeline` | `get_timeline` | Tracks, clips (start, end, duration, speed, transition, text, look), captions, media, playhead. |
| `PUT /v1/captions` | `set_captions` | `{ "srt": "1\n00:00:00,000 --> …" }` or `{ "captions": [{ "start": 0, "end": 2.5, "text": "…" }] }`. Replaces the Captions track. |
| `POST /v1/exports` | `export` | `{ "preset": "tiktok\|youtube_shorts\|youtube", "resolution": "720p\|1080p\|4k", "fps": 30, "path": "/abs/out.mp4" }`. Starts an MP4 export and returns `{ job }` at once. |
| `GET /v1/exports/{id}` | `export_status` | `{ job: { id, state: running\|done\|failed, progress 0..1, output, error } }`. |
| `GET /v1/projects` | `list_projects` | The open project and recent `.lahlah` files. |
| `POST /v1/projects/save` | `save_project` | `{ "path": "/abs/name.lahlah" }` (optional). Saves to that path, the project's own file, or `Documents/LahLah Video/<name>.lahlah`. |
| `GET /v1/snapshot?t=2.5&width=540` | `snapshot` | One frame rendered by the export engine: `{ mimeType: "image/png", base64, time, width, height }`. |

Errors come back as `{ "error": "…" }` with `400` (bad input), `401` (key), `403` (API off), `404` (no route or job), `500`, `503` (window not ready) or `504` (the editor took longer than 10 minutes).

## Examples

```bash
H="Authorization: Bearer $KEY"
curl -s -H "$H" -X POST "$URL/v1/handoff"  -d '{"path":"/Users/me/Kopi/lahlah-edit.json"}'
curl -s -H "$H" -X POST "$URL/v1/commands" -d '{"text":"add crossfade"}'
curl -s -H "$H" -X POST "$URL/v1/exports"  -d '{"preset":"tiktok"}'          # → {"job":{"id":"exp_…"}}
curl -s -H "$H" "$URL/v1/exports/exp_…"                                    # poll until "state":"done"
curl -s -H "$H" "$URL/v1/snapshot?t=2" | python3 -c "import sys,json,base64;open('frame.png','wb').write(base64.b64decode(json.load(sys.stdin)['base64']))"
```

## Security notes

- The server binds to `127.0.0.1` only and sends no CORS headers, so web pages in your browser cannot read its answers.
- The key is 48 random hex characters. Compare it like a password: don't paste it into chats or commit it.
- `control.json` and `api-key` are created with user-only permissions on macOS (`0600`); on Windows they sit in your own `%APPDATA%` profile.
- Turning **Allow API control** off stops all access immediately. Quitting the app stops the server and removes `control.json`.
