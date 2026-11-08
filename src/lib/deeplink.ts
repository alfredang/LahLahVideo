// lahlahvideo:// links: lahlahvideo://command?text=split%20here and lahlahvideo://open?file=/abs/path
export type DeepLink = { kind: "command"; text: string } | { kind: "open"; file: string } | { kind: "unknown"; url: string };

/** Parse a lahlahvideo: URL. Accepts lahlahvideo://open?file=…, lahlahvideo://open/?file=… and lahlahvideo:open?file=…. */
export function parseDeepLink(raw: string): DeepLink {
  const url = raw.trim();
  const m = /^lahlahvideo:(?:\/\/)?([^/?#]+)\/?(?:\?([^#]*))?/i.exec(url);
  if (!m) return { kind: "unknown", url };
  const action = m[1].toLowerCase();
  // Decode by hand so a literal "+" in a file name survives (URLSearchParams turns it into a space).
  const params = new Map<string, string>();
  for (const part of (m[2] ?? "").split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
    let value = eq < 0 ? "" : part.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep the raw value */
    }
    params.set(key.toLowerCase(), value);
  }
  if (action === "command" || action === "cmd" || action === "run") {
    // Commands never need a literal "+", so treat it as a space (form encoding).
    const text = (params.get("text") ?? params.get("q") ?? "").replace(/\+/g, " ").trim();
    return text ? { kind: "command", text } : { kind: "unknown", url };
  }
  if (action === "open") {
    let file = params.get("file") ?? params.get("path") ?? "";
    if (/^file:\/\//i.test(file)) {
      try {
        file = decodeURIComponent(new URL(file).pathname).replace(/^\/([a-zA-Z]:\/)/, "$1");
      } catch {
        /* leave as is */
      }
    }
    return file ? { kind: "open", file } : { kind: "unknown", url };
  }
  return { kind: "unknown", url };
}
