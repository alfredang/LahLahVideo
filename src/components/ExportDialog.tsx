import { useEffect, useRef, useState } from "react";
import { apply, project, setUI, useStore } from "../lib/store";
import { EXPORT_PRESETS, outputSize } from "../export/ffmpeg";
import { ExportJob, startExport } from "../export/run";
import { defaultExportDir, isDesktop, joinPath, openExternal, pickSavePath, reveal } from "../lib/platform";
import { fmtTime, setAspect, totalDuration } from "../lib/project";
import { safeFileName } from "../lib/projectio";
import { saveProject } from "../actions";
import { Btn, Modal, Seg } from "./ui";

type Quality = "720p" | "1080p" | "4k";

export function ExportDialog() {
  const p = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const [preset, setPreset] = useState<string>(ui.exportPreset ?? (p.aspect === "16:9" ? "youtube" : "tiktok"));
  const [quality, setQuality] = useState<Quality>(ui.exportQuality ?? "1080p");
  const [fps, setFps] = useState(p.fps);
  const [name, setName] = useState(safeFileName(p.name));
  const [dir, setDir] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<ExportJob | null>(null);
  const close = () => {
    if (job.current) return;
    setUI({ exportOpen: false, exportPreset: undefined, exportQuality: undefined });
  };

  useEffect(() => {
    if (isDesktop) defaultExportDir().then(setDir).catch(() => setDir(""));
  }, []);

  const size = outputSize(p, quality);
  const total = totalDuration(p);

  const pickPreset = (id: string) => {
    setPreset(id);
    const pr = EXPORT_PRESETS.find((x) => x.id === id);
    if (pr && pr.aspect !== project().aspect) apply((q) => setAspect(q, pr.aspect));
  };

  const go = async () => {
    setError(null);
    setDone(null);
    let out = await joinPath(dir, `${safeFileName(name)}.mp4`);
    if (!dir) {
      const chosen = await pickSavePath(`${safeFileName(name)}.mp4`, "mp4");
      if (!chosen) return;
      out = chosen;
    }
    setProgress(0);
    try {
      job.current = await startExport(project(), { ...size, fps, output: out }, setProgress);
      const r = await job.current.done;
      if (r.ok) setDone(r.output);
      else setError(r.error ?? "Export failed");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      job.current = null;
      setProgress((v) => (v === null ? null : v));
    }
  };

  if (!isDesktop) {
    return (
      <Modal title="Export needs the desktop app" onClose={close}>
        <p>
          You're in the browser preview (<code>npm run dev</code>). Exporting an MP4 uses the FFmpeg engine bundled with the LahLah Video app for Mac and Windows.
        </p>
        <ol>
          <li>Install the app: see “1-minute install” in the README.</li>
          <li>Save this project now, then open it in the app.</li>
        </ol>
        <div className="row">
          <Btn kind="primary" icon="save" label="Save project" onClick={() => saveProject()} />
          <Btn icon="link" label="Install guide" onClick={() => openExternal("https://github.com/alfredang/LahLahVideo#1-minute-install")} />
        </div>
      </Modal>
    );
  }

  const running = progress !== null && !done && !error;

  return (
    <Modal title="Export your video" onClose={close} wide>
      {total <= 0 ? (
        <p>The timeline is empty. Import a clip first.</p>
      ) : (
        <>
          <div className="preset-cards">
            {EXPORT_PRESETS.map((x) => (
              <button type="button" key={x.id} className={preset === x.id ? "on" : ""} onClick={() => pickPreset(x.id)} disabled={running}>
                <span className={`ratio r${x.aspect.replace(":", "x")}`} />
                <b>{x.label}</b>
                <small>{x.hint}</small>
              </button>
            ))}
          </div>
          <div className="export-grid">
            <span className="field-label">Quality</span>
            <Seg<Quality>
              value={quality}
              onChange={setQuality}
              options={[
                { id: "720p", label: "720p", tip: "Smaller file, quick to upload" },
                { id: "1080p", label: "1080p", tip: "Best for TikTok and YouTube" },
                { id: "4k", label: "4K", tip: "Largest file, slow to export" },
              ]}
            />
            <span className="field-label">Frame rate</span>
            <Seg value={String(fps)} onChange={(v) => setFps(Number(v))} options={["24", "30", "60"].map((f) => ({ id: f, label: `${f} fps` }))} />
            <span className="field-label">File name</span>
            <input className="text-field" value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
            <span className="field-label">Save to</span>
            <div className="row">
              <code className="path" title={dir}>
                {dir || "Ask me where"}
              </code>
              <Btn
                label="Change"
                disabled={running}
                onClick={async () => {
                  const chosen = await pickSavePath(dir ? await joinPath(dir, `${safeFileName(name)}.mp4`) : `${safeFileName(name)}.mp4`, "mp4");
                  if (chosen) {
                    setDir(chosen.replace(/[\\/][^\\/]*$/, ""));
                    setName(chosen.replace(/^.*[\\/]/, "").replace(/\.mp4$/i, ""));
                  }
                }}
              />
            </div>
          </div>
          <p className="hint">
            {size.width} × {size.height}, {fps} fps, {fmtTime(total)} long. MP4 (H.264 + AAC) plays on TikTok, YouTube, Instagram and WhatsApp.
          </p>
          {progress !== null && (
            <div className="progress">
              <div className="bar" style={{ width: `${Math.round((done ? 1 : progress) * 100)}%` }} />
              <span>{done ? "Done" : error ? "Stopped" : `${Math.round(progress * 100)}%`}</span>
            </div>
          )}
          {error && (
            <pre className="error-box" title="FFmpeg said">
              {error}
            </pre>
          )}
          {done ? (
            <div className="row wrap">
              <Btn kind="primary" icon="folder" label="Show in folder" onClick={() => reveal(done)} />
              <Btn icon="link" label="Upload to TikTok" onClick={() => openExternal("https://www.tiktok.com/upload")} />
              <Btn icon="link" label="Upload to YouTube" onClick={() => openExternal("https://studio.youtube.com/")} />
              <Btn label="Close" onClick={() => (setProgress(null), close())} />
            </div>
          ) : running ? (
            <div className="row">
              <Btn kind="danger" label="Cancel" onClick={() => job.current?.cancel()} />
            </div>
          ) : (
            <div className="row">
              <Btn kind="primary" big icon="export" label="Export MP4" onClick={go} />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
