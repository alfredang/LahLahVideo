// Voice-over from the microphone. The timeline plays (muted) while you talk,
// and the recording lands on the Voice-over track where you started.
import { useSyncExternalStore } from "react";
import { apply, clock, pause, play, project, seek } from "./store";
import { addMediaToTimeline, firstTrackOfType, touch, updateClip } from "./project";
import { cacheDir, isDesktop, joinPath, mediaFromPath, writeBinary } from "./platform";
import { uid } from "./project";
import { toast } from "./toast";
import { MediaItem } from "./types";

let state = { recording: false, since: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
export function useRecorder() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );
}
export const isRecording = () => state.recording;

let rec: MediaRecorder | null = null;
let chunks: Blob[] = [];
let startAt = 0;

export async function toggleVoiceOver() {
  if (state.recording) return stop();
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    toast("This window cannot reach the microphone. Update your OS, or record on your phone and import the file.", "error", 7000);
    return;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    toast(
      isDesktop
        ? "Microphone blocked. Mac: System Settings > Privacy & Security > Microphone > turn on LahLah Video. Windows: Settings > Privacy > Microphone."
        : "Microphone blocked. Allow it in the browser's address bar.",
      "error",
      9000,
    );
    return;
  }
  const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
  rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    void finish(rec?.mimeType || type);
  };
  startAt = clock.get().t;
  rec.start(250);
  state = { recording: true, since: Date.now() };
  emit();
  play();
  toast("Recording… press R or click Stop when you finish", "info");
}

function stop() {
  pause();
  rec?.stop();
  state = { recording: false, since: 0 };
  emit();
}

async function finish(mime: string) {
  const blob = new Blob(chunks, { type: mime || "audio/webm" });
  if (blob.size < 2000) {
    toast("That recording was empty", "error");
    return;
  }
  const ext = mime.includes("mp4") ? "m4a" : "webm";
  let media: MediaItem | null;
  if (isDesktop) {
    const path = await joinPath(await cacheDir("recordings"), `voiceover-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`);
    await writeBinary(path, new Uint8Array(await blob.arrayBuffer()));
    media = await mediaFromPath(path, "recording");
  } else {
    const url = URL.createObjectURL(blob);
    const dur = await new Promise<number>((res) => {
      const a = new Audio();
      a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : (Date.now() - state.since) / 1000);
      a.onerror = () => res(3);
      a.src = url;
    });
    media = { id: uid("med"), name: `Voice-over.${ext}`, kind: "audio", url, duration: dur || 3, origin: "recording" };
  }
  if (!media) return;
  const p = project();
  const voice = p.tracks.filter((t) => t.type === "audio")[1] ?? firstTrackOfType(p, "audio")!;
  const withMedia = touch({ ...p, media: [...p.media, media] });
  const r = addMediaToTimeline(withMedia, media, { trackId: voice.id, at: startAt });
  apply(() => updateClip(r.project, r.clip.id, { audioRole: "vo" }));
  seek(startAt);
  toast("Voice-over added. Music ducks under it on export.", "ok");
}
