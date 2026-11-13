// Video thumbnails are file URLs and are not saved in the project file, so after opening a
// project or restoring the auto-save every video card was a blank play icon. Re-make the
// missing ones in the background (cached per source file, so this is quick after the first time).
import { store } from "./store";
import { ffmpegThumb, isDesktop } from "./platform";

const busy = new Set<string>();
const failed = new Set<string>();

export function fillMissingThumbs() {
  if (!isDesktop) return;
  for (const m of store.get().project.media) {
    if (m.kind !== "video" || m.thumb || !m.path || busy.has(m.path) || failed.has(m.path)) continue;
    const path = m.path;
    busy.add(path);
    ffmpegThumb(path)
      .then((thumb) => {
        if (!thumb) return void failed.add(path);
        const s = store.get();
        if (!s.project.media.some((x) => x.path === path && !x.thumb)) return;
        // Not an edit: no undo step, no "unsaved changes".
        store.set({ ...s, project: { ...s.project, media: s.project.media.map((x) => (x.path === path && !x.thumb ? { ...x, thumb } : x)) } });
      })
      .catch(() => failed.add(path))
      .finally(() => busy.delete(path));
  }
}

/** Watch the media list and fill thumbnails whenever it changes. Returns the unsubscribe. */
export function startThumbWatcher(): () => void {
  let last = store.get().project.media;
  fillMissingThumbs();
  return store.subscribe(() => {
    const media = store.get().project.media;
    if (media === last) return;
    last = media;
    fillMissingThumbs();
  });
}
