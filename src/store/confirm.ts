import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  options: ConfirmOptions | null;
  resolver: ((value: boolean) => void) | null;
  ask: (options: ConfirmOptions) => Promise<boolean>;
  close: (value: boolean) => void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  options: null,
  resolver: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      set({ options, resolver: resolve });
    }),
  close: (value) => {
    get().resolver?.(value);
    set({ options: null, resolver: null });
  },
}));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirm.getState().ask(options);
}
