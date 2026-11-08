import { useEffect, useRef, useState } from "react";
import { setUI } from "../lib/store";
import { runText } from "../commands/execute";
import { EXAMPLES } from "../commands/parse";
import { isMac } from "../lib/platform";
import { Icon } from "./ui";

const HISTORY_KEY = "lahlah.cmdHistory";

/** Web Speech API where the WebView offers it (Chromium-based WebView2 sometimes; WKWebView no). */
function speechCtor(): any {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function CommandBar() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState("");
  const [auto, setAuto] = useState(() => localStorage.getItem("lahlah.autoRun") !== "0");
  const [history, setHistory] = useState<string[]>(() => JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"));
  const input = useRef<HTMLInputElement>(null);
  const dictated = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => input.current?.focus(), []);

  const run = (value = text) => {
    const v = value.trim();
    if (!v) return;
    const r = runText(v);
    setResult(r);
    if (r.ok) {
      const h = [v, ...history.filter((x) => x !== v)].slice(0, 6);
      setHistory(h);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
      setText("");
    }
    dictated.current = false;
  };

  // Dictation (LahLah Voice, Win+H) arrives in bursts; run it after a short pause.
  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    const ne = e.nativeEvent as InputEvent;
    const added = (ne.data ?? "").length;
    if (ne.inputType === "insertFromPaste" || ne.inputType === "insertReplacementText" || added > 3) dictated.current = true;
    clearTimeout(timer.current);
    if (auto && dictated.current) timer.current = setTimeout(() => run((e.target as HTMLInputElement).value), 1100);
  };

  const mic = () => {
    const Ctor = speechCtor();
    if (!Ctor) {
      setMicNote(
        isMac
          ? "On Mac, click in the box above and dictate with LahLah Voice (or press Fn twice for Apple Dictation). With LahLah Voice you can also just say “Video, split here” from anywhere."
          : "On Windows, click in the box above and press Win + H to dictate. Say the command, then pause.",
      );
      input.current?.focus();
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = navigator.language || "en-SG";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (ev: any) => {
        const said = ev.results?.[0]?.[0]?.transcript ?? "";
        setText(said);
        run(said);
      };
      rec.onerror = (ev: any) => {
        setMicNote(`The built-in speech service is not available here (${ev.error}). ${isMac ? "Use LahLah Voice or Apple Dictation instead." : "Press Win + H in the box instead."}`);
        setListening(false);
      };
      rec.onend = () => setListening(false);
      rec.start();
      setListening(true);
      setMicNote("Listening… say a command.");
    } catch {
      setMicNote(isMac ? "Use LahLah Voice or Apple Dictation in the box above." : "Press Win + H in the box above.");
    }
  };

  const q = text.toLowerCase();
  const suggestions = (q ? EXAMPLES.filter((e) => e.includes(q.split(" ")[0])) : history.length ? history : EXAMPLES).slice(0, 6);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setUI({ commandOpen: false })}>
      <div className="cmdbar" role="dialog" aria-label="Command bar">
        <div className="cmd-row">
          <Icon name="spark" size={20} />
          <input
            ref={input}
            value={text}
            placeholder="Try: split at 3 seconds · add crossfade · export for TikTok"
            onChange={(e) => setText(e.target.value)}
            onInput={onInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
              if (e.key === "Escape") setUI({ commandOpen: false });
            }}
          />
          <button type="button" className={`mic ${listening ? "on" : ""}`} title="Speak a command" onClick={mic}>
            <Icon name="mic" size={20} />
          </button>
        </div>
        {result && <div className={`cmd-result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
        {micNote && <div className="cmd-note">{micNote}</div>}
        <div className="cmd-suggest">
          <span className="muted-label">{q ? "Did you mean" : history.length ? "Recent" : "Try"}</span>
          {suggestions.map((s) => (
            <button type="button" key={s} onClick={() => run(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="cmd-foot">
          <label className="check">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                localStorage.setItem("lahlah.autoRun", e.target.checked ? "1" : "0");
              }}
            />
            Run dictated commands without pressing Enter
          </label>
          <button type="button" className="linkish" onClick={() => setUI({ commandOpen: false, helpOpen: true })}>
            All commands
          </button>
        </div>
      </div>
    </div>
  );
}
