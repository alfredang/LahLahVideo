import { useLayoutEffect, useState } from "react";

const KEY = "lahlah.coachDone";
const STEPS = [
  { target: '[data-coach="import"], [data-coach="media"]', title: "Start here", text: "Import your clips, or open Claude's lahlah-edit.json under From Claude / Higgsfield." },
  { target: '[data-coach="timeline"]', title: "Edit on the timeline", text: "Drag clips to reorder, drag an edge to trim, press S to split at the playhead." },
  { target: ".export-btn", title: "Finished?", text: "Export an MP4 for TikTok or YouTube. Or press Cmd/Ctrl+K and type “export for TikTok”." },
];

/** Three first-run bubbles instead of a help panel. Shown once; ?coach=1 shows them again. */
export function CoachMarks() {
  const [step, setStep] = useState(() => {
    const qs = new URLSearchParams(location.search);
    if (qs.get("coach") === "0") return -1;
    if (qs.get("coach") === "1") return 0;
    return localStorage.getItem(KEY) ? -1 : 0;
  });
  const [box, setBox] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (step < 0) return;
    const find = () => {
      const el = STEPS[step].target.split(",").map((sel) => document.querySelector(sel.trim())).find(Boolean);
      setBox(el?.getBoundingClientRect() ?? null);
    };
    find();
    window.addEventListener("resize", find);
    return () => window.removeEventListener("resize", find);
  }, [step]);
  if (step < 0 || !box) return null;
  const done = () => {
    localStorage.setItem(KEY, "1");
    setStep(-1);
  };
  const s = STEPS[step];
  const below = box.top < window.innerHeight / 2;
  const left = Math.min(Math.max(12, box.left + box.width / 2 - 150), window.innerWidth - 312);
  const style = below ? { top: box.bottom + 12, left } : { top: Math.max(12, box.top - 150), left };
  return (
    <>
      <div className="coach-ring" style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }} />
      <div className={`coach ${below ? "below" : "above"}`} style={style} role="dialog" aria-label={s.title}>
        <b>{s.title}</b>
        <p>{s.text}</p>
        <div className="coach-foot">
          <span>
            {step + 1} of {STEPS.length}
          </span>
          <button type="button" className="linkish" onClick={done}>
            Skip
          </button>
          <button type="button" className="btn primary" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : done())}>
            {step + 1 < STEPS.length ? "Next" : "Got it"}
          </button>
        </div>
      </div>
    </>
  );
}
