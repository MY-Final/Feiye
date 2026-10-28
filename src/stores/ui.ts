import { create } from "zustand";

export type ToastKind = "info" | "error" | "success";

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ConfirmButton {
  label: string;
  value: string;
  tone?: "primary" | "danger" | "default";
}

export interface ConfirmRequest {
  title: string;
  message?: string;
  buttons: ConfirmButton[];
  resolve: (value: string) => void;
}

export interface PromptRequest {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  resolve: (value: string | null) => void;
}

interface UiStore {
  sidebarVisible: boolean;
  toasts: ToastItem[];
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
  toggleSidebar(): void;
  setSidebarVisible(visible: boolean): void;
  toast(message: string, kind?: ToastKind): void;
  dismissToast(id: number): void;
  ask(options: Omit<ConfirmRequest, "resolve">): Promise<string>;
  resolveConfirm(value: string): void;
  askInput(options: Omit<PromptRequest, "resolve">): Promise<string | null>;
  resolvePrompt(value: string | null): void;
}

let toastId = 0;

export const useUiStore = create<UiStore>((set, get) => ({
  sidebarVisible: true,
  toasts: [],
  confirm: null,
  prompt: null,

  toggleSidebar() {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }));
  },

  setSidebarVisible(visible) {
    set({ sidebarVisible: visible });
  },

  toast(message, kind = "info") {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }));
    window.setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 3000);
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },

  ask(options) {
    return new Promise<string>((resolve) => {
      set({ confirm: { ...options, resolve } });
    });
  },

  resolveConfirm(value) {
    const { confirm } = get();
    if (!confirm) return;
    set({ confirm: null });
    confirm.resolve(value);
  },

  askInput(options) {
    return new Promise<string | null>((resolve) => {
      set({ prompt: { ...options, resolve } });
    });
  },

  resolvePrompt(value) {
    const { prompt } = get();
    if (!prompt) return;
    set({ prompt: null });
    prompt.resolve(value);
  },
}));
