import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "ok" | "error";
}

let toasts: Toast[] = [];
const subs = new Set<() => void>();
let next = 1;

export function toast(text: string, tone: Toast["tone"] = "info", ms = 3200) {
  const t = { id: next++, text, tone };
  toasts = [...toasts.slice(-3), t];
  subs.forEach((s) => s());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    subs.forEach((s) => s());
  }, ms);
}

export function useToasts() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => toasts,
  );
}
