// Runs a parsed command against the editor.
import { Command, parseCommand } from "./parse";
import { apply, clock, pause, play, project, redo, seek, setUI, undo, ui } from "../lib/store";
import {
  addSticker,
  addText,
  clamp,
  LOOKS,
  mainTrack,
  setAspect,
  setSpeed,
  setTransition,
  sourceLimit,
  trackOf,
  updateClip,
  clipsOnTrack,
} from "../lib/project";
import { addMusic, deleteSelected, duplicateSelected, importDialog, openDialog, saveProject, select, selectRelative, splitHere, targetClip } from "../actions";
import { toggleVoiceOver } from "../lib/recorder";
import { toast } from "../lib/toast";

export function runText(text: string): { ok: boolean; message: string } {
  const r = parseCommand(text);
  if (!r.ok) {
    toast(`${r.error} Try: ${r.suggestions.slice(0, 2).join(" · ")}`, "error", 5000);
    return { ok: false, message: r.error };
  }
  const msg = execute(r.command) ?? r.say;
  toast(msg, "ok");
  return { ok: true, message: msg };
}

function needClip(): ReturnType<typeof targetClip> {
  const c = targetClip();
  if (!c) toast("Add a clip to the timeline first", "info");
  return c;
}

/** Returns an override message, or undefined to use the parser's. */
export function execute(cmd: Command): string | undefined {
  const t = clock.get().t;
  switch (cmd.kind) {
    case "play":
      play();
      return;
    case "pause":
      pause();
      return;
    case "seek":
      seek(cmd.t);
      return;
    case "seek-rel":
      seek(t + cmd.dt);
      return;
    case "split":
      splitHere(cmd.at);
      return;
    case "delete":
      deleteSelected(cmd.ripple);
      return;
    case "duplicate":
      duplicateSelected();
      return;
    case "trim": {
      const c = needClip();
      if (!c) return "Nothing to trim";
      const limit = sourceLimit(project(), c);
      if (cmd.edge === "start") {
        const by = cmd.by ?? (cmd.to !== undefined ? cmd.to - c.inPoint / c.speed : 0);
        const d = clamp(by, -c.inPoint / c.speed, c.duration - 0.1);
        apply((p) => {
          const q = updateClip(p, c.id, { inPoint: Math.max(0, c.inPoint + d * c.speed), duration: c.duration - d, start: trackOf(p, c)?.type === "main" ? c.start : c.start + d });
          return q;
        });
        return `Trimmed ${Math.abs(d).toFixed(1)}s ${d >= 0 ? "off" : "back onto"} the start`;
      }
      let dur = cmd.by !== undefined ? c.duration - cmd.by : (cmd.to ?? c.duration) - c.inPoint / c.speed;
      if (isFinite(limit)) dur = Math.min(dur, (limit - c.inPoint) / c.speed);
      dur = Math.max(0.1, dur);
      apply((p) => updateClip(p, c.id, { duration: dur }));
      return `Clip now runs ${dur.toFixed(1)}s`;
    }
    case "speed": {
      const c = needClip();
      if (!c || c.type === "text" || c.type === "sticker" || c.type === "image") return c ? "Speed works on video and audio clips" : undefined;
      apply((p) => setSpeed(p, c.id, cmd.value));
      return `Speed ${clamp(cmd.value, 0.25, 4)}x`;
    }
    case "mute": {
      const c = needClip();
      if (!c) return;
      apply((p) => updateClip(p, c.id, { muted: cmd.on }));
      return;
    }
    case "volume": {
      const c = needClip();
      if (!c) return;
      const v = cmd.value !== undefined ? cmd.value : c.volume + (cmd.step ?? 1) * 0.2;
      apply((p) => updateClip(p, c.id, { volume: clamp(v, 0, 2), muted: false }));
      return `Volume ${Math.round(clamp(v, 0, 2) * 100)}%`;
    }
    case "add-text": {
      const r = addText(project(), cmd.text, { at: cmd.at ?? t, duration: cmd.duration ?? 3, preset: "tiktok" });
      apply(() => r.project);
      select(r.clip.id);
      return;
    }
    case "transition": {
      const p = project();
      const main = clipsOnTrack(p, mainTrack(p).id);
      let c = targetClip();
      if (!c || trackOf(p, c)?.type !== "main") c = main.find((x) => x.start > t - 0.001) ?? main[main.length - 1] ?? null;
      if (!c) return "Add two clips first";
      let idx = main.findIndex((x) => x.id === c!.id);
      if (idx === 0 && main.length > 1) idx = 1; // a transition sits between two clips
      if (idx <= 0) return "Transitions need two clips on the main track";
      apply((q) => setTransition(q, main[idx].id, cmd.type, cmd.duration ?? 0.5));
      select(main[idx].id);
      return cmd.type === "cut" ? "Hard cut" : `${cmd.type[0].toUpperCase()}${cmd.type.slice(1)} between clip ${idx} and ${idx + 1}`;
    }
    case "aspect":
      apply((p) => setAspect(p, cmd.aspect));
      return;
    case "add-music":
      void addMusic();
      return;
    case "import":
      void importDialog(undefined, { toTimeline: true });
      return;
    case "record-vo":
      void toggleVoiceOver();
      return;
    case "zoom":
      setUI({ zoom: clamp(ui().zoom * (cmd.dir > 0 ? 1.5 : 1 / 1.5), 8, 400) });
      return;
    case "scale": {
      const c = needClip();
      if (!c) return;
      apply((p) => updateClip(p, c.id, (x) => ({ transform: { ...x.transform, scale: clamp(x.transform.scale * (cmd.dir > 0 ? 1.2 : 1 / 1.2), 0.1, 5) } })));
      return;
    }
    case "flip": {
      const c = needClip();
      if (!c) return;
      apply((p) => updateClip(p, c.id, (x) => ({ transform: { ...x.transform, ...(cmd.axis === "h" ? { flipH: !x.transform.flipH } : { flipV: !x.transform.flipV }) } })));
      return;
    }
    case "rotate": {
      const c = needClip();
      if (!c) return;
      apply((p) => updateClip(p, c.id, (x) => ({ transform: { ...x.transform, rotation: (x.transform.rotation + cmd.deg) % 360 } })));
      return;
    }
    case "fade": {
      const c = needClip();
      if (!c) return;
      const d = Math.min(cmd.duration ?? 0.5, c.duration / 2);
      apply((p) => updateClip(p, c.id, { ...(cmd.which !== "out" ? { fadeIn: d } : {}), ...(cmd.which !== "in" ? { fadeOut: d } : {}) }));
      return;
    }
    case "look": {
      const c = needClip();
      const look = LOOKS.find((l) => l.id === cmd.look) ?? LOOKS[0];
      if (!c) return;
      apply((p) => updateClip(p, c.id, (x) => ({ adjust: { ...x.adjust, ...look.adjust, look: look.id } })));
      return `Look: ${look.name}`;
    }
    case "sticker": {
      const r = addSticker(project(), cmd.emoji, t);
      apply(() => r.project);
      select(r.clip.id);
      return;
    }
    case "select":
      selectRelative(cmd.which);
      return;
    case "background":
      apply((p) => ({ ...p, background: { ...p.background, type: cmd.type } }));
      return;
    case "undo":
      return undo() ? undefined : "Nothing to undo";
    case "redo":
      return redo() ? undefined : "Nothing to redo";
    case "save":
      void saveProject();
      return;
    case "open":
      void openDialog();
      return;
    case "export": {
      if (cmd.preset === "youtube" && project().aspect !== "16:9") apply((p) => setAspect(p, "16:9"));
      if ((cmd.preset === "tiktok" || cmd.preset === "shorts") && project().aspect !== "9:16") apply((p) => setAspect(p, "9:16"));
      setUI({ exportOpen: true, exportPreset: cmd.preset, exportQuality: cmd.quality });
      return;
    }
    case "auto-captions":
      setUI({ leftTab: "captions" });
      return "Open Captions to run auto-captions";
    case "help":
      setUI({ helpOpen: true });
      return;
  }
}
