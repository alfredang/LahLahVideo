import { setUI } from "../lib/store";
import { isMac, modKey } from "../lib/platform";
import { useEffect, useState } from "react";
import { Mark, Modal } from "./ui";
import { VOICE_GROUPS } from "../commands/cheatsheet";

const KEYS: [string, string][] = [
  ["Space", "Play / pause"],
  ["S", "Split at the playhead"],
  ["Delete", "Delete clip"],
  ["Shift + Delete", "Ripple delete (close the gap)"],
  [`${modKey} + D`, "Duplicate clip"],
  [`${modKey} + Z`, "Undo"],
  [`${modKey} + Shift + Z`, "Redo"],
  ["← / →", "Step one frame (Shift: one second)"],
  ["Home / End", "Jump to start / end"],
  ["+ / −", "Zoom the timeline"],
  ["R", "Record voice-over"],
  [`${modKey} + K`, "Command bar"],
  [`${modKey} + S`, "Save project"],
  [`${modKey} + O`, "Open project or hand-off"],
  [`${modKey} + E`, "Export"],
];

export function HelpDialog() {
  const [appVersion, setVersion] = useState("");
  useEffect(() => {
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);
  return (
    <Modal title="Help and About" onClose={() => setUI({ helpOpen: false })} wide>
      <div className="about-card">
        <Mark size={44} />
        <div>
          <b>LahLah Video {appVersion}</b>
          <p className="hint">
            From the makers of <a href="https://alfredang.github.io/lahlahvoiceapp/" target="_blank" rel="noreferrer">LahLah Voice</a>. Built by Tertiary Infotech Academy for the WSQ course <i>Agentic AI for Video Creation</i>.{" "}
            <a href="https://github.com/alfredang/LahLahVideo" target="_blank" rel="noreferrer">Source and updates</a>.
          </p>
        </div>
      </div>
      <div className="help-grid">
        <section>
          <h3>Talk to LahLah Video</h3>
          <p className="hint">
            Press <kbd>{modKey} K</kbd> (or the mic button at the top), then type or dictate. {isMac ? (
              <>
                On Mac, <b>LahLah Voice</b> types straight into the box. Turn on “LahLah Video commands” in LahLah Voice and just say <i>“Video, split here”</i> from anywhere.
              </>
            ) : (
              <>
                On Windows, press <kbd>Win H</kbd> inside the box and speak.
              </>
            )}{" "}
            Numbers can be words: “split at three seconds” works.
          </p>
          <div className="voice-groups">
            {VOICE_GROUPS.map((g) => (
              <div key={g.title}>
                <h4>{g.title}</h4>
                <ul>
                  {g.items.map((i) => (
                    <li key={i}>
                      <code>{i}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3>Keyboard</h3>
          <table className="keys">
            <tbody>
              {KEYS.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Links other apps can open</h3>
          <p className="hint">
            <code>lahlahvideo://command?text=split%20here</code> runs a command.
            <br />
            <code>lahlahvideo://open?file=/path/to/lahlah-edit.json</code> opens a project or hand-off.
          </p>
        </section>
      </div>
    </Modal>
  );
}
