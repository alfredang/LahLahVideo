# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Web UI + SSE pipeline server (defaults to :3000, override with PORT=3001)
npm run studio      # Remotion Studio for previewing/debugging the composition
npm run make-video -- "your topic"   # CLI: full script→tts→render pipeline
npm run render      # Re-render the existing public/plan.json to out/video.mp4
```

There is no test or lint script. TypeScript is checked implicitly by `tsx` at runtime.

## External binaries (must be on PATH)

The pipeline shells out to two external tools — these are not npm dependencies:

- **`claude`** — Claude Code CLI, invoked by [src/pipeline/generateScript.ts](src/pipeline/generateScript.ts) as `claude -p --output-format text` with the prompt piped to stdin. Override with `CLAUDE_BIN`.
- **`edge-tts`** — installed via `pip install edge-tts`. Default command is the `edge-tts` binary directly (not `python -m edge_tts`, which fails on systems where only `python3` exists). Override with `EDGE_TTS_CMD`; voice via `EDGE_TTS_VOICE` (default `en-US-AriaNeural`).

If either is missing, the pipeline fails at the corresponding stage with a 127-style "command not found" error.

## Pipeline architecture

The core flow is the same whether triggered via CLI ([makeVideo.ts](src/pipeline/makeVideo.ts)) or Web UI ([server.ts](src/server.ts) → `handleGenerate`):

1. **`generateScript(topic, description?)`** — calls `claude` CLI, extracts the first `{...}` block from stdout, validates with `ScriptSchema` (Zod). Script = `{ title, scenes: [{caption, narration}] }`, 3–5 scenes, 40–75 narration words total.
2. **`generateVoice(scenes)`** — runs `edge-tts` once per scene, writing `public/scene_<i>.mp3` + `public/scene_<i>.vtt`.
3. **`measureAudioFromVtt(vtt)`** — parses the VTT to get exact narration duration, then adds `TAIL_PAD_SEC` (0.35s) of breathing room, converted to frames at 30fps.
4. **Plan assembly** — writes `public/plan.json` (validated by `PlanSchema`). This file is the single source of truth that bridges the Node pipeline and the Remotion composition.
5. **`renderVideo(plan)`** — `@remotion/bundler` bundles `src/index.ts`, `selectComposition` picks `TopicVideo`, dimensions/fps/duration are overridden from the plan, then `renderMedia` outputs `out/video.mp4` (H.264).

### How plan.json reaches Remotion

[src/Root.tsx](src/Root.tsx) registers the `TopicVideo` composition with a `calculateMetadata` callback that fetches `staticFile("plan.json")` at render time and sets `durationInFrames/fps/width/height/props` from it. The composition's `defaultProps` is a placeholder — the real plan only loads when `plan.json` exists in `public/`. This means **`npm run studio` shows fallback content unless you've run a pipeline first**.

### Format selection

Only the Web UI exposes format choice (TikTok 1080x1920 vs YouTube 1920x1080) via `FORMATS` in [server.ts](src/server.ts). The CLI [makeVideo.ts](src/pipeline/makeVideo.ts) hardcodes `WIDTH=1080, HEIGHT=1920` (TikTok). Width/height end up in `plan.json` and override the composition at render time.

### Server concurrency

`server.ts` uses a single module-level `busy` flag — only one generation runs at a time. Don't add per-request state without addressing this.

## Video creation skills

Three project-level skills (installed under [.claude/skills/](.claude/skills/), symlinked from `.agents/skills/`) extend video generation. When the user asks to create a video, **pick the skill that fits the topic** rather than always falling back to the built-in Remotion pipeline:

- **`remotion-best-practices`** — React/Remotion video. This is the **default** and matches the existing pipeline (`TopicVideo` composition, `plan.json`). Use it for the standard topic→script→TTS→render flow, social/explainer clips, and any change to the code in [src/](src/). Reach for it first unless the topic clearly calls for one of the others.
- **`manim`** — Python/Manim animations. Use when the topic is **mathematical, scientific, or educational** and needs precise, programmatic motion: equations, geometry, graphs, algorithms, physics, 3Blue1Brown-style explainers. Requires `manim>=0.19.0` and `python>=3.8` (separate from the Node pipeline; renders its own MP4).
- **`hyperframes`** — HTML-based video compositions. Use for **caption/subtitle-heavy or audio-reactive** content: lyric/beat-synced visuals, animated text highlighting (marker sweeps, hand-drawn circles, scribble), scene transitions (wipes, shader crossfades), and TTS voiceover synced to captions. Companion skills `hyperframes-cli` (init/lint/preview/render) and `hyperframes-media` (tts/transcribe/remove-background) cover its CLI workflow.

**Routing heuristic by topic:** math/science/algorithm explainer → `manim`; caption- or music-driven / stylised motion-graphics → `hyperframes`; everything else (general topic videos, the existing pipeline) → `remotion-best-practices`. Load the chosen skill before writing any video code so its conventions are followed. The supporting animation skills also installed (animejs, gsap, css-animations, lottie, three, typegpu, waapi, tailwind) are referenced by hyperframes and generally don't need to be invoked directly.

## Schemas

[src/types.ts](src/types.ts) defines `ScriptSchema` (LLM output contract) and `PlanSchema` (pipeline→Remotion contract). Both are Zod-validated at boundaries; if you change either, update the prompt in [generateScript.ts](src/pipeline/generateScript.ts) and the consumer in [Video.tsx](src/Video.tsx) accordingly.

## Generated artifacts (gitignored)

`public/scene_*.{mp3,vtt}`, `public/plan.json`, `public/screenshot.png`, `out/`, `.playwright-mcp/`, `.DS_Store`. Don't commit these.
