import { describe, expect, it } from "vitest";
import { cachedSnapshot } from "./store";

describe("cachedSnapshot", () => {
  it("returns the same derived value until the state changes (no useSyncExternalStore render loop)", () => {
    let state = { items: [1, 2, 3] };
    const read = cachedSnapshot(() => state);
    const sel = (s: typeof state) => s.items.filter((n) => n > 1);
    const a = read(sel);
    expect(read(sel)).toBe(a);
    state = { items: [1, 2, 3, 4] };
    const b = read(sel);
    expect(b).not.toBe(a);
    expect(b).toEqual([2, 3, 4]);
  });
});
