import { useEffect, useRef, useState } from "react";
import { apply, clock, project, seek, setUI, useClock, useStore } from "../lib/store";
import { Clip, Project, Track } from "../lib/types";
import { addTrack, clamp, clipEnd, clipsOnTrack, fmtTime, mainTrack, moveClip, totalDuration, trackAccepts, transitionLength, trimClip } from "../lib/project";
import { addToTimeline, deleteSelected, duplicateSelected, splitHere } from "../actions";
import { Btn, Icon } from "./ui";
import { modKey } from "../lib/platform";

const HEAD_W = 150;
const TRACK_H: Record<Track["type"], number> = { main: 64, overlay: 44, text: 34, caption: 34, audio: 40 };
const TYPE_ICON: Record<Track["type"], string> = { main: "media", overlay: "sticker", text: "text", caption: "captions", audio: "music" };

interface DragState {
  id: string;
  mode: "move" | "start" | "end";
  x0: number;
  y0: number;
  dt: number;
  trackId: string;
  moved: boolean;
}

function snapPoints(p: Project, exceptId: string, t: number): number[] {
  const pts = [0, t];
  for (const c of p.clips) if (c.id !== exceptId) pts.push(c.start, clipEnd(c));
  return pts;
}

function snapValue(v: number, pts: number[], zoom: number): number | null {
  let best: number | null = null;
  let bestD = 9 / zoom;
  for (const p of pts) {
    const d = Math.abs(p - v);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function Timeline() {
  const p = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const t = useClock((c) => c.t);
  const zoom = ui.zoom;
  const total = totalDuration(p);
  const width = Math.max(1200, (total + 20) * zoom);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const playing = useClock((c) => c.playing);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = t * zoom + HEAD_W;
    if (x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = x - HEAD_W - 40;
  }, [t, zoom, playing]);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft - HEAD_W) / zoom);
  };

  const scrub = (e: React.PointerEvent) => {
    seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startDrag = (e: React.PointerEvent, c: Clip, mode: DragState["mode"]) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setUI({ selectedId: c.id });
    const st: DragState = { id: c.id, mode, x0: e.clientX, y0: e.clientY, dt: 0, trackId: c.trackId, moved: false };
    setDrag(st);
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      let dt = (ev.clientX - d.x0) / zoom;
      const proj = project();
      const clip = proj.clips.find((x) => x.id === d.id)!;
      if (ui.snapping) {
        const pts = snapPoints(proj, d.id, clock.get().t);
        if (mode === "move") {
          const s1 = snapValue(clip.start + dt, pts, zoom);
          const s2 = snapValue(clipEnd(clip) + dt, pts, zoom);
          if (s1 !== null) dt = s1 - clip.start;
          else if (s2 !== null) dt = s2 - clipEnd(clip);
        } else {
          const edge = mode === "start" ? clip.start : clipEnd(clip);
          const s = snapValue(edge + dt, pts, zoom);
          if (s !== null) dt = s - edge;
        }
      }
      let trackId = d.trackId;
      if (mode === "move") {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-track]") as HTMLElement | null;
        const tid = el?.dataset.track;
        const tr = proj.tracks.find((x) => x.id === tid);
        if (tr && trackAccepts(tr.type, clip.type)) trackId = tr.id;
      }
      setDrag({ ...d, dt, trackId, moved: d.moved || Math.abs(ev.clientX - d.x0) > 3 || Math.abs(ev.clientY - d.y0) > 3 });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current;
      setDrag(null);
      if (!d || !d.moved) return;
      const clip = project().clips.find((x) => x.id === d.id);
      if (!clip) return;
      if (d.mode === "move") apply((q) => moveClip(q, d.id, Math.max(0, clip.start + d.dt), d.trackId));
      else apply((q) => trimClip(q, d.id, d.mode as "start" | "end", d.dt));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setUI({ zoom: clamp(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 8, 400) });
    }
  };

  const onDrop = (e: React.DragEvent, track: Track) => {
    const id = e.dataTransfer.getData("application/x-lahlah-media");
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const m = p.media.find((x) => x.id === id);
    if (!m) return;
    const want = m.kind === "audio" ? "audio" : "video";
    const ok = trackAccepts(track.type, want === "audio" ? "audio" : m.kind === "image" ? "image" : "video");
    addToTimeline(id, ok ? track.id : undefined, timeAt(e.clientX));
  };

  const ticks: number[] = [];
  const step = zoom > 120 ? 0.5 : zoom > 50 ? 1 : zoom > 20 ? 5 : 10;
  for (let s = 0; s * zoom < width; s += step) ticks.push(s);

  const sel = p.clips.find((c) => c.id === ui.selectedId);

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <Btn icon="split" label="Split" tip="Split at the playhead (S)" onClick={() => splitHere()} />
        <Btn icon="trash" label="Delete" tip="Delete the selected clip (Delete)" onClick={() => deleteSelected(false)} disabled={!sel} />
        <Btn icon="ripple" label="Ripple delete" tip="Delete and close the gap (Shift+Delete)" onClick={() => deleteSelected(true)} disabled={!sel} />
        <Btn icon="copy" label="Duplicate" tip={`Duplicate (${modKey}+D)`} onClick={duplicateSelected} disabled={!sel} />
        <span className="tl-sep" />
        <Btn icon="magnet" label="Snap" tip="Snap clips to the playhead and other clips" active={ui.snapping} onClick={() => setUI({ snapping: !ui.snapping })} />
        <span className="tl-grow" />
        <Btn icon="plus" label="Overlay track" tip="Add another overlay track for picture-in-picture" onClick={() => apply((q) => addTrack(q, "overlay"))} />
        <Btn icon="plus" label="Audio track" tip="Add another audio track" onClick={() => apply((q) => addTrack(q, "audio"))} />
        <span className="tl-sep" />
        <Btn icon="zoomout" tip="Zoom out (-)" onClick={() => setUI({ zoom: clamp(zoom / 1.5, 8, 400) })} kind="ghost" />
        <input className="tl-zoom" type="range" min={8} max={400} value={zoom} onChange={(e) => setUI({ zoom: Number(e.target.value) })} title="Timeline zoom" />
        <Btn icon="zoomin" tip="Zoom in (+)" onClick={() => setUI({ zoom: clamp(zoom * 1.5, 8, 400) })} kind="ghost" />
        <button
          type="button"
          className="btn plain"
          title="Fit the whole video in view"
          onClick={() => {
            const w = (scroller.current?.clientWidth ?? 1000) - HEAD_W - 40;
            setUI({ zoom: clamp(w / Math.max(5, total), 8, 400) });
          }}
        >
          Fit
        </button>
      </div>
      <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
        <div className="tl-inner" style={{ width: width + HEAD_W }}>
          <div className="tl-ruler" onPointerDown={scrub} style={{ paddingLeft: HEAD_W }}>
            <div className="tl-ruler-head" style={{ width: HEAD_W }} />
            {ticks.map((s) => (
              <span key={s} className="tick" style={{ left: HEAD_W + s * zoom }}>
                {Number.isInteger(s) && s % (step >= 5 ? step : step < 1 ? 1 : step) === 0 ? fmtTime(s) : ""}
              </span>
            ))}
          </div>
          {p.tracks.map((track) => (
            <TrackRow key={track.id} p={p} track={track} zoom={zoom} drag={drag} selectedId={ui.selectedId} startDrag={startDrag} onDrop={onDrop} onBackground={(e) => (setUI({ selectedId: null }), scrub(e))} />
          ))}
          <div className="tl-playhead" style={{ left: HEAD_W + t * zoom }} onPointerDown={scrub}>
            <div className="tl-playhead-cap" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackRow({
  p,
  track,
  zoom,
  drag,
  selectedId,
  startDrag,
  onDrop,
  onBackground,
}: {
  p: Project;
  track: Track;
  zoom: number;
  drag: DragState | null;
  selectedId: string | null;
  startDrag: (e: React.PointerEvent, c: Clip, mode: DragState["mode"]) => void;
  onDrop: (e: React.DragEvent, t: Track) => void;
  onBackground: (e: React.PointerEvent) => void;
}) {
  const clips = clipsOnTrack(p, track.id);
  const ghosts = drag && drag.mode === "move" && drag.trackId === track.id ? p.clips.filter((c) => c.id === drag.id && c.trackId !== track.id) : [];
  const h = TRACK_H[track.type];
  const toggle = (k: "muted" | "hidden") => apply((q) => ({ ...q, tracks: q.tracks.map((x) => (x.id === track.id ? { ...x, [k]: !x[k] } : x)) }));
  const main = track.type === "main";
  return (
    <div className={`tl-track ${track.type} ${track.hidden ? "hidden" : ""}`} style={{ height: h }}>
      <div className="tl-head" style={{ width: HEAD_W }}>
        <Icon name={TYPE_ICON[track.type]} size={15} />
        <span className="tl-name" title={track.name}>
          {track.name}
        </span>
        {track.type !== "audio" && (
          <button type="button" className="mini" title={track.hidden ? "Show track" : "Hide track"} onClick={() => toggle("hidden")}>
            <Icon name={track.hidden ? "eyeoff" : "eye"} size={14} />
          </button>
        )}
        {(track.type === "audio" || track.type === "main" || track.type === "overlay") && (
          <button type="button" className="mini" title={track.muted ? "Unmute track" : "Mute track"} onClick={() => toggle("muted")}>
            <Icon name={track.muted ? "mute" : "volume"} size={14} />
          </button>
        )}
      </div>
      <div
        className="tl-lane"
        data-track={track.id}
        onPointerDown={onBackground}
        onDragOver={(e) => e.dataTransfer.types.includes("application/x-lahlah-media") && e.preventDefault()}
        onDrop={(e) => onDrop(e, track)}
      >
        {clips.length === 0 && !ghosts.length && <span className="lane-hint">{hintFor(track)}</span>}
        {[...clips, ...ghosts].map((c, i) => {
          const isDrag = drag?.id === c.id;
          let left = c.start * zoom;
          let w = c.duration * zoom;
          if (isDrag && drag) {
            if (drag.mode === "move") left = Math.max(0, c.start + drag.dt) * zoom;
            if (drag.mode === "start") {
              left = (c.start + drag.dt) * zoom;
              w = (c.duration - drag.dt) * zoom;
            }
            if (drag.mode === "end") w = (c.duration + drag.dt) * zoom;
          }
          if (isDrag && drag?.mode === "move" && drag.trackId !== track.id) return null;
          const m = p.media.find((x) => x.id === c.mediaId);
          const prev = main && i > 0 ? clips[i - 1] : undefined;
          const tl = prev ? transitionLength(prev, c) : 0;
          return (
            <div
              key={c.id}
              className={`tl-clip ${c.type} ${selectedId === c.id ? "sel" : ""} ${isDrag ? "dragging" : ""} ${c.muted ? "muted" : ""}`}
              style={{
                left,
                width: Math.max(6, w),
                backgroundImage: (c.type === "video" || c.type === "image") && m?.thumb ? `url("${m.thumb}")` : undefined,
              }}
              title={`${c.label ?? m?.name ?? c.text?.content ?? c.sticker ?? ""}  ${c.duration.toFixed(1)}s${c.speed !== 1 ? `  ${c.speed}x` : ""}`}
              onPointerDown={(e) => startDrag(e, c, "move")}
            >
              <div className="tl-handle l" onPointerDown={(e) => startDrag(e, c, "start")} title="Drag to trim the start" />
              <span className="tl-clip-label">
                {c.type === "sticker" ? c.sticker : c.type === "text" ? c.text?.content : `${c.label ? c.label + " · " : ""}${m?.name ?? ""}`}
                {c.speed !== 1 && <em className="speed-tag">{c.speed}x</em>}
                {(c.keyframes?.length ?? 0) > 0 && <em className="kf-tag">◆</em>}
              </span>
              {c.type === "audio" && <div className="wave" />}
              <div className="tl-handle r" onPointerDown={(e) => startDrag(e, c, "end")} title="Drag to trim the end" />
              {main && prev && (
                <button
                  type="button"
                  className={`tl-trans ${c.transitionIn ? "on" : ""}`}
                  style={{ left: -(tl * zoom) / 2 - 11 }}
                  title={c.transitionIn ? `${c.transitionIn.type} transition (${tl.toFixed(1)}s). Click to change.` : "Add a transition here"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setUI({ selectedId: c.id, leftTab: "transitions" });
                  }}
                >
                  <Icon name="transition" size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function hintFor(t: Track): string {
  switch (t.type) {
    case "main":
      return "Main video: drop clips here. They snap end to end.";
    case "overlay":
      return "Overlay: picture-in-picture, logos and stickers";
    case "text":
      return "Text: titles and labels (Text tab)";
    case "caption":
      return "Captions: subtitles, SRT import or auto-captions";
    case "audio":
      return /music/i.test(t.name) ? "Music: drop a song here" : "Voice-over and sound effects (press R to record)";
  }
}

export function mainClipsCount(p: Project) {
  return clipsOnTrack(p, mainTrack(p).id).length;
}
