import { create } from "zustand";

import { setSetting } from "../lib/tauri";

export type ToastKind = "info" | "error" | "success";

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  /** 点提示时执行的附加动作（例如在资源管理器中显示刚导出的文件）。 */
  action?: () => void;
  /** 动作提示的悬停说明；不传沿用「在资源管理器中显示」。 */
  actionTitle?: string;
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
  /** 打开对话框前焦点在哪：关掉后还回去，文件树里的键盘操作不会断档。 */
  restoreFocus?: HTMLElement | null;
}

export interface PromptRequest {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  /** 聚焦时只选中主文件名，保留扩展名，重命名时不用连 `.md` 一起重敲。 */
  selectBaseName?: boolean;
  validate?: (value: string) => string | null;
  resolve: (value: string | null) => void;
  restoreFocus?: HTMLElement | null;
}

interface UiStore {
  sidebarVisible: boolean;
  /** 专注模式：临时收起侧栏和工具栏，只为写作让路，不写入偏好。 */
  zenMode: boolean;
  settingsOpen: boolean;
  /** 命令面板（Ctrl+Shift+P）。 */
  paletteOpen: boolean;
  /** 侧栏「搜索」标签的打开请求；每 +1 就切过去并聚焦输入框。 */
  searchRequest: number;
  /** 文档历史（保存快照）面板。 */
  historyOpen: boolean;
  /** 分屏对照：右侧并排预览另一篇笔记。 */
  splitOpen: boolean;
  splitPath: string | null;
  toasts: ToastItem[];
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
  toggleSidebar(): void;
  setSidebarVisible(visible: boolean): void;
  toggleZenMode(): void;
  openSettings(): void;
  closeSettings(): void;
  toggleSettings(): void;
  openPalette(): void;
  closePalette(): void;
  openSearchPanel(): void;
  openHistory(): void;
  closeHistory(): void;
  toggleSplitPreview(): void;
  closeSplitPreview(): void;
  setSplitPath(path: string | null): void;
  toast(
    message: string,
    kind?: ToastKind,
    action?: () => void,
    actionTitle?: string,
  ): void;
  dismissToast(id: number): void;
  ask(options: Omit<ConfirmRequest, "resolve">): Promise<string>;
  resolveConfirm(value: string): void;
  askInput(options: Omit<PromptRequest, "resolve">): Promise<string | null>;
  resolvePrompt(value: string | null): void;
}

let toastId = 0;

/** 每条提示的自动消失计时器，悬停暂停和手动关闭都要能取消它。 */
const toastTimers = new Map<number, number>();

function armToastTimer(id: number, kind: ToastKind): void {
  window.clearTimeout(toastTimers.get(id));
  toastTimers.set(
    id,
    window.setTimeout(
      () => {
        useUiStore.getState().dismissToast(id);
      },
      kind === "error" ? 6000 : 3000,
    ),
  );
}

/** 鼠标停在提示上时暂停倒计时，看清楚再让它走。 */
export function pauseToast(id: number): void {
  window.clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
}

export function resumeToast(id: number, kind: ToastKind): void {
  armToastTimer(id, kind);
}

export const useUiStore = create<UiStore>((set, get) => ({
  sidebarVisible: true,
  zenMode: false,
  settingsOpen: false,
  paletteOpen: false,
  searchRequest: 0,
  historyOpen: false,
  splitOpen: false,
  splitPath: null,
  toasts: [],
  confirm: null,
  prompt: null,

  toggleSidebar() {
    const visible = !get().sidebarVisible;
    set({ sidebarVisible: visible });
    // 侧栏开合是长期偏好，下次启动沿用。
    void setSetting("sidebarVisible", visible);
  },

  setSidebarVisible(visible) {
    set({ sidebarVisible: visible });
    void setSetting("sidebarVisible", visible);
  },

  toggleZenMode() {
    const zenMode = !get().zenMode;
    set({ zenMode });
    // 只是这一次的阅读 / 写作状态，不落盘：下次启动还是常规布局。
    // 进入时顺带说一句怎么退出来，免得找不到工具栏。
    get().toast(
      zenMode ? "专注模式：Ctrl + Shift + F 退出" : "已退出专注模式",
    );
  },

  openSettings() {
    set({ settingsOpen: true });
  },

  closeSettings() {
    set({ settingsOpen: false });
  },

  toggleSettings() {
    set((state) => ({ settingsOpen: !state.settingsOpen }));
  },

  openPalette() {
    set({ paletteOpen: true });
  },

  closePalette() {
    set({ paletteOpen: false });
  },

  openSearchPanel() {
    set((state) => ({
      sidebarVisible: true,
      searchRequest: state.searchRequest + 1,
    }));
    void setSetting("sidebarVisible", true);
  },

  openHistory() {
    set({ historyOpen: true });
  },

  closeHistory() {
    set({ historyOpen: false });
  },

  toggleSplitPreview() {
    set((state) => ({ splitOpen: !state.splitOpen }));
  },

  closeSplitPreview() {
    set({ splitOpen: false });
  },

  setSplitPath(path) {
    set({ splitPath: path });
  },

  toast(message, kind = "info", action, actionTitle) {
    const id = ++toastId;
    set((state) => {
      const next = [
        ...state.toasts,
        { id, message, kind, action, actionTitle },
      ];
      // 最多同时留 3 条：连着操作几次也不会堆成一列糊住状态栏，
      // 被挤掉的旧提示计时器一并清掉。
      while (next.length > 3) {
        const dropped = next.shift();
        if (!dropped) break;
        window.clearTimeout(toastTimers.get(dropped.id));
        toastTimers.delete(dropped.id);
      }
      return { toasts: next };
    });
    armToastTimer(id, kind);
  },

  dismissToast(id) {
    window.clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },

  ask(options) {
    return new Promise<string>((resolve) => {
      const active = document.activeElement;
      set({
        confirm: {
          ...options,
          resolve,
          restoreFocus: active instanceof HTMLElement ? active : null,
        },
      });
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
      const active = document.activeElement;
      set({
        prompt: {
          ...options,
          resolve,
          restoreFocus: active instanceof HTMLElement ? active : null,
        },
      });
    });
  },

  resolvePrompt(value) {
    const { prompt } = get();
    if (!prompt) return;
    set({ prompt: null });
    prompt.resolve(value);
  },
}));
