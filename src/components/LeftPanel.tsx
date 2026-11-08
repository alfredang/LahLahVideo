import { useState } from "react";
import { apply, clock, LeftTab, project, setUI, store, useStore } from "../lib/store";
import { MediaItem, TransitionType } from "../lib/types";
import {
  addCaption,
  addSticker,
  addText,
  clipsOnTrack,
  fmtTime,
  LOOKS,
  mainTrack,
  removeClips,
  setTransition,
  STICKERS,
  TEXT_PRESET_LABELS,
  TEXT_PRESETS,
  touch,
  trackAccepts,
  trackOf,
  updateClip,
} from "../lib/project";
import { addMusic, addToTimeline, clearCaptions, exportSrt, importDialog, importSrt, importUrls, openDialog, targetClip } from "../actions";
import { toggleVoiceOver, useRecorder } from "../lib/recorder";
import { isDesktop, openExternal, pickFolder, reveal } from "../lib/platform";
import { autoCaptions, capcutHandover } from "../export/run";
import { toast } from "../lib/toast";
import { captionsOf } from "../lib/handoff";
import { Btn, Icon } from "./ui";
import { TransitionGrid } from "./Inspector";

const TABS: { id: LeftTab; label: string; icon: string; tip: string }[] = [
  { id: "media", label: "Media", icon: "media", tip: "Your imported videos, photos and audio" },
  { id: "higgsfield", label: "Higgsfield", icon: "link", tip: "Bring in Higgsfield clips or a Claude hand-off file" },
  { id: "audio", label: "Audio", icon: "music", tip: "Music, sound effects and voice-over" },
  { id: "text", label: "Text", icon: "text", tip: "Titles and labels" },
  { id: "stickers", label: "Stickers", icon: "sticker", tip: "Emoji stickers" },
  { id: "transitions", label: "Transitions", icon: "transition", tip: "Effects between clips" },
  { id: "filters", label: "Filters", icon: "filter", tip: "Colour looks" },
  { id: "captions", label: "Captions", icon: "captions", tip: "Subtitles and SRT files" },
];

export function LeftPanel() {
  const tab = useStore((s) => s.ui.leftTab);
  return (
    <aside className="left">
      <nav className="left-tabs">
        {TABS.map((t) => (
          <button type="button" key={t.id} className={tab === t.id ? "on" : ""} title={t.tip} onClick={() => setUI({ leftTab: t.id })}>
            <Icon name={t.icon} size={20} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="left-body">
        {tab === "media" && <MediaTab />}
        {tab === "higgsfield" && <HiggsfieldTab />}
        {tab === "audio" && <AudioTab />}
        {tab === "text" && <TextTab />}
        {tab === "stickers" && <StickerTab />}
        {tab === "transitions" && <TransitionsTab />}
        {tab === "filters" && <FiltersTab />}
        {tab === "captions" && <CaptionsTab />}
      </div>
    </aside>
  );
}

/**
 * Drag a media card onto a timeline track. Pointer events rather than HTML5 drag-and-drop,
 * because the desktop window's file-drop handler blocks HTML5 drags on Windows.
 */
function startMediaDrag(e: React.PointerEvent, m: MediaItem) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;
  const move = (ev: PointerEvent) => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!ghost) {
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = m.name;
      document.body.appendChild(ghost);
    }
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 8}px`;
    document.querySelectorAll(".tl-lane.drop-target").forEach((el) => el.classList.remove("drop-target"));
    (document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-track]") as HTMLElement | null)?.classList.add("drop-target");
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.querySelectorAll(".tl-lane.drop-target").forEach((el) => el.classList.remove("drop-target"));
    if (!ghost) return;
    ghost.remove();
    const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-track]") as HTMLElement | null;
    if (!lane) return;
    const p = project();
    const track = p.tracks.find((t) => t.id === lane.dataset.track);
    const kind = m.kind === "audio" ? "audio" : m.kind === "image" ? "image" : "video";
    const at = Math.max(0, (ev.clientX - lane.getBoundingClientRect().left) / store.get().ui.zoom);
    addToTimeline(m.id, track && trackAccepts(track.type, kind) ? track.id : undefined, at);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function MediaCard({ m }: { m: MediaItem }) {
  const used = useStore((s) => s.project.clips.some((c) => c.mediaId === m.id));
  return (
    <div
      className="media-card"
      onPointerDown={(e) => startMediaDrag(e, m)}
      onDoubleClick={() => addToTimeline(m.id)}
      title={`${m.name}\nDrag onto the timeline, or double-click to add at the end`}
    >
      <div className={`media-thumb ${m.kind}`} style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
        {!m.thumb && <Icon name={m.kind === "audio" ? "music" : "media"} size={28} />}
        {m.kind !== "image" && <span className="dur">{fmtTime(m.duration)}</span>}
        {m.origin === "higgsfield" || m.origin === "handoff" ? <span className="badge">HF</span> : null}
        {used && <span className="used" title="On the timeline">✓</span>}
      </div>
      <div className="media-name">{m.name}</div>
      <div className="media-actions">
        <button type="button" className="mini add" title="Add to timeline" onClick={() => addToTimeline(m.id)}>
          <Icon name="plus" size={14} />
        </button>
        <button
          type="button"
          className="mini"
          title={used ? "Remove its clips from the timeline first" : "Remove from project"}
          disabled={used}
          onClick={() => apply((p) => touch({ ...p, media: p.media.filter((x) => x.id !== m.id) }))}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

function MediaTab() {
  const media = useStore((s) => s.project.media);
  return (
    <div className="tab">
      <Btn big kind="primary" icon="import" label="Import media" onClick={() => importDialog()} className="wide" />
      <p className="hint">Drag files onto the window, or click Import. Then drag a card onto a timeline track, or double-click it.</p>
      {media.length === 0 ? (
        <div className="empty-hint">No media yet. Videos, photos and music you import show up here.</div>
      ) : (
        <div className="media-grid">
          {media.map((m) => (
            <MediaCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function HiggsfieldTab() {
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState("");
  const hf = useStore((s) => s.project.higgsfield);
  return (
    <div className="tab">
      <div className="flow">
        <span>Claude plans</span>→<span>Higgsfield films</span>→<span className="here">LahLah edits</span>→<span>TikTok / YouTube</span>
      </div>
      <h3>1 · Paste clip links</h3>
      <p className="hint">In Higgsfield, open each finished shot, copy its download link, and paste them here in order. One per line.</p>
      <textarea className="text-input" rows={4} placeholder="https://…/S01-SH01.mp4" value={links} onChange={(e) => setLinks(e.target.value)} />
      <Btn
        kind="primary"
        icon="import"
        label={busy === "links" ? "Fetching…" : "Fetch clips to timeline"}
        disabled={!!busy || !links.trim()}
        className="wide"
        onClick={async () => {
          setBusy("links");
          try {
            if ((await importUrls(links)) > 0) setLinks("");
          } finally {
            setBusy("");
          }
        }}
      />
      <h3>2 · Or open Claude's hand-off file</h3>
      <p className="hint">
        Claude's <code>higgsfield-video</code> skill writes <code>lahlah-edit.json</code>. Open it and LahLah lays out every shot in order, with transitions, captions and music, on the right canvas.
      </p>
      <Btn icon="folder" label="Open lahlah-edit.json" className="wide" onClick={openDialog} />
      <h3>3 · Prefer CapCut?</h3>
      <p className="hint">Exports trimmed clips (numbered in order), captions.srt and a how-to into one folder you can drag into CapCut.</p>
      <Btn
        icon="export"
        label={busy === "capcut" ? "Preparing…" : "Open in CapCut instead"}
        className="wide"
        disabled={!!busy || !isDesktop}
        tip={isDesktop ? "Pick a folder for the CapCut hand-over" : "Needs the desktop app"}
        onClick={async () => {
          const parent = await pickFolder("Where should the CapCut folder go?");
          if (!parent) return;
          setBusy("capcut");
          try {
            const dir = await capcutHandover(project(), parent, (m) => toast(m));
            toast("CapCut folder ready", "ok");
            await reveal(dir);
          } catch (e) {
            toast((e as Error).message, "error", 7000);
          } finally {
            setBusy("");
          }
        }}
      />
      <div className="row">
        <Btn label="Open Higgsfield" icon="link" kind="ghost" onClick={() => openExternal(hf?.url || "https://higgsfield.ai/")} />
      </div>
    </div>
  );
}

function AudioTab() {
  const media = useStore((s) => s.project.media.filter((m) => m.kind === "audio"));
  const rec = useRecorder();
  return (
    <div className="tab">
      <Btn big kind="primary" icon="music" label="Add music" tip="Pick a song; it lands on the Music track from 0:00" onClick={addMusic} className="wide" />
      <Btn big icon="mic" label={rec.recording ? "Stop recording" : "Record voice-over"} kind={rec.recording ? "danger" : "plain"} tip="Records from your microphone while the video plays (R)" onClick={toggleVoiceOver} className="wide" />
      <Btn icon="import" label="Import sound effect" tip="Add a sound file to the Voice-over & SFX track" onClick={() => importDialog("audio", { toTimeline: true, trackId: project().tracks.filter((t) => t.type === "audio")[1]?.id })} className="wide" />
      <p className="hint">Music ducks (gets quieter) under voice-over when you export. Turn it off in Project settings.</p>
      <p className="hint">Use music you have the rights to: TikTok's and YouTube's own libraries, or royalty-free sites.</p>
      <div className="media-grid">
        {media.map((m) => (
          <MediaCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

function TextTab() {
  const [text, setText] = useState("");
  const add = (preset: string, content?: string) => {
    const r = addText(project(), content || text || TEXT_PRESET_LABELS[preset], { at: clock.get().t, preset, y: preset === "lowerthird" ? 0.3 : preset === "headline" ? -0.3 : 0 });
    if (preset === "lowerthird") r.clip.transform.x = -0.1;
    apply(() => r.project);
    setUI({ selectedId: r.clip.id });
    setText("");
  };
  return (
    <div className="tab">
      <input className="text-field" placeholder="Type text, then pick a style" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add("tiktok")} />
      <p className="hint">Text lands at the playhead for 3 seconds. Drag it on the preview to move it.</p>
      <div className="text-presets">
        {Object.entries(TEXT_PRESETS).map(([id, s]) => (
          <button
            type="button"
            key={id}
            onClick={() => add(id)}
            style={{
              fontFamily: s.font,
              color: s.color,
              background: s.bg ?? "#26262c",
              fontWeight: s.bold ? 800 : 500,
              WebkitTextStroke: s.stroke ? `1px ${s.stroke}` : undefined,
            }}
          >
            {TEXT_PRESET_LABELS[id]}
          </button>
        ))}
      </div>
    </div>
  );
}

function StickerTab() {
  return (
    <div className="tab">
      <p className="hint">Click to drop a sticker at the playhead. Drag it on the preview, resize it in Position.</p>
      <div className="sticker-grid">
        {STICKERS.map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => {
              const r = addSticker(project(), s, clock.get().t);
              apply(() => r.project);
              setUI({ selectedId: r.clip.id });
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function TransitionsTab() {
  const p = useStore((s) => s.project);
  const selectedId = useStore((s) => s.ui.selectedId);
  const main = clipsOnTrack(p, mainTrack(p).id);
  const sel = p.clips.find((c) => c.id === selectedId);
  const target = sel && trackOf(p, sel)?.type === "main" ? sel : null;
  const idx = target ? main.findIndex((c) => c.id === target.id) : -1;
  const applyAll = (type: TransitionType) => apply((q) => main.slice(1).reduce((acc, c) => setTransition(acc, c.id, type, 0.5), q));
  return (
    <div className="tab">
      {main.length < 2 ? (
        <div className="empty-hint">Transitions sit between clips. Put at least two clips on the main track.</div>
      ) : idx > 0 ? (
        <>
          <p className="hint">
            Between clip {idx} and clip {idx + 1}:
          </p>
          <TransitionGrid value={target!.transitionIn?.type ?? "cut"} onPick={(t) => apply((q) => setTransition(q, target!.id, t, target!.transitionIn?.duration ?? 0.5))} />
        </>
      ) : (
        <p className="hint">Click the small square between two clips on the timeline, or a clip after the first, then pick a transition.</p>
      )}
      {main.length >= 2 && (
        <>
          <h3>Same transition everywhere</h3>
          <TransitionGrid value={"cut"} onPick={applyAll} />
        </>
      )}
    </div>
  );
}

function FiltersTab() {
  const p = useStore((s) => s.project);
  const c = targetClip();
  const visual = c && (c.type === "video" || c.type === "image") ? c : null;
  const main = clipsOnTrack(p, mainTrack(p).id);
  return (
    <div className="tab">
      <p className="hint">{visual ? "Click a look to apply it to the selected clip. Fine-tune in Colour on the right." : "Select a video or photo clip first."}</p>
      <div className="looks big">
        {LOOKS.map((l) => (
          <button
            type="button"
            key={l.id}
            disabled={!visual}
            className={`look ${visual?.adjust.look === l.id ? "on" : ""}`}
            onClick={() => visual && apply((q) => updateClip(q, visual.id, (x) => ({ adjust: { ...x.adjust, ...l.adjust, look: l.id } })))}
          >
            <span className="swatch" style={{ background: l.swatch }} />
            {l.name}
          </button>
        ))}
      </div>
      {visual?.adjust.look && main.length > 1 && (
        <Btn
          label="Apply this look to every main clip"
          className="wide"
          onClick={() => {
            const look = LOOKS.find((l) => l.id === visual.adjust.look) ?? LOOKS[0];
            apply((q) => main.reduce((acc, m) => updateClip(acc, m.id, (x) => ({ adjust: { ...x.adjust, ...look.adjust, look: look.id } })), q));
          }}
        />
      )}
    </div>
  );
}

function CaptionsTab() {
  const p = useStore((s) => s.project);
  const caps = captionsOf(p);
  const capTrack = p.tracks.find((t) => t.type === "caption")!;
  const capClips = clipsOnTrack(p, capTrack.id);
  const [key, setKey] = useState(() => localStorage.getItem("lahlah.openaiKey") ?? "");
  const [busy, setBusy] = useState("");
  return (
    <div className="tab">
      <div className="row wrap">
        <Btn icon="plus" label="Add caption" tip="New caption at the playhead for 2 seconds" onClick={() => apply((q) => addCaption(q, clock.get().t, clock.get().t + 2, "New caption"))} />
        <Btn icon="import" label="Import SRT" onClick={importSrt} />
        <Btn icon="export" label="Export SRT" onClick={exportSrt} disabled={!caps.length} />
        <Btn icon="trash" label="Clear" kind="danger" disabled={!caps.length} onClick={clearCaptions} />
      </div>
      <ul className="cap-list">
        {capClips.map((c) => (
          <li key={c.id}>
            <button type="button" className="linkish" onClick={() => (clock.set({ ...clock.get(), t: c.start }), setUI({ selectedId: c.id }))}>
              {fmtTime(c.start)}
            </button>
            <input value={c.text?.content ?? ""} onChange={(e) => apply((q) => updateClip(q, c.id, (x) => ({ text: { ...x.text!, content: e.target.value } })), `cap-${c.id}`)} />
            <button type="button" className="mini" title="Delete caption" onClick={() => apply((q) => removeClips(q, [c.id]))}>
              <Icon name="x" size={13} />
            </button>
          </li>
        ))}
      </ul>
      <details className="auto-cap">
        <summary>
          <Icon name="wand" size={14} /> Auto-captions (optional)
        </summary>
        <p className="hint">
          Uses OpenAI Whisper with <b>your own</b> API key. LahLah sends the soundtrack only, and only when you click Generate. The key stays on this computer. Costs about US$0.006 per minute (OpenAI's price, check before use).
        </p>
        <input className="text-field" type="password" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => localStorage.setItem("lahlah.openaiKey", key)} />
        <Btn
          kind="primary"
          icon="wand"
          label={busy || "Generate captions"}
          disabled={!!busy || !key}
          className="wide"
          onClick={async () => {
            localStorage.setItem("lahlah.openaiKey", key);
            try {
              const next = await autoCaptions(project(), key, setBusy);
              apply(() => next);
              toast("Captions added. Edit any line in the list.", "ok");
            } catch (e) {
              toast((e as Error).message, "error", 8000);
            } finally {
              setBusy("");
            }
          }}
        />
        <p className="hint">No key? Type captions above, import an SRT, or let CapCut or TikTok auto-caption after export.</p>
      </details>
    </div>
  );
}
