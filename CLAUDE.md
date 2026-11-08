# CLAUDE.md

Guidance for Claude Code in this repository.

## What this repo is

**LahLah Video**: a CapCut-style desktop video editor (Tauri 2 + React + TypeScript + Vite, FFmpeg sidecar for export) for the WSQ course *Agentic AI for Video Creation*. The original topic-to-video Remotion pipeline lives on in `topic-to-video/` (its own package.json; run it from that folder).

## Commands

```bash
npm install
npm run dev        # browser-only editor at http://localhost:1420 (export disabled). ?demo=1 loads the demo
npm run desktop    # fetches FFmpeg for this machine into src-tauri/binaries, then `tauri dev` (needs Rust)
npm test           # vitest: parser, timeline ops, hand-off/SRT, FFmpeg builder
LAHLAH_FFMPEG=/path/to/ffmpeg npm test   # also renders a sample project for real
npm run build      # tsc + vite build
```

CI (`.github/workflows/ci.yml`) typechecks, tests with a real static FFmpeg, builds the web bundle and parses the PowerShell installer. `release.yml` builds `.dmg` (aarch64 + x64) and NSIS `.exe` on `v*` tags (and test builds on `wip/**` branches) with tauri-action.

## Layout

- `src/lib/types.ts`, `src/lib/project.ts`: data model and pure timeline operations (main track is magnetic; transitions overlap clips).
- `src/lib/store.ts`: store + undo/redo (`apply(fn, coalesceKey)`); the playhead lives in a separate `clock` store.
- `src/export/ffmpeg.ts`: project -> one FFmpeg command (xfade, overlay, eq, amix, sidechaincompress). Pure and tested; keep preview (`src/components/Preview.tsx`) in step with it.
- `src/commands/parse.ts`: offline plain-English command parser; `execute.ts` runs commands. Every cheat-sheet line (`cheatsheet.ts`) must parse (tested).
- `src/lib/handoff.ts`: the `lahlah-edit/1` hand-off schema shared with the course skills. Do not change field names.
- `src-tauri/`: Rust shell (plugins only), capabilities, config. Bundle id `com.tertiaryinfotech.lahlahvideo`, deep-link scheme `lahlahvideo://`.
- `install/`: one-line installers referenced by the course labs. Keep the URLs and behaviour stable.
- `src/styles/tokens.css`: the LahLah family design tokens (from LahLah Voice's `Brand.swift`). White theme; colours live here only.
- Layout follows CapCut desktop conventions (layout only, never its branding): asset panel with a horizontal tab row (top left), Player (centre), Details/inspector (right), timeline (bottom) with the main track and Cover tile.
- `src-tauri/src/control.rs` + `src/control/`: local API on 127.0.0.1 (random port, key in Settings › API, `control.json` in app data). Routes are defined once in `src/control/protocol.ts` and documented in `docs/openapi.json` / `docs/API.md`; tests check they agree.
- `mcp/`: the MCP server (stdio) and the Claude Desktop extension (`mcp/bundle/manifest.json`, packed with `npm run bundle`). `cd mcp && npm test`; `node test/e2e.mjs <handoff> <out.mp4>` drives a running app end to end.
- `scripts/make_icon.swift`: renders the app icon in the LahLah family style (`swift scripts/make_icon.swift out.png --rounded`, then `npx tauri icon`).

## Video creation skills

Three project-level skills (installed under [.claude/skills/](.claude/skills/), symlinked from `.agents/skills/`) extend video generation. When the user asks to create a video, **pick the skill that fits the topic** rather than always falling back to the built-in Remotion pipeline:

- **`remotion-best-practices`** — React/Remotion video. This is the **default** and matches the topic-to-video pipeline (`TopicVideo` composition, `plan.json`). Use it for the standard topic→script→TTS→render flow, social/explainer clips, and any change to the code in [topic-to-video/src/](topic-to-video/src/). Reach for it first unless the topic clearly calls for one of the others.
- **`manim`** — Python/Manim animations. Use when the topic is **mathematical, scientific, or educational** and needs precise, programmatic motion: equations, geometry, graphs, algorithms, physics, 3Blue1Brown-style explainers. Requires `manim>=0.19.0` and `python>=3.8` (separate from the Node pipeline; renders its own MP4).
- **`hyperframes`** — HTML-based video compositions. Use for **caption/subtitle-heavy or audio-reactive** content: lyric/beat-synced visuals, animated text highlighting (marker sweeps, hand-drawn circles, scribble), scene transitions (wipes, shader crossfades), and TTS voiceover synced to captions. Companion skills `hyperframes-cli` (init/lint/preview/render) and `hyperframes-media` (tts/transcribe/remove-background) cover its CLI workflow.

**Routing heuristic by topic:** math/science/algorithm explainer → `manim`; caption- or music-driven / stylised motion-graphics → `hyperframes`; everything else (general topic videos, the existing pipeline) → `remotion-best-practices`. Load the chosen skill before writing any video code so its conventions are followed. The supporting animation skills also installed (animejs, gsap, css-animations, lottie, three, typegpu, waapi, tailwind) are referenced by hyperframes and generally don't need to be invoked directly.
