import { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  split: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  ripple: <path d="M4 7h16M6 7l1 13h10l1-13M3 12h4m0 0-2-2m2 2-2 2M21 12h-4m0 0 2-2m-2 2 2 2" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  import: <path d="M12 3v12m0 0-4-4m4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />,
  export: <path d="M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />,
  save: <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3v5h7V3M8 21v-7h8v7" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  media: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10 9 5 3-5 3z" fill="currentColor" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  sticker: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  transition: (
    <>
      <rect x="3" y="6" width="11" height="12" rx="2" />
      <rect x="10" y="6" width="11" height="12" rx="2" strokeDasharray="2 2" />
    </>
  ),
  filter: (
    <>
      <circle cx="9" cy="9" r="5" />
      <circle cx="15" cy="9" r="5" />
      <circle cx="12" cy="15" r="5" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  magnet: <path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4" />,
  zoomin: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6" />,
  zoomout: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeoff: <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  volume: <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />,
  mute: <path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5L20 7" />,
  key: <path d="M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z" />,
  start: <path d="M6 5v14M18 5 9 12l9 7z" />,
  end: <path d="M18 5v14M6 5l9 7-9 7z" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
  new: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6" />,
  wand: <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />,
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name] ?? PATHS.help}
    </svg>
  );
}

export function Btn(props: {
  icon?: string;
  label?: string;
  tip?: string;
  onClick?: () => void;
  kind?: "primary" | "ghost" | "plain" | "danger";
  disabled?: boolean;
  active?: boolean;
  big?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`btn ${props.kind ?? "plain"} ${props.big ? "big" : ""} ${props.active ? "active" : ""} ${props.className ?? ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.tip ?? props.label}
      aria-label={props.tip ?? props.label}
    >
      {props.icon && <Icon name={props.icon} size={props.big ? 22 : 18} />}
      {props.label && <span>{props.label}</span>}
      {props.children}
    </button>
  );
}

export function Slider(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  tip?: string;
  reset?: number;
  keyframe?: { on: boolean; toggle: () => void };
}) {
  return (
    <label className="slider" title={p.tip}>
      <span className="slider-label">
        {p.label}
        {p.keyframe && (
          <button type="button" className={`kf ${p.keyframe.on ? "on" : ""}`} title="Add or update a keyframe at the playhead" onClick={(e) => (e.preventDefault(), p.keyframe!.toggle())}>
            <Icon name="diamond" size={12} />
          </button>
        )}
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step ?? 0.01}
        value={p.value}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onDoubleClick={() => p.reset !== undefined && p.onChange(p.reset)}
      />
      <span className="slider-value">{p.format ? p.format(p.value) : p.value.toFixed(2)}</span>
    </label>
  );
}

export function Seg<T extends string>(p: { value: T; options: { id: T; label: string; tip?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {p.options.map((o) => (
        <button type="button" key={o.id} className={o.id === p.value ? "on" : ""} title={o.tip} onClick={() => p.onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal(p: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className={`modal ${p.wide ? "wide" : ""}`} role="dialog" aria-label={p.title}>
        <div className="modal-head">
          <h2>{p.title}</h2>
          <Btn icon="x" tip="Close (Esc)" onClick={p.onClose} kind="ghost" />
        </div>
        <div className="modal-body">{p.children}</div>
      </div>
    </div>
  );
}
