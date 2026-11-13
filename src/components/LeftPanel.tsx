import { useRef, useState } from "react";
import { apply, clock, LeftTab, project, setUI, store, useStore } from "../lib/store";
import { AspectId, Clip, MediaItem, TransitionType } from "../lib/types";
import {
  addCaption,
  addMediaToTimeline,
  addSticker,
  newProject,
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
import { addAtPlayhead, addMusic, addToTimeline, clearCaptions, exportSrt, importDialog, importSrt, importUrls, newProjectAction, openDialog, targetClip } from "../actions";
import { buildDemoProject, libraryMusic } from "../lib/demo";
import { toggleVoiceOver, useRecorder } from "../lib/recorder";
import { isDesktop, openExternal, pickFolder, reveal } from "../lib/platform";
import { autoCaptions, capcutHandover } from "../export/run";
import { toast } from "../lib/toast";
import { captionsOf } from "../lib/handoff";
import { Btn, Icon, Slider } from "./ui";
import { TransitionGrid } from "./Inspector";

const TABS: { id: LeftTab; label: string; icon: string; tip: string }[] = [
  { id: "media", label: "Media", icon: "media", tip: "Import videos, photos and music, or bring in Claude and Higgsfield clips" },
  { id: "audio", label: "Audio", icon: "music", tip: "Music, sound effects and voice-over" },
  { id: "text", label: "Text", icon: "text", tip: "Titles and labels" },
  { id: "captions", label: "Captions", icon: "captions", tip: "Subtitles, SRT files and auto-captions" },
  { id: "stickers", label: "Stickers", icon: "sticker", tip: "Emoji stickers" },
  { id: "effects", label: "Effects", icon: "effects", tip: "Motion effects: zoom, pop in, slide, fades" },
  { id: "transitions", label: "Transitions", icon: "transition", tip: "Effects between two clips" },
  { id: "filters", label: "Filters", icon: "filter", tip: "Colour looks" },
  { id: "adjustment", label: "Adjustment", icon: "sliders", tip: "Brightness, contrast, saturation, temperature, vignette" },
  { id: "templates", label: "Templates", icon: "new", tip: "Start from a ready-made project" },
];

export function LeftPanel() {
  const tab = useStore((s) => s.ui.leftTab);
  const row = useRef<HTMLElement>(null);
  return (
    <aside className="left panel">
      <div className="left-tabs-wrap">
        <nav className="left-tabs" aria-label="Assets" ref={row}>
          {TABS.map((t) => (
            <button type="button" key={t.id} className={tab === t.id ? "on" : ""} title={t.tip} onClick={() => setUI({ leftTab: t.id })} data-coach={t.id === "media" ? "media" : undefined}>
              <Icon name={t.icon} size={19} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="tabs-more" title="More tabs" onClick={() => row.current?.scrollBy({ left: 160, behavior: "smooth" })}>
          <Icon name="chevronright" size={16} />
        </button>
      </div>
      <div className="left-body">
        {tab === "media" && <MediaTab />}
        {tab === "audio" && <AudioTab />}
        {tab === "text" && <TextTab />}
        {tab === "stickers" && <StickerTab />}
        {tab === "effects" && <EffectsTab />}
        {tab === "transitions" && <TransitionsTab />}
        {tab === "filters" && <FiltersTab />}
        {tab === "adjustment" && <AdjustmentTab />}
        {tab === "captions" && <CaptionsTab />}
        {tab === "templates" && <TemplatesTab />}
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

function MediaCard({ m, list }: { m: MediaItem; list?: boolean }) {
  const used = useStore((s) => s.project.clips.some((c) => c.mediaId === m.id));
  const [scrub, setScrub] = useState<number | null>(null);
  return (
    <div
      className={`media-card ${list ? "list" : ""}`}
      onPointerDown={(e) => startMediaDrag(e, m)}
      onDoubleClick={() => addToTimeline(m.id)}
      title={`${m.name}\nDrag onto the timeline, or click + to add it at the playhead`}
    >
      <div
        className={`media-thumb ${m.kind}`}
        style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setScrub(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        }}
        onPointerLeave={() => setScrub(null)}
      >
        {scrub !== null && m.kind === "video" && (
          <>
            <span className="scrub-line" style={{ left: `${scrub * 100}%` }} />
            <span className="scrub-time">{fmtTime(scrub * m.duration)}</span>
          </>
        )}
        {!m.thumb && <Icon name={m.kind === "audio" ? "music" : "media"} size={28} />}
        {m.kind !== "image" && <span className="dur">{fmtTime(m.duration)}</span>}
        {m.origin === "higgsfield" || m.origin === "handoff" ? <span className="badge">HF</span> : null}
        {used && <span className="used" title="On the timeline">✓</span>}
      </div>
      <div className="media-name">{m.name}</div>
      <button type="button" className="add-plus" title="Add to the timeline at the playhead" onClick={() => addAtPlayhead(m.id)}>
        <Icon name="plus" size={16} />
      </button>
      {!used && (
        <button type="button" className="remove-x" title="Remove from project" onClick={() => apply((p) => touch({ ...p, media: p.media.filter((x) => x.id !== m.id) }))}>
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}

function MediaTab() {
  const source = useStore((s) => s.ui.mediaSource);
  const [open, setOpen] = useState({ yours: true, claude: true, library: true });
  const nav = (id: "local" | "claude" | "library", label: string, tip: string) => (
    <button type="button" className={source === id ? "on" : ""} onClick={() => setUI({ mediaSource: id })} title={tip} data-coach={id === "claude" ? "claude" : undefined}>
      {label}
    </button>
  );
  return (
    <div className="media-tab">
      <nav className="subnav" aria-label="Media sources">
        <button type="button" className="group" onClick={() => setOpen({ ...open, yours: !open.yours })}>
          Yours <Icon name={open.yours ? "chevron" : "chevronright"} size={13} />
        </button>
        {open.yours && nav("local", "Import", "Videos, photos and music on this computer")}
        <button type="button" className="group" onClick={() => setOpen({ ...open, claude: !open.claude })}>
          Claude <Icon name={open.claude ? "chevron" : "chevronright"} size={13} />
        </button>
        {open.claude && nav("claude", "From Claude / Higgsfield", "Open Claude's lahlah-edit.json or paste Higgsfield links")}
        <button type="button" className="group" onClick={() => setOpen({ ...open, library: !open.library })}>
          Library <Icon name={open.library ? "chevron" : "chevronright"} size={13} />
        </button>
        {open.library && nav("library", "Built-in", "A demo project and a royalty-free music loop")}
      </nav>
      <div className="media-main">{source === "claude" ? <ClaudePanel /> : source === "library" ? <LibraryPanel /> : <YoursPanel />}</div>
    </div>
  );
}

function YoursPanel() {
  const media = useStore((s) => s.project.media);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"added" | "name" | "length">("added");
  const [kind, setKind] = useState<"all" | "video" | "image" | "audio">("all");
  if (!media.length) {
    return (
      <div className="media-empty">
        <button type="button" className="drop-zone" onClick={() => importDialog()} data-coach="import" title="Import videos, photos or music">
          <Icon name="plus" size={28} />
          <b>Import</b>
          <span>Drag and drop videos, photos and audio files here</span>
        </button>
        <p className="muted-label">No media yet? Start with these</p>
        <div className="create-tiles">
          <button type="button" onClick={openDialog} title="Open lahlah-edit.json from Claude's higgsfield-video skill">
            <Icon name="link" size={22} />
            <b>Open Claude hand-off</b>
            <small>lahlah-edit.json</small>
          </button>
          <button type="button" onClick={() => void toggleVoiceOver()} title="Record from your microphone (R)">
            <Icon name="mic" size={22} />
            <b>Record voice-over</b>
            <small>from your microphone</small>
          </button>
        </div>
      </div>
    );
  }
  let items = media.filter((m) => (kind === "all" || m.kind === kind) && m.name.toLowerCase().includes(q.toLowerCase()));
  if (sort === "name") items = [...items].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "length") items = [...items].sort((a, b) => b.duration - a.duration);
  return (
    <div className="yours">
      <div className="media-toolbar">
        <Btn icon="plus" label="Import" kind="primary" onClick={() => importDialog()} tip="Import videos, photos or music" />
        <label className="search" title="Search by file name">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search material" />
        </label>
        <button type="button" className="mini" title={view === "grid" ? "List view" : "Grid view"} onClick={() => setView(view === "grid" ? "list" : "grid")}>
          <Icon name={view === "grid" ? "list" : "grid"} size={16} />
        </button>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} title="Sort">
          <option value="added">Added</option>
          <option value="name">Name</option>
          <option value="length">Length</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} title="Show">
          <option value="all">All</option>
          <option value="video">Video</option>
          <option value="image">Photos</option>
          <option value="audio">Audio</option>
        </select>
      </div>
      <div className="crumb">All{kind !== "all" ? ` / ${kind}` : ""}</div>
      <div className={view === "grid" ? "media-grid" : "media-list"}>
        {items.map((m) => (
          <MediaCard key={m.id} m={m} list={view === "list"} />
        ))}
      </div>
    </div>
  );
}

function LibraryPanel() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="tab">
      <div className="create-tiles">
        <button
          type="button"
          disabled={busy}
          title="Replace the timeline with a 12-second Kopi & Coins demo"
          onClick={async () => {
            setBusy(true);
            try {
              newProjectAction(await buildDemoProject());
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="spark" size={22} />
          <b>Kopi & Coins demo</b>
          <small>a ready-made 9:16 edit</small>
        </button>
        <button
          type="button"
          title="Add a calm lo-fi loop to the Music track"
          onClick={async () => {
            const m = await libraryMusic();
            const p = touch({ ...project(), media: [...project().media, m] });
            const music = p.tracks.find((t) => t.type === "audio" && /music/i.test(t.name)) ?? p.tracks.find((t) => t.type === "audio")!;
            const r = addMediaToTimeline(p, m, { trackId: music.id, at: 0 });
            apply(() => updateClip(r.project, r.clip.id, { audioRole: "music", volume: 0.5 }));
            toast("Lo-fi loop added to Music", "ok");
          }}
        >
          <Icon name="music" size={22} />
          <b>Lo-fi loop</b>
          <small>12 s, made in the app</small>
        </button>
      </div>
    </div>
  );
}

function ClaudePanel() {
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState("");
  const hf = useStore((s) => s.project.higgsfield);
  return (
    <div className="tab">
      <div className="flow">
        <span>Claude plans</span>→<span>Higgsfield films</span>→<span className="here">LahLah edits</span>→<span>TikTok / YouTube</span>
      </div>
      <h3>Open Claude's hand-off</h3>
      <p className="hint">
        Claude's <code>higgsfield-video</code> skill writes <code>lahlah-edit.json</code>. Open it and every shot lands on the timeline in order, with transitions, captions and music.
      </p>
      <Btn kind="primary" big icon="folder" label="Open lahlah-edit.json" className="wide" onClick={openDialog} />
      <h3>Or paste Higgsfield links</h3>
      <p className="hint">In Higgsfield, open each finished shot, copy its download link, and paste them here in order. One per line.</p>
      <textarea className="text-input" rows={4} placeholder="https://…/S01-SH01.mp4" value={links} onChange={(e) => setLinks(e.target.value)} />
      <Btn
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
      <h3>Prefer CapCut?</h3>
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
  const media = useStore((s) => s.project.media).filter((m) => m.kind === "audio");
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

const EFFECTS: { id: string; label: string; tip: string; apply: (c: Clip) => Partial<Clip> }[] = [
  { id: "kenburns", label: "Slow zoom", tip: "Ken Burns: 100% to 115% across the clip", apply: (c) => ({ keyframes: [{ t: 0, scale: c.transform.scale }, { t: c.duration, scale: c.transform.scale * 1.15 }] }) },
  { id: "zoomout", label: "Zoom out", tip: "Starts close, settles back", apply: (c) => ({ keyframes: [{ t: 0, scale: c.transform.scale * 1.2 }, { t: c.duration, scale: c.transform.scale }] }) },
  { id: "popin", label: "Pop in", tip: "Grows from 60% with a fade, in half a second", apply: (c) => ({ keyframes: [{ t: 0, scale: c.transform.scale * 0.6, opacity: 0 }, { t: Math.min(0.5, c.duration), scale: c.transform.scale, opacity: 1 }] }) },
  { id: "slideup", label: "Slide up", tip: "Rises into place", apply: (c) => ({ keyframes: [{ t: 0, y: c.transform.y + 0.15, opacity: 0 }, { t: Math.min(0.5, c.duration), y: c.transform.y, opacity: 1 }] }) },
  { id: "drift", label: "Drift left", tip: "A slow pan from right to left", apply: (c) => ({ keyframes: [{ t: 0, x: c.transform.x + 0.05, scale: Math.max(1.1, c.transform.scale) }, { t: c.duration, x: c.transform.x - 0.05, scale: Math.max(1.1, c.transform.scale) }] }) },
  { id: "fadein", label: "Fade in", tip: "Half a second from black or clear", apply: (c) => ({ fadeIn: Math.min(0.5, c.duration / 2) }) },
  { id: "fadeout", label: "Fade out", tip: "Half a second to black or clear", apply: (c) => ({ fadeOut: Math.min(0.5, c.duration / 2) }) },
  { id: "none", label: "No effect", tip: "Remove motion and fades", apply: () => ({ keyframes: [], fadeIn: 0, fadeOut: 0 }) },
];

function EffectsTab() {
  useStore((s) => s.ui.selectedId);
  const c = targetClip();
  const ok = c && c.type !== "audio";
  return (
    <div className="tab">
      <p className="hint">{ok ? "Click an effect to apply it to the selected clip." : "Select a clip, text or sticker on the timeline first."}</p>
      <div className="effect-grid">
        {EFFECTS.map((e) => (
          <button type="button" key={e.id} disabled={!ok} title={e.tip} className={`effect fx-${e.id}`} onClick={() => c && apply((q) => updateClip(q, c.id, e.apply(c)))}>
            <span className="fx-demo" />
            {e.label}
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

function TemplatesTab() {
  const start = (aspect: AspectId, name: string) => {
    newProjectAction({ ...newProject(name, aspect) });
    toast(`New ${aspect} project`, "ok");
  };
  return (
    <div className="tab">
      <p className="hint">Start fresh on the right canvas, or open the demo to see every tool in use.</p>
      <div className="create-tiles three">
        <button type="button" onClick={() => start("9:16", "New TikTok")} title="1080 × 1920">
          <span className="ratio r9x16" />
          <b>TikTok / Shorts</b>
          <small>9:16</small>
        </button>
        <button type="button" onClick={() => start("16:9", "New YouTube video")} title="1920 × 1080">
          <span className="ratio r16x9" />
          <b>YouTube</b>
          <small>16:9</small>
        </button>
        <button type="button" onClick={() => start("1:1", "New square post")} title="1080 × 1080">
          <span className="ratio r1x1" />
          <b>Square</b>
          <small>1:1</small>
        </button>
        <button
          type="button"
          onClick={async () => newProjectAction(await buildDemoProject())}
          title="A 12-second Kopi & Coins edit with transitions, text, captions and music"
        >
          <Icon name="spark" size={22} />
          <b>Kopi & Coins demo</b>
          <small>9:16, 12 s</small>
        </button>
      </div>
    </div>
  );
}

function AdjustmentTab() {
  useStore((s) => s.project);
  const c = targetClip();
  const visual = c && (c.type === "video" || c.type === "image") ? c : null;
  if (!visual) return <div className="tab"><p className="hint">Select a video or photo clip to adjust its colour.</p></div>;
  const upd = (patch: Partial<Clip["adjust"]>, k: string) => apply((q) => updateClip(q, visual.id, (x) => ({ adjust: { ...x.adjust, ...patch, look: undefined } })), `${visual.id}-adj-${k}`);
  const a = visual.adjust;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="tab">
      <Slider label="Brightness" value={a.brightness} min={-0.5} max={0.5} onChange={(v) => upd({ brightness: v }, "br")} format={(v) => (v > 0 ? "+" : "") + Math.round(v * 100)} reset={0} />
      <Slider label="Contrast" value={a.contrast} min={0.5} max={1.8} onChange={(v) => upd({ contrast: v }, "ct")} format={pct} reset={1} />
      <Slider label="Saturation" value={a.saturation} min={0} max={2.5} onChange={(v) => upd({ saturation: v }, "sat")} format={pct} reset={1} />
      <Slider label="Temperature" value={a.temperature} min={-1} max={1} onChange={(v) => upd({ temperature: v }, "temp")} format={(v) => (v > 0 ? "Warm " : v < 0 ? "Cool " : "") + Math.round(Math.abs(v) * 100)} reset={0} />
      <Slider label="Vignette" value={a.vignette} min={0} max={1} onChange={(v) => upd({ vignette: v }, "vig")} format={pct} reset={0} />
      <p className="hint">Double-click a slider to reset it.</p>
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
