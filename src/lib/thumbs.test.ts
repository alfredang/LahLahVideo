import { describe, expect, it, vi } from "vitest";

vi.mock("./platform", () => ({
  isDesktop: true,
  ffmpegThumb: vi.fn(async (path: string) => `asset://thumbs/${path.split("/").pop()}.jpg`),
}));

import { store } from "./store";
import { fillMissingThumbs } from "./thumbs";
import { ffmpegThumb } from "./platform";

describe("fillMissingThumbs", () => {
  it("re-makes video thumbnails lost on save/reopen, without an undo step", async () => {
    const s = store.get();
    const media = [
      { id: "a", name: "S01.mp4", kind: "video" as const, url: "x", duration: 5, path: "/clips/S01.mp4", origin: "handoff" as const },
      { id: "b", name: "S02.mp4", kind: "video" as const, url: "x", duration: 5, path: "/clips/S02.mp4", thumb: "asset://kept.jpg", origin: "handoff" as const },
    ];
    store.set({ ...s, project: { ...s.project, media } });
    fillMissingThumbs();
    await vi.waitFor(() => expect(store.get().project.media[0].thumb).toBe("asset://thumbs/S01.mp4.jpg"));
    expect(store.get().project.media[1].thumb).toBe("asset://kept.jpg");
    expect(ffmpegThumb).toHaveBeenCalledTimes(1);
    expect(store.get().past).toEqual(s.past);
  });
});
