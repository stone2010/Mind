import { create } from "zustand";
import { uuid } from "../lib/utils";

export interface ToastItem {
  id: string;
  kind: "info" | "success" | "error";
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = uuid();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    window.setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      toast.kind === "error" ? 7000 : 3200,
    );
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function pushToast(toast: Omit<ToastItem, "id">) {
  useToasts.getState().push(toast);
}
