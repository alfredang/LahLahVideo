import { useEffect, useRef, useState } from "react";
import { saveProject } from "../actions";
import { apply, setUI, useStore } from "../lib/store";
import { modKey } from "../lib/platform";
import { FILE_MENU } from "../lib/menu";
import { Btn, Icon, Wordmark } from "./ui";

function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="file-menu" ref={ref}>
      <button type="button" className="btn ghost menu-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="New, open, save, import, export">
        <span>File</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <ul role="menu">
          {FILE_MENU.map((e, i) =>
            e === "-" ? (
              <li key={i} className="sep" />
            ) : (
              <li key={e.id}>
                <button type="button" role="menuitem" onClick={() => (setOpen(false), e.run())}>
                  {e.label}
                  {e.hint && <small>{e.hint}</small>}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** Top bar: wordmark and File, then "Auto saved" + project name in the middle, then layout, help, settings and Export. */
export function Header() {
  const p = useStore((s) => s.project);
  const dirty = useStore((s) => s.ui.dirty);
  const saved = useStore((s) => s.ui.lastAutoSave);
  const compact = useStore((s) => s.ui.compact);
  return (
    <header className="header">
      <Wordmark />
      <FileMenu />
      <div className="header-mid">
        <span className="autosaved" title="LahLah keeps a copy of your edit as you work">
          {saved ? `Auto saved: ${new Date(saved).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}` : dirty ? "Not saved yet" : ""}
        </span>
        <input className="proj-name" value={p.name} aria-label="Video name" title="Rename your video" onChange={(e) => apply((q) => ({ ...q, name: e.target.value }), "name")} />
        <Btn icon="save" tip={`Save project (${modKey}+S)`} onClick={() => saveProject()} kind="ghost" className={dirty ? "dirty" : ""} />
      </div>
      <div className="header-actions">
        <Btn icon="layout" tip={compact ? "Show the Details panel" : "Bigger player: hide the Details panel"} onClick={() => setUI({ compact: !compact })} kind="ghost" active={compact} />
        <Btn icon="keyboard" tip="Keyboard shortcuts, voice commands and About (?)" onClick={() => setUI({ helpOpen: true })} kind="ghost" />
        <Btn icon="gear" tip="Settings and API key" onClick={() => setUI({ settingsOpen: true })} kind="ghost" />
        <Btn icon="export" label="Export" kind="cta" big tip={`Export an MP4 for TikTok or YouTube (${modKey}+E)`} onClick={() => setUI({ exportOpen: true })} className="export-btn" />
      </div>
    </header>
  );
}
