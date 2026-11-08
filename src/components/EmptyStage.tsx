import { useState } from "react";
import { newProjectAction, openPath } from "../actions";
import { buildDemoProject } from "../lib/demo";
import { recents } from "../lib/projectio";
import { isDesktop } from "../lib/platform";
import { toast } from "../lib/toast";

/** The empty player: quiet, with one way to try things out. Importing lives in the Media panel. */
export function EmptyStage() {
  const [busy, setBusy] = useState(false);
  const recent = isDesktop ? recents().slice(0, 3) : [];
  return (
    <div className="empty-stage">
      <div className="empty-player">
        <b>Your video plays here</b>
        <span>Import clips on the left, or open Claude's hand-off.</span>
        <button
          type="button"
          className="linkish"
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
        >
          {busy ? "Building the demo…" : "Or try the Kopi & Coins demo"}
        </button>
        {recent.map((r) => (
          <button type="button" key={r.path} className="linkish" title={r.path} onClick={() => openPath(r.path)}>
            Recent: {r.name}
          </button>
        ))}
      </div>
    </div>
  );
}
