// WebKit (the macOS app's web view) only lets a media element play with sound if play() was
// first called on that element during a click or key press. Clips that start later in the
// timeline were never clicked, so they would refuse to start and the player would stall.
// Every timeline media element registers here, and the Play gesture unlocks all of them at once.
const elements = new Set<HTMLMediaElement>();
const unlocked = new WeakSet<HTMLMediaElement>();

export function registerMedia(el: HTMLMediaElement): () => void {
  elements.add(el);
  return () => {
    elements.delete(el);
  };
}

export function isUnlocked(el: HTMLMediaElement) {
  return unlocked.has(el);
}

/** Call synchronously inside a click or key handler. Plays every paused element silently, then pauses the ones that should not play yet. */
export function unlockAllMedia() {
  for (const el of elements) {
    if (unlocked.has(el)) continue;
    unlocked.add(el);
    if (!el.paused) continue;
    const volume = el.volume;
    el.volume = 0;
    el.play().then(
      () => {
        if (el.dataset.active !== "1") el.pause();
        el.volume = volume;
      },
      () => {
        el.volume = volume;
        unlocked.delete(el);
      },
    );
  }
}

export const mediaCount = () => elements.size;
