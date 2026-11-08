import { useState } from "react";
import { importDialog, newProjectAction, openDialog, openPath } from "../actions";
import { buildDemoProject } from "../lib/demo";
import { recents } from "../lib/projectio";
import { isDesktop } from "../lib/platform";
import { setUI } from "../lib/store";
import { toast } from "../lib/toast";
import { Btn } from "./ui";

export function EmptyStage() {
  const [busy, setBusy] = useState(false);
  const recent = isDesktop ? recents() : [];
  return (
    <div className="empty-stage">
      <div className="empty-card">
        <div className="empty-emoji">🎬</div>
        <h1>Drop your clips here</h1>
        <p>Drag videos, photos or music onto this window. Higgsfield clips, phone videos and screen recordings all work.</p>
        <div className="empty-actions">
          <Btn big kind="primary" icon="import" label="Import media" onClick={() => importDialog(undefined, { toTimeline: true })} />
          <Btn big icon="link" label="Higgsfield clips" tip="Paste Higgsfield download links or open a lahlah-edit.json hand-off" onClick={() => setUI({ leftTab: "higgsfield" })} />
          <Btn
            big
            icon="spark"
            label={busy ? "Building…" : "Try the demo"}
            tip="Load a 12-second Kopi & Coins demo with transitions, text, captions and music"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                newProjectAction(await buildDemoProject());
                toast("Demo loaded. Press Space to play.", "ok");
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        <div className="empty-links">
          <button type="button" className="linkish" onClick={openDialog}>
            Open a project or lahlah-edit.json
          </button>
          {recent.slice(0, 3).map((r) => (
            <button type="button" key={r.path} className="linkish" title={r.path} onClick={() => openPath(r.path)}>
              Recent: {r.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
