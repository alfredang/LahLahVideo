import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { LeftPanel } from "./components/LeftPanel";
import { Preview } from "./components/Preview";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { CommandBar } from "./components/CommandBar";
import { ExportDialog } from "./components/ExportDialog";
import { HelpDialog } from "./components/HelpDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { CoachMarks } from "./components/CoachMarks";
import { startControlListener } from "./control/handler";
import { clock, redo, replaceProject, seek, setUI, store, togglePlay, undo, useStore } from "./lib/store";
import { useToasts } from "./lib/toast";
import { clamp, totalDuration } from "./lib/project";
import { deleteSelected, duplicateSelected, importFiles, importPaths, openDialog, openFromText, openPath, saveProject, splitHere, importSrtText } from "./actions";
import { buildDemoProject } from "./lib/demo";
import { autosaveLocal, loadAutosave, serialise } from "./lib/projectio";
import { isDesktop, readText, setWindowTitle } from "./lib/platform";
import { toggleVoiceOver } from "./lib/recorder";
import { runText } from "./commands/execute";
import { installNativeMenu } from "./lib/menu";
import { toast } from "./lib/toast";

/** lahlahvideo://command?text=...  or  lahlahvideo://open?file=... */
export function handleDeepLink(url: string) {
  const m = /^lahlahvideo:\/\/([^/?#]+)\/?\??(.*)$/i.exec(url.trim());
  if (!m) return;
  const params = new URLSearchParams(m[2]);
  const action = m[1].toLowerCase();
  if (action === "command" || action === "cmd" || action === "run") {
    const text = params.get("text") ?? params.get("q") ?? "";
    if (text) runText(text);
  } else if (action === "open") {
    const file = params.get("file") ?? params.get("path");
    if (file) void openPath(file);
  }
  if (isDesktop) {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      void w.unminimize().catch(() => undefined);
      void w.setFocus().catch(() => undefined);
    });
  }
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || (tag === "INPUT" && !["range", "checkbox", "color", "button"].includes((el as HTMLInputElement).type)) || el.isContentEditable || tag === "SELECT";
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const ui = store.get().ui;
      if (mod && k === "k") {
        e.preventDefault();
        setUI({ commandOpen: !ui.commandOpen });
        return;
      }
      if (e.key === "Escape") {
        if (ui.fullscreen) setUI({ fullscreen: false });
        else if (ui.commandOpen || ui.helpOpen || ui.settingsOpen) setUI({ commandOpen: false, helpOpen: false, settingsOpen: false });
        else setUI({ selectedId: null });
        return;
      }
      if (ui.commandOpen || ui.exportOpen || ui.helpOpen || ui.settingsOpen) return;
      if (isTyping(e)) return;
      const fps = store.get().project.fps;
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod && k === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (mod && k === "o") {
        e.preventDefault();
        void openDialog();
      } else if (mod && k === "e") {
        e.preventDefault();
        setUI({ exportOpen: true });
      } else if (mod && k === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (mod) {
        return;
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (k === "s") {
        splitHere();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected(e.shiftKey);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / fps;
        seek(clock.get().t + (e.key === "ArrowLeft" ? -step : step));
      } else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(totalDuration(store.get().project));
      else if (e.key === "+" || e.key === "=") setUI({ zoom: clamp(ui.zoom * 1.5, 8, 400) });
      else if (e.key === "-") setUI({ zoom: clamp(ui.zoom / 1.5, 8, 400) });
      else if (k === "r") void toggleVoiceOver();
      else if (e.key === "?") setUI({ helpOpen: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useFileDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (isDesktop) {
      let un: (() => void) | undefined;
      import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
        un = await getCurrentWebview().onDragDropEvent(async (ev) => {
          const pl = ev.payload;
          if (pl.type === "enter" || pl.type === "over") setOver(true);
          else if (pl.type === "leave") setOver(false);
          else if (pl.type === "drop") {
            setOver(false);
            const media: string[] = [];
            for (const path of pl.paths) {
              if (/\.(lahlah|json)$/i.test(path)) await openPath(path);
              else if (/\.srt$/i.test(path)) importSrtText(await readText(path));
              else media.push(path);
            }
            if (media.length) await importPaths(media, { toTimeline: store.get().project.clips.length === 0 });
          }
        });
      });
      return () => un?.();
    }
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setOver(true);
      }
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setOver(false);
      void importFiles([...e.dataTransfer.files], { toTimeline: store.get().project.clips.length === 0 });
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
  return over;
}

let started = false;

function useStartup() {
  useEffect(() => {
    if (started) return; // StrictMode runs effects twice in dev
    started = true;
    let opened = false;
    const done = (async () => {
      if (isDesktop) {
        void installNativeMenu();
        void startControlListener();
        try {
          const dl = await import("@tauri-apps/plugin-deep-link");
          await dl.onOpenUrl((urls) => urls.forEach(handleDeepLink));
          const first = await dl.getCurrent();
          if (first?.length) {
            opened = true;
            first.forEach(handleDeepLink);
          }
        } catch (e) {
          console.warn("Deep links unavailable", e);
        }
      }
      // Browser/dev helper: ?cmd=... runs a command, ?demo=1 or ?handoff=URL loads content.
      const qs = new URLSearchParams(location.search);
      if (qs.get("handoff")) {
        opened = true;
        const res = await fetch(qs.get("handoff")!);
        const text = await res.text();
        await openFromText(text);
      } else if (qs.get("demo")) {
        opened = true;
        replaceProject(await buildDemoProject());
      }
      if (!opened) {
        const saved = loadAutosave();
        if (saved) {
          replaceProject(saved);
          toast(`Welcome back. Restored "${saved.name}".`, "ok");
        }
      }
      if (qs.get("cmd")) runText(qs.get("cmd")!);
      if (qs.get("open") === "command") setUI({ commandOpen: true });
    })();
    void done;
  }, []);

  // Auto-save: browser storage always; the .lahlah file too once it has been saved once.
  useEffect(() => {
    let last = store.get().project;
    let fileTimer: ReturnType<typeof setTimeout> | undefined;
    return store.subscribe(() => {
      const s = store.get();
      if (s.project === last) return;
      last = s.project;
      autosaveLocal(s.project);
      setTimeout(() => setUI({ lastAutoSave: Date.now() }), 1300);
      setWindowTitle(`${s.project.name}${s.ui.dirty ? " •" : ""} - LahLah Video`);
      if (isDesktop && s.ui.projectPath && s.ui.dirty) {
        clearTimeout(fileTimer);
        fileTimer = setTimeout(async () => {
          const cur = store.get();
          if (!cur.ui.projectPath) return;
          try {
            const { writeTextFile } = await import("@tauri-apps/plugin-fs");
            await writeTextFile(cur.ui.projectPath, serialise(cur.project));
            setUI({ dirty: false, lastSaved: Date.now() });
          } catch {
            /* keep the dirty flag; the user can Save manually */
          }
        }, 4000);
      }
    });
  }, []);
}

export default function App() {
  useKeyboard();
  useStartup();
  const over = useFileDrop();
  const ui = useStore((s) => s.ui);
  const toasts = useToasts();
  return (
    <div className="app">
      <Header />
      <div className={`workspace ${ui.compact ? "compact" : ""}`}>
        <LeftPanel />
        <Preview />
        <Inspector />
      </div>
      <Timeline />
      {over && (
        <div className="drop-overlay">
          <div>Drop to import videos, photos, music, SRT or a lahlah-edit.json</div>
        </div>
      )}
      {ui.commandOpen && <CommandBar />}
      {ui.exportOpen && <ExportDialog />}
      {ui.helpOpen && <HelpDialog />}
      {ui.settingsOpen && <SettingsDialog />}
      <CoachMarks />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
