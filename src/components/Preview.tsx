import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apply, clock, seek, setUI, togglePlay, useClock, useStore } from "../lib/store";
import { Clip, MediaItem, Project, ASPECTS, AspectId } from "../lib/types";
import {
  canvasSize,
  clipEnd,
  clipsOnTrack,
  fadeFactor,
  interpolateKeyframes,
  mainTrack,
  setAspect,
  totalDuration,
  transitionLength,
  updateClip,
  upsertKeyframe,
} from "../lib/project";
import { previewImage } from "../lib/raster";
import { useRecorder } from "../lib/recorder";
import { Btn, Icon } from "./ui";
import { EmptyStage } from "./EmptyStage";

interface Fx {
  opacity: number;
  tx: number;
  scale: number;
  clip?: string;
  hidden?: boolean;
}

function mainFx(main: Clip[], t: number, W: number): { fx: Map<string, Fx>; dip: number } {
  const fx = new Map<string, Fx>();
  let dip = 0;
  for (let i = 0; i < main.length; i++) {
    const c = main[i];
    if (t < c.start || t >= clipEnd(c)) continue;
    fx.set(c.id, { opacity: 1, tx: 0, scale: 1 });
  }
  for (let i = 1; i < main.length; i++) {
    const c = main[i];
    const prev = main[i - 1];
    const L = transitionLength(prev, c);
    if (!L || t < c.start || t >= c.start + L || !c.transitionIn) continue;
    const p = (t - c.start) / L;
    const inc = fx.get(c.id) ?? { opacity: 1, tx: 0, scale: 1 };
    const out = fx.get(prev.id) ?? { opacity: 1, tx: 0, scale: 1 };
    switch (c.transitionIn.type) {
      case "crossfade":
        inc.opacity = p;
        break;
      case "slide":
        out.tx = -p * W;
        inc.tx = (1 - p) * W;
        break;
      case "zoom":
        out.scale = 1 + p;
        out.opacity = 1 - p;
        inc.opacity = p;
        break;
      case "wipe":
        inc.clip = `inset(0 0 0 ${((1 - p) * 100).toFixed(2)}%)`;
        break;
      case "dip":
        dip = 1 - Math.abs(2 * p - 1);
        if (p < 0.5) inc.hidden = true;
        else out.hidden = true;
        break;
    }
    fx.set(c.id, inc);
    fx.set(prev.id, out);
  }
  return { fx, dip };
}

function fitBox(m: MediaItem | undefined, c: Clip, W: number, H: number) {
  const cr = c.transform.crop;
  const mw = (m?.width || W) * (1 - cr.l - cr.r);
  const mh = (m?.height || H) * (1 - cr.t - cr.b);
  const a = mw / mh;
  const s = c.transform.scale;
  return a > W / H ? { w: W * s, h: (W * s) / a } : { w: H * s * a, h: H * s };
}

function filterCss(c: Clip) {
  const a = c.adjust;
  const warm = a.temperature > 0 ? ` sepia(${(a.temperature * 0.45).toFixed(3)})` : a.temperature < 0 ? ` hue-rotate(${(a.temperature * 12).toFixed(1)}deg)` : "";
  return `brightness(${1 + a.brightness * 0.6}) contrast(${a.contrast}) saturate(${a.saturation})${warm}`;
}

function MediaEl({ clip, media, active, t, playing, muted, onEl }: { clip: Clip; media: MediaItem; active: boolean; t: number; playing: boolean; muted: boolean; onEl?: (el: HTMLVideoElement | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    onEl?.(ref.current);
  }, [onEl]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const local = Math.max(0, t - clip.start);
    const desired = clip.inPoint + local * clip.speed;
    el.playbackRate = clip.speed;
    el.muted = muted || clip.muted;
    el.volume = Math.min(1, clip.volume * fadeFactor(clip, local));
    if (active && playing) {
      if (Math.abs(el.currentTime - desired) > 0.3) el.currentTime = desired;
      if (el.paused) el.play().catch(() => undefined);
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - desired) > 0.04) el.currentTime = Math.max(0, desired);
    }
  });
  if (media.kind === "audio") return <audio ref={ref as any} src={media.url} preload="auto" />;
  return <video ref={ref} src={media.url} preload="auto" playsInline className="media" />;
}

function BlurBackdrop({ get, url, kind }: { get: () => HTMLVideoElement | null; url: string; kind: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const t = useClock((c) => c.t);
  useEffect(() => {
    if (kind !== "video") return;
    const v = get();
    const c = cv.current;
    if (!v || !c || v.readyState < 2) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const vw = v.videoWidth || 16;
    const vh = v.videoHeight || 9;
    const s = Math.max(c.width / vw, c.height / vh);
    try {
      ctx.drawImage(v, (c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s);
    } catch {
      /* not ready */
    }
  }, [t, get, kind]);
  if (kind === "image") return <img className="blur-bg" src={url} alt="" />;
  return <canvas ref={cv} width={64} height={64} className="blur-bg" />;
}

function MainLayer({ p, c, fx, t, playing, muted, W, H, onPick }: { p: Project; c: Clip; fx: Fx; t: number; playing: boolean; muted: boolean; W: number; H: number; onPick: (e: React.PointerEvent, c: Clip) => void }) {
  const m = p.media.find((x) => x.id === c.mediaId);
  const elRef = useRef<HTMLVideoElement | null>(null);
  const [getEl] = useState(() => () => elRef.current);
  const [setEl] = useState(() => (el: HTMLVideoElement | null) => {
    elRef.current = el;
  });
  if (!m) return null;
  const local = t - c.start;
  const vs = interpolateKeyframes(c, local);
  const box = fitBox(m, { ...c, transform: { ...c.transform, scale: vs.scale } }, W, H);
  const fade = fadeFactor(c, local);
  const wrap: CSSProperties = {
    opacity: fx.hidden ? 0 : fx.opacity,
    transform: `translateX(${fx.tx}px) scale(${fx.scale})`,
    clipPath: fx.clip,
    filter: fade < 1 ? `brightness(${fade})` : undefined,
  };
  return (
    <div className="main-wrap" style={wrap}>
      {p.background.type === "blur" ? <BlurBackdrop get={getEl} url={m.url} kind={m.kind} /> : <div className="solid-bg" style={{ background: p.background.color }} />}
      <ClipBox c={c} m={m} vs={vs} box={box} W={W} H={H} fade={1} onPick={onPick}>
        {m.kind === "video" ? (
          <MediaEl clip={c} media={m} active t={t} playing={playing} muted={muted} onEl={setEl} />
        ) : (
          <img className="media" src={m.url} alt="" draggable={false} />
        )}
      </ClipBox>
    </div>
  );
}

function ClipBox({ c, m, vs, box, W, H, fade, children, onPick }: { c: Clip; m?: MediaItem; vs: ReturnType<typeof interpolateKeyframes>; box: { w: number; h: number }; W: number; H: number; fade: number; children: React.ReactNode; onPick: (e: React.PointerEvent, c: Clip) => void }) {
  const selectedId = useStore((s) => s.ui.selectedId);
  const cr = c.transform.crop;
  const innerW = box.w / Math.max(0.05, 1 - cr.l - cr.r);
  const innerH = box.h / Math.max(0.05, 1 - cr.t - cr.b);
  const a = c.adjust;
  const style: CSSProperties = {
    width: box.w,
    height: box.h,
    left: W / 2 + vs.x * W - box.w / 2,
    top: H / 2 + vs.y * H - box.h / 2,
    opacity: vs.opacity * fade,
    transform: `rotate(${c.transform.rotation}deg) scale(${c.transform.flipH ? -1 : 1}, ${c.transform.flipV ? -1 : 1})`,
    filter: m && m.kind !== "audio" ? filterCss(c) : undefined,
  };
  return (
    <div className={`clip-box ${selectedId === c.id ? "sel" : ""}`} style={style} onPointerDown={(e) => onPick(e, c)}>
      <div className="clip-inner" style={{ width: innerW, height: innerH, left: -cr.l * innerW, top: -cr.t * innerH }}>
        {children}
      </div>
      {a.temperature !== 0 && (
        <div className="tint" style={{ background: a.temperature > 0 ? `rgba(255,140,30,${a.temperature * 0.5})` : `rgba(40,130,255,${-a.temperature * 0.5})` }} />
      )}
      {a.vignette > 0 && <div className="vignette" style={{ background: `radial-gradient(ellipse at center, transparent ${70 - a.vignette * 30}%, rgba(0,0,0,${0.35 + a.vignette * 0.55}) 100%)` }} />}
    </div>
  );
}

export function Preview() {
  const p = useStore((s) => s.project);
  const t = useClock((c) => c.t);
  const playing = useClock((c) => c.playing);
  const recording = useRecorder().recording;
  const { w: W, h: H } = canvasSize(p);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.05, Math.min((r.width - 24) / W, (r.height - 24) / H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  const total = totalDuration(p);
  const main = clipsOnTrack(p, mainTrack(p).id);
  const { fx, dip } = mainFx(main, t, W);
  const hidden = new Set(p.tracks.filter((x) => x.hidden).map((x) => x.id));
  const mutedTracks = new Set(p.tracks.filter((x) => x.muted).map((x) => x.id));
  const active = (c: Clip) => t >= c.start && t < clipEnd(c);
  const order = [...p.tracks].reverse().filter((x) => x.type === "overlay" || x.type === "caption" || x.type === "text");

  // Drag a layer on the stage to move it.
  const drag = useRef<{ id: string; x0: number; y0: number; cx: number; cy: number } | null>(null);
  const onPick = (e: React.PointerEvent, c: Clip) => {
    e.stopPropagation();
    setUI({ selectedId: c.id });
    const vs = interpolateKeyframes(c, clock.get().t - c.start);
    drag.current = { id: c.id, x0: e.clientX, y0: e.clientY, cx: vs.x, cy: vs.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const nx = d.cx + (e.clientX - d.x0) / scale / W;
    const ny = d.cy + (e.clientY - d.y0) / scale / H;
    const snap = (v: number) => (Math.abs(v) < 0.015 ? 0 : v);
    apply(
      (q) =>
        updateClip(q, d.id, (c) =>
          c.keyframes?.length
            ? { keyframes: upsertKeyframe(c, clock.get().t - c.start, { x: snap(nx), y: snap(ny) }) }
            : { transform: { ...c.transform, x: snap(nx), y: snap(ny) } },
        ),
      `drag-${d.id}`,
    );
  };

  const full = useStore((s) => s.ui.fullscreen);
  return (
    <div className={`preview panel ${full ? "fullscreen" : ""}`}>
      <PlayerHeader />
      <div className="stage-wrap" ref={wrapRef} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerDown={() => setUI({ selectedId: null })}>
        {p.clips.length === 0 ? (
          <EmptyStage />
        ) : (
          <div className="stage" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
            {main
              .filter((c) => fx.has(c.id) && !hidden.has(c.trackId))
              .map((c) => (
                <MainLayer key={c.id} p={p} c={c} fx={fx.get(c.id)!} t={t} playing={playing} muted={recording || mutedTracks.has(c.trackId)} W={W} H={H} onPick={onPick} />
              ))}
            {dip > 0 && <div className="dip" style={{ opacity: dip }} />}
            {order.flatMap((track) =>
              track.hidden
                ? []
                : clipsOnTrack(p, track.id)
                    .filter(active)
                    .map((c) => {
                      const local = t - c.start;
                      const vs = interpolateKeyframes(c, local);
                      const fade = fadeFactor(c, local);
                      if (c.type === "text" || c.type === "sticker") {
                        const img = previewImage(c, W);
                        if (!img) return null;
                        return (
                          <ClipBox key={c.id} c={c} vs={vs} box={{ w: img.w * vs.scale, h: img.h * vs.scale }} W={W} H={H} fade={fade} onPick={onPick}>
                            <img className="media" src={img.url} alt={c.text?.content ?? c.sticker} draggable={false} />
                          </ClipBox>
                        );
                      }
                      const m = p.media.find((x) => x.id === c.mediaId);
                      if (!m) return null;
                      return (
                        <ClipBox key={c.id} c={c} m={m} vs={vs} box={fitBox(m, { ...c, transform: { ...c.transform, scale: vs.scale } }, W, H)} W={W} H={H} fade={fade} onPick={onPick}>
                          {m.kind === "video" ? <MediaEl clip={c} media={m} active t={t} playing={playing} muted={recording || mutedTracks.has(c.trackId)} /> : <img className="media" src={m.url} alt="" draggable={false} />}
                        </ClipBox>
                      );
                    }),
            )}
            {/* Audio-only clips play through hidden elements. */}
            {p.clips
              .filter((c) => c.type === "audio" && active(c) && !hidden.has(c.trackId))
              .map((c) => {
                const m = p.media.find((x) => x.id === c.mediaId);
                return m ? <MediaEl key={c.id} clip={c} media={m} active t={t} playing={playing} muted={recording || mutedTracks.has(c.trackId)} /> : null;
              })}
            {recording && <div className="rec-badge">● REC</div>}
          </div>
        )}
      </div>
      <PreviewBar t={t} total={total} playing={playing} />
    </div>
  );
}

function PreviewBar({ t, total, playing }: { t: number; total: number; playing: boolean }) {
  const p = useStore((s) => s.project);
  const full = useStore((s) => s.ui.fullscreen);
  return (
    <div className="preview-bar">
      <div className="pb-left">
        <span className="timecode">
          <b>{timecode(t, p.fps)}</b> / {timecode(total, p.fps)}
        </span>
      </div>
      <div className="pb-mid">
        <Btn icon="start" tip="Go to start (Home)" onClick={() => seek(0)} kind="ghost" />
        <button type="button" className="play-btn" onClick={togglePlay} title="Play / pause (Space)" aria-label="Play or pause">
          <Icon name={playing ? "pause" : "play"} size={22} />
        </button>
        <Btn icon="end" tip="Go to end (End)" onClick={() => seek(total)} kind="ghost" />
      </div>
      <div className="pb-right">
        <label className="ratio-select" title="Canvas ratio: 9:16 for TikTok, Shorts and Reels; 16:9 for YouTube">
          <span>Ratio</span>
          <select value={p.aspect} onChange={(e) => apply((q) => setAspect(q, e.target.value as AspectId))}>
            {(Object.keys(ASPECTS) as AspectId[]).map((id) => (
              <option key={id} value={id} title={ASPECTS[id].hint}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <Btn icon="fullscreen" tip={full ? "Exit full screen (Esc)" : "Full screen preview"} onClick={() => setUI({ fullscreen: !full })} kind="ghost" />
      </div>
    </div>
  );
}

function timecode(s: number, fps: number) {
  const f = Math.floor((s - Math.floor(s)) * fps);
  const t = Math.floor(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}:${pad(f)}`;
}

function PlayerHeader() {
  const [open, setOpen] = useState(false);
  const p = useStore((s) => s.project);
  const full = useStore((s) => s.ui.fullscreen);
  return (
    <div className="panel-head">
      <span>Player</span>
      <div className="file-menu">
        <button type="button" className="mini" title="Player options" onClick={() => setOpen(!open)}>
          <Icon name="menu" size={16} />
        </button>
        {open && (
          <ul role="menu" className="right" onMouseLeave={() => setOpen(false)}>
            <li>
              <button type="button" onClick={() => (setOpen(false), setUI({ fullscreen: !full }))}>
                {full ? "Exit full screen" : "Full screen"}
              </button>
            </li>
            <li className="sep" />
            <li>
              <button type="button" onClick={() => (setOpen(false), apply((q) => ({ ...q, background: { ...q.background, type: "blur" } })))}>
                Background: blur {p.background.type === "blur" ? "✓" : ""}
              </button>
            </li>
            <li>
              <button type="button" onClick={() => (setOpen(false), apply((q) => ({ ...q, background: { ...q.background, type: "color" } })))}>
                Background: solid colour {p.background.type === "color" ? "✓" : ""}
              </button>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
