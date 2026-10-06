import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error" | "warning";
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: Toast["kind"], ttl?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(message, kind = "info", ttl = 4000) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind }] }));
    if (ttl > 0) setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttl);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = (message: string, kind?: Toast["kind"], ttl?: number) => useToasts.getState().push(message, kind, ttl);
