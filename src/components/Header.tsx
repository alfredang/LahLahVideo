import { importDialog, newProjectAction, openDialog, saveProject } from "../actions";
import { apply, redo, setUI, undo, useStore } from "../lib/store";
import { modKey } from "../lib/platform";
import { Btn, Icon } from "./ui";

export function Header() {
  const p = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const step = p.clips.length === 0 ? 1 : ui.exportOpen ? 3 : 2;
  return (
    <header className="header">
      <div className="brand" title="LahLah Video by Tertiary Infotech Academy">
        <img src="/icon.svg" alt="" width={30} height={30} />
        <span>
          LahLah <b>Video</b>
        </span>
      </div>
      <ol className="steps" aria-label="Three steps">
        <li className={step === 1 ? "on" : "done"}>
          <button type="button" onClick={() => importDialog(undefined, { toTimeline: true })} title="Add videos, photos or music">
            <span className="num">1</span> Import
          </button>
        </li>
        <li className={step === 2 ? "on" : step > 2 ? "done" : ""}>
          <button type="button" onClick={() => setUI({ exportOpen: false })} title="Cut, arrange and style on the timeline">
            <span className="num">2</span> Edit
          </button>
        </li>
        <li className={step === 3 ? "on" : ""}>
          <button type="button" onClick={() => setUI({ exportOpen: true })} title="Make an MP4 for TikTok or YouTube">
            <span className="num">3</span> Export
          </button>
        </li>
      </ol>
      <input className="proj-name" value={p.name} aria-label="Video name" title="Rename your video" onChange={(e) => apply((q) => ({ ...q, name: e.target.value }), "name")} />
      <div className="header-actions">
        <Btn icon="new" tip="New project" onClick={() => newProjectAction()} kind="ghost" />
        <Btn icon="folder" tip={`Open a project or lahlah-edit.json (${modKey}+O)`} onClick={openDialog} kind="ghost" />
        <Btn icon="save" tip={`Save project (${modKey}+S)`} onClick={() => saveProject()} kind="ghost" className={ui.dirty ? "dirty" : ""} />
        <Btn icon="undo" tip={`Undo (${modKey}+Z)`} onClick={undo} disabled={!canUndo} kind="ghost" />
        <Btn icon="redo" tip={`Redo (${modKey}+Shift+Z)`} onClick={redo} disabled={!canRedo} kind="ghost" />
        <button type="button" className="cmd-open" onClick={() => setUI({ commandOpen: true })} title={`Type or say a command (${modKey}+K)`}>
          <Icon name="mic" size={16} />
          <span>Tell LahLah what to do…</span>
          <kbd>{modKey}K</kbd>
        </button>
        <Btn icon="help" tip="Voice commands and shortcuts (?)" onClick={() => setUI({ helpOpen: true })} kind="ghost" />
        <Btn icon="export" label="Export" kind="primary" big tip={`Export MP4 (${modKey}+E)`} onClick={() => setUI({ exportOpen: true })} />
      </div>
    </header>
  );
}
