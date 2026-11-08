import fs from "node:fs/promises";

const TIMESTAMP_RE =
  /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/g;

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return (
    parseInt(h, 10) * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms, 10) / 1000
  );
}

/**
 * Reads the VTT file edge-tts produces alongside an MP3 and returns the end
 * timestamp of the last cue — which equals the audio duration in seconds.
 */
export async function measureAudioFromVtt(vttPath: string): Promise<number> {
  const text = await fs.readFile(vttPath, "utf8");
  let lastEnd = 0;
  for (const match of text.matchAll(TIMESTAMP_RE)) {
    const [, , , , , eH, eM, eS, eMs] = match;
    const end = toSeconds(eH, eM, eS, eMs);
    if (end > lastEnd) lastEnd = end;
  }
  if (lastEnd <= 0) {
    throw new Error(`Could not parse any cues from ${vttPath}`);
  }
  return lastEnd;
}
