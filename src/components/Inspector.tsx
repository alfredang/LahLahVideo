import { useEffect, useState } from "react";
import { apply, clock, InspectorTab, setUI, useClock, useStore } from "../lib/store";
import { toggleVoiceOver } from "../lib/recorder";
import { ASPECTS, AspectId, Clip, Project, TRANSITIONS, TransitionType } from "../lib/types";
import {
  clamp,
  interpolateKeyframes,
  LOOKS,
  setAspect,
  setSpeed,
  TEXT_PRESETS,
  TEXT_PRESET_LABELS,
  trackOf,
  updateClip,
  upsertKeyframe,
  VisualState,
} from "../lib/project";
import { Btn, Modal, Seg, Slider } from "./ui";

type Tab = InspectorTab;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => `${v.toFixed(1)}s`;

export function Inspector() {
  const p = useStore((s) => s.project);
  const selectedId = useStore((s) => s.ui.selectedId);
  const c = p.clips.find((x) => x.id === selectedId);
  if (!c) return <ProjectSettings p={p} />;
  return <ClipInspector key={c.id} p={p} c={c} />;
}

function ClipInspector({ p, c }: { p: Project; c: Clip }) {
  const isVisual = c.type !== "audio";
  const isMedia = c.type === "video" || c.type === "image";
  const hasSound = c.type === "audio" || (c.type === "video" && p.media.find((m) => m.id === c.mediaId)?.hasAudio !== false);
  const isMain = trackOf(p, c)?.type === "main";
  const tabs: { id: Tab; label: string }[] = [
    ...(c.type === "text" ? [{ id: "text" as Tab, label: "Text" }] : []),
    ...(isVisual ? [{ id: "video" as Tab, label: c.type === "video" || c.type === "image" ? "Video" : "Basic" }] : []),
    ...(hasSound ? [{ id: "audio" as Tab, label: "Audio" }] : []),
    ...(c.type === "video" || c.type === "audio" ? [{ id: "speed" as Tab, label: "Speed" }] : []),
    { id: "animation", label: "Animation" },
    ...(isMedia ? [{ id: "adjust" as Tab, label: "Adjust" }] : []),
  ];
  const request = useStore((s) => s.ui.inspectorTab);
  const section = useStore((s) => s.ui.inspectorSection);
  const [tab, setTab] = useState<Tab>(request && tabs.some((x) => x.id === request) ? request : tabs[0].id);
  useEffect(() => {
    if (request && tabs.some((x) => x.id === request)) setTab(request);
    if (request) setUI({ inspectorTab: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  const t = useClock((x) => x.t);
  const local = clamp(t - c.start, 0, c.duration);
  const vs = interpolateKeyframes(c, local);
  const m = p.media.find((x) => x.id === c.mediaId);
  const key = (k: string) => `${c.id}-${k}`;
  const upd = (patch: Partial<Clip> | ((x: Clip) => Partial<Clip>), k: string) => apply((q) => updateClip(q, c.id, patch), key(k));

  const hasKf = (prop: keyof VisualState) => (c.keyframes ?? []).some((k) => k[prop] !== undefined);
  const setVis = (prop: keyof VisualState, v: number) => {
    if (hasKf(prop)) upd((x) => ({ keyframes: upsertKeyframe(x, clock.get().t - x.start, { [prop]: v }) }), prop);
    else upd((x) => ({ transform: { ...x.transform, [prop]: v } }), prop);
  };
  const kfToggle = (prop: keyof VisualState) => ({
    on: hasKf(prop),
    toggle: () => apply((q) => updateClip(q, c.id, (x) => ({ keyframes: upsertKeyframe(x, clock.get().t - x.start, { [prop]: interpolateKeyframes(x, clock.get().t - x.start)[prop] }) }))),
  });

  return (
    <div className="inspector panel">
      <div className="insp-title">
        <strong>{c.type === "text" ? "Text" : c.type === "sticker" ? `Sticker ${c.sticker}` : (c.label ?? m?.name ?? "Clip")}</strong>
        <span className="muted-label">
          {secs(c.duration)} on {trackOf(p, c)?.name}
        </span>
      </div>
      <div className="insp-tabs">
        {tabs.map((x) => (
          <button type="button" key={x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="insp-body">
        {tab === "text" && c.text && <TextEditor c={c} upd={upd} />}

        {tab === "video" && (
          <>
            <Slider label="Left / right" value={vs.x} min={-1} max={1} onChange={(v) => setVis("x", v)} format={pct} reset={0} keyframe={kfToggle("x")} tip="Or drag the clip on the preview" />
            <Slider label="Up / down" value={vs.y} min={-1} max={1} onChange={(v) => setVis("y", v)} format={pct} reset={0} keyframe={kfToggle("y")} />
            <Slider label="Size" value={vs.scale} min={0.1} max={4} onChange={(v) => setVis("scale", v)} format={pct} reset={1} keyframe={kfToggle("scale")} />
            <Slider label="Rotate" value={c.transform.rotation} min={-180} max={180} step={1} onChange={(v) => upd((x) => ({ transform: { ...x.transform, rotation: v } }), "rot")} format={(v) => `${Math.round(v)}°`} reset={0} />
            <Slider label="Opacity" value={vs.opacity} min={0} max={1} onChange={(v) => setVis("opacity", v)} format={pct} reset={1} keyframe={kfToggle("opacity")} />
            <div className="row">
              <Btn label="Flip ↔" tip="Mirror left to right" active={c.transform.flipH} onClick={() => upd((x) => ({ transform: { ...x.transform, flipH: !x.transform.flipH } }), "flipH")} />
              <Btn label="Flip ↕" tip="Flip upside down" active={c.transform.flipV} onClick={() => upd((x) => ({ transform: { ...x.transform, flipV: !x.transform.flipV } }), "flipV")} />
              <Btn label="Reset" tip="Back to centred, full size" onClick={() => apply((q) => updateClip(q, c.id, (x) => ({ keyframes: [], transform: { ...x.transform, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, crop: { l: 0, t: 0, r: 0, b: 0 } } })))} />
            </div>
            {isMedia && (
              <details className="crop" open={section === "crop" || undefined}>
                <summary>Crop</summary>
                {(["l", "r", "t", "b"] as const).map((side) => (
                  <Slider
                    key={side}
                    label={{ l: "Left", r: "Right", t: "Top", b: "Bottom" }[side]}
                    value={c.transform.crop[side]}
                    min={0}
                    max={0.45}
                    onChange={(v) => upd((x) => ({ transform: { ...x.transform, crop: { ...x.transform.crop, [side]: v } } }), `crop${side}`)}
                    format={pct}
                    reset={0}
                  />
                ))}
              </details>
            )}
            {isMain && <BackgroundPicker p={p} />}
          </>
        )}

        {tab === "speed" && (
          <>
            <Slider label="Speed" value={c.speed} min={0.25} max={4} step={0.05} onChange={(v) => apply((q) => setSpeed(q, c.id, v), key("speed"))} format={(v) => `${v.toFixed(2)}x`} reset={1} />
            <div className="row wrap">
              {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
                <Btn key={s} label={`${s}x`} active={c.speed === s} onClick={() => apply((q) => setSpeed(q, c.id, s))} />
              ))}
            </div>
            <p className="hint">Faster clips get shorter on the timeline. Voices keep their pitch.</p>
          </>
        )}

        {tab === "audio" && (
          <>
            <Slider label="Volume" value={c.volume} min={0} max={2} onChange={(v) => upd({ volume: v, muted: false }, "vol")} format={pct} reset={1} />
            <div className="row">
              <Btn icon={c.muted ? "mute" : "volume"} label={c.muted ? "Muted" : "Mute"} active={c.muted} onClick={() => upd({ muted: !c.muted }, "mute")} />
            </div>
            {c.type === "audio" && (
              <>
                <span className="field-label">This sound is</span>
                <Seg
                  value={c.audioRole ?? "sfx"}
                  options={[
                    { id: "music", label: "Music", tip: "Ducks under voice-over" },
                    { id: "vo", label: "Voice-over", tip: "Music ducks under this" },
                    { id: "sfx", label: "Sound effect" },
                  ]}
                  onChange={(v) => upd({ audioRole: v }, "role")}
                />
              </>
            )}
            <Slider label="Fade in" value={c.fadeIn} min={0} max={Math.min(5, c.duration / 2)} onChange={(v) => upd({ fadeIn: v }, "fi")} format={secs} reset={0} />
            <Slider label="Fade out" value={c.fadeOut} min={0} max={Math.min(5, c.duration / 2)} onChange={(v) => upd({ fadeOut: v }, "fo")} format={secs} reset={0} />
            <h4>Voice-over</h4>
            <Btn icon="mic" label="Record voice-over" tip="Records from your microphone from the playhead (R)" onClick={toggleVoiceOver} className="wide" />
          </>
        )}

        {tab === "animation" && (
          <>
            <Slider label="Fade in" value={c.fadeIn} min={0} max={Math.min(5, c.duration / 2)} onChange={(v) => upd({ fadeIn: v }, "fi")} format={secs} reset={0} />
            <Slider label="Fade out" value={c.fadeOut} min={0} max={Math.min(5, c.duration / 2)} onChange={(v) => upd({ fadeOut: v }, "fo")} format={secs} reset={0} />
            {isVisual && (
              <>
                <h4>Keyframes</h4>
                <p className="hint">Park the playhead, press ◆ next to Left/right, Up/down, Size or Opacity on the Position tab, then move the playhead and change the value. LahLah animates between them.</p>
                <div className="row wrap">
                  <Btn label="Ken Burns zoom" tip="Slow zoom from 100% to 115% across the clip" onClick={() => apply((q) => updateClip(q, c.id, { keyframes: [{ t: 0, scale: 1 }, { t: c.duration, scale: 1.15 }] }))} />
                  <Btn label="Pop in" tip="Grow from 60% with a fade in the first half second" onClick={() => apply((q) => updateClip(q, c.id, (x) => ({ keyframes: [{ t: 0, scale: x.transform.scale * 0.6, opacity: 0 }, { t: Math.min(0.5, c.duration), scale: x.transform.scale, opacity: 1 }] })))} />
                  <Btn label="Slide up" tip="Rise into place over half a second" onClick={() => apply((q) => updateClip(q, c.id, (x) => ({ keyframes: [{ t: 0, y: x.transform.y + 0.15, opacity: 0 }, { t: Math.min(0.5, c.duration), y: x.transform.y, opacity: 1 }] })))} />
                  <Btn label="Clear" kind="danger" disabled={!c.keyframes?.length} onClick={() => apply((q) => updateClip(q, c.id, { keyframes: [] }))} />
                </div>
                <ul className="kf-list">
                  {(c.keyframes ?? []).map((k, i) => (
                    <li key={i}>
                      <button type="button" className="linkish" onClick={() => clock.set({ ...clock.get(), t: c.start + k.t })}>
                        ◆ {k.t.toFixed(2)}s
                      </button>
                      <span>
                        {(["x", "y", "scale", "opacity"] as const)
                          .filter((pr) => k[pr] !== undefined)
                          .map((pr) => `${pr} ${pr === "scale" || pr === "opacity" ? pct(k[pr]!) : k[pr]!.toFixed(2)}`)
                          .join(" · ")}
                      </span>
                      <button type="button" className="mini" title="Delete keyframe" onClick={() => apply((q) => updateClip(q, c.id, (x) => ({ keyframes: (x.keyframes ?? []).filter((_, j) => j !== i) })))}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {tab === "adjust" && (
          <>
            <div className="looks">
              {LOOKS.map((l) => (
                <button type="button" key={l.id} className={`look ${c.adjust.look === l.id || (!c.adjust.look && l.id === "none") ? "on" : ""}`} onClick={() => apply((q) => updateClip(q, c.id, (x) => ({ adjust: { ...x.adjust, ...l.adjust, look: l.id } })))}>
                  <span className="swatch" style={{ background: l.swatch }} />
                  {l.name}
                </button>
              ))}
            </div>
            <Slider label="Brightness" value={c.adjust.brightness} min={-0.5} max={0.5} onChange={(v) => upd((x) => ({ adjust: { ...x.adjust, brightness: v } }), "br")} format={(v) => (v > 0 ? "+" : "") + Math.round(v * 100)} reset={0} />
            <Slider label="Contrast" value={c.adjust.contrast} min={0.5} max={1.8} onChange={(v) => upd((x) => ({ adjust: { ...x.adjust, contrast: v } }), "ct")} format={pct} reset={1} />
            <Slider label="Saturation" value={c.adjust.saturation} min={0} max={2.5} onChange={(v) => upd((x) => ({ adjust: { ...x.adjust, saturation: v } }), "sat")} format={pct} reset={1} />
            <Slider label="Temperature" value={c.adjust.temperature} min={-1} max={1} onChange={(v) => upd((x) => ({ adjust: { ...x.adjust, temperature: v } }), "temp")} format={(v) => (v > 0 ? "Warm " : v < 0 ? "Cool " : "") + Math.round(Math.abs(v) * 100)} reset={0} />
            <Slider label="Vignette" value={c.adjust.vignette} min={0} max={1} onChange={(v) => upd((x) => ({ adjust: { ...x.adjust, vignette: v } }), "vig")} format={pct} reset={0} />
          </>
        )}

      </div>
    </div>
  );
}

function TextEditor({ c, upd }: { c: Clip; upd: (patch: Partial<Clip> | ((x: Clip) => Partial<Clip>), k: string) => void }) {
  const s = c.text!;
  const set = (patch: Partial<typeof s>, k: string) => upd((x) => ({ text: { ...x.text!, ...patch } }), k);
  return (
    <>
      <textarea className="text-input" value={s.content} rows={3} onChange={(e) => set({ content: e.target.value }, "content")} placeholder="Type your text" />
      <span className="field-label">Style</span>
      <div className="presets">
        {Object.keys(TEXT_PRESETS).map((id) => (
          <button type="button" key={id} className={s.preset === id ? "on" : ""} onClick={() => set({ ...TEXT_PRESETS[id], preset: id }, "preset")}>
            {TEXT_PRESET_LABELS[id]}
          </button>
        ))}
      </div>
      <Slider label="Text size" value={s.size} min={24} max={220} step={1} onChange={(v) => set({ size: v }, "size")} format={(v) => `${Math.round(v)}`} />
      <div className="row colours">
        <label title="Text colour">
          Text <input type="color" value={s.color.slice(0, 7)} onChange={(e) => set({ color: e.target.value }, "color")} />
        </label>
        <label title="Outline colour">
          Outline <input type="checkbox" checked={!!s.stroke} onChange={(e) => set({ stroke: e.target.checked ? "#000000" : undefined }, "strokeOn")} />
          {s.stroke && <input type="color" value={s.stroke.slice(0, 7)} onChange={(e) => set({ stroke: e.target.value }, "stroke")} />}
        </label>
        <label title="Box behind the text">
          Box <input type="checkbox" checked={!!s.bg} onChange={(e) => set({ bg: e.target.checked ? "#000000b3" : undefined }, "bgOn")} />
          {s.bg && <input type="color" value={s.bg.slice(0, 7)} onChange={(e) => set({ bg: e.target.value + "cc" }, "bg")} />}
        </label>
      </div>
      <div className="row">
        <Btn label="B" tip="Bold" active={s.bold} onClick={() => set({ bold: !s.bold }, "bold")} />
        <Btn label="I" tip="Italic" active={!!s.italic} onClick={() => set({ italic: !s.italic }, "italic")} />
        <Seg value={s.align} options={[{ id: "left", label: "Left" }, { id: "center", label: "Centre" }, { id: "right", label: "Right" }]} onChange={(v) => set({ align: v }, "align")} />
      </div>
      <span className="field-label">Font</span>
      <select value={s.font} onChange={(e) => set({ font: e.target.value }, "font")}>
        {["Inter, Arial, sans-serif", "Arial Black, Arial, sans-serif", "Georgia, serif", "Trebuchet MS, Arial, sans-serif", "Courier New, monospace", "Impact, Arial Black, sans-serif", "Comic Sans MS, Comic Sans, cursive"].map((f) => (
          <option key={f} value={f}>
            {f.split(",")[0]}
          </option>
        ))}
      </select>
    </>
  );
}

export const TRANSITION_INFO: Record<TransitionType, { label: string; tip: string; icon: string }> = {
  cut: { label: "Cut", tip: "Straight cut, no effect", icon: "▮▮" },
  crossfade: { label: "Crossfade", tip: "One shot melts into the next", icon: "◐" },
  slide: { label: "Slide", tip: "Next shot pushes in from the right", icon: "⇠" },
  zoom: { label: "Zoom", tip: "Punch in, then reveal the next shot", icon: "⊕" },
  wipe: { label: "Wipe", tip: "A hard edge sweeps across", icon: "▧" },
  dip: { label: "Dip to black", tip: "Fade out to black, then fade in", icon: "●" },
};

export function TransitionGrid({ value, onPick }: { value: TransitionType; onPick: (t: TransitionType) => void }) {
  return (
    <div className="trans-grid">
      {TRANSITIONS.map((t) => (
        <button type="button" key={t} className={value === t ? "on" : ""} title={TRANSITION_INFO[t].tip} onClick={() => onPick(t)}>
          <span className="trans-icon">{TRANSITION_INFO[t].icon}</span>
          {TRANSITION_INFO[t].label}
        </button>
      ))}
    </div>
  );
}

function ProjectSettings({ p }: { p: Project }) {
  const path = useStore((s) => s.ui.projectPath);
  const open = useStore((s) => s.ui.detailsOpen);
  const { w, h } = ASPECTS[p.aspect];
  const rows: [string, string][] = [
    ["Name", p.name],
    ["Saved location", path ?? "Not saved yet (auto-saved in the app)"],
    ["Import material", `${p.media.length} file${p.media.length === 1 ? "" : "s"}`],
    ["Ratio", `${p.aspect} (${ASPECTS[p.aspect].hint})`],
    ["Resolution", `${w} × ${h}, export up to 4K`],
    ["Frame rate", `${p.fps} fps`],
    ["Background", p.background.type === "blur" ? "Blurred clip" : `Colour ${p.background.color}`],
    ["Music ducking", p.ducking ? "On under voice-over" : "Off"],
  ];
  if (p.higgsfield?.name) rows.push(["Higgsfield project", p.higgsfield.name]);
  return (
    <div className="inspector panel">
      <div className="panel-head">
        <span>Details</span>
      </div>
      <div className="insp-body details">
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd title={v}>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">Select a clip on the timeline to edit it here.</p>
        <div className="details-foot">
          <Btn label="Modify" onClick={() => setUI({ detailsOpen: true })} tip="Change the name, ratio, frame rate and background" />
        </div>
      </div>
      {open && <DetailsModal p={p} />}
    </div>
  );
}

function DetailsModal({ p }: { p: Project }) {
  return (
    <Modal title="Project details" onClose={() => setUI({ detailsOpen: false })}>
      <span className="field-label">Video name</span>
      <input className="text-field" value={p.name} onChange={(e) => apply((q) => ({ ...q, name: e.target.value }), "name")} />
      <span className="field-label">Ratio</span>
      <Seg value={p.aspect} options={(Object.keys(ASPECTS) as AspectId[]).map((id) => ({ id, label: id, tip: ASPECTS[id].hint }))} onChange={(a) => apply((q) => setAspect(q, a))} />
      <span className="field-label">Frame rate</span>
      <Seg value={String(p.fps)} options={["24", "30", "60"].map((f) => ({ id: f, label: `${f} fps` }))} onChange={(v) => apply((q) => ({ ...q, fps: Number(v) }))} />
      <BackgroundPicker p={p} />
      <label className="check" title="Lower the music automatically while a voice-over plays">
        <input type="checkbox" checked={p.ducking} onChange={(e) => apply((q) => ({ ...q, ducking: e.target.checked }))} /> Duck music under voice-over
      </label>
      <div className="row">
        <Btn kind="primary" label="Done" onClick={() => setUI({ detailsOpen: false })} />
      </div>
    </Modal>
  );
}

function BackgroundPicker({ p }: { p: Project }) {
  return (
    <>
      <span className="field-label">Canvas background (all clips)</span>
      <div className="row">
        <Seg<"blur" | "color">
          value={p.background.type}
          options={[
            { id: "blur", label: "Blur", tip: "A blurred copy of the clip fills the edges" },
            { id: "color", label: "Colour", tip: "A solid colour fills the edges" },
          ]}
          onChange={(type) => apply((q) => ({ ...q, background: { ...q.background, type } }))}
        />
        {p.background.type === "color" && (
          <input type="color" value={p.background.color} title="Background colour" onChange={(e) => apply((q) => ({ ...q, background: { ...q.background, color: e.target.value } }), "bg-color")} />
        )}
      </div>
    </>
  );
}
