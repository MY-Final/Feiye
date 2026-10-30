import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { getSetting, setSetting } from "../../lib/tauri";

export interface WindowControlsState {
  available: boolean;
  maximized: boolean;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  requestClose(): Promise<void>;
}

export function useWindowControls(): WindowControlsState {
  const available = isTauri();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!available) return;

    const window_ = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 上次已知的最大化状态；只在变化时写设置，避免每次缩放都落盘。
    let persisted: boolean | null = null;
    let ready = false;

    const sync = () => {
      void window_
        .isMaximized()
        .then((value) => {
          if (disposed) return;
          setMaximized(value);
          if (ready && value !== persisted) {
            persisted = value;
            void setSetting("windowMaximized", value);
          }
        })
        .catch(() => {
          // 权限或窗口已销毁时保持原状态。
        });
    };

    // 上次退出时是最大化的话，这次打开也直接最大化。
    // 读到旧值之前不落盘，免得把还没读到的 true 覆盖成 false。
    void getSetting<boolean>("windowMaximized").then((saved) => {
      if (disposed) return;
      persisted = typeof saved === "boolean" ? saved : null;
      ready = true;
      if (!saved) return;
      void window_
        .isMaximized()
        .then((value) => {
          // 只授权了 toggle-maximize，先看当前状态再决定要不要切。
          if (!disposed && !value) return window_.toggleMaximize();
          return undefined;
        })
        .catch(() => {
          // 权限不足时保持默认窗口大小。
        });
    });

    sync();
    void window_
      .onResized(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(sync, 60);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, [available]);

  return {
    available,
    maximized,

    async minimize() {
      if (!available) return;
      try {
        await getCurrentWindow().minimize();
      } catch {
        // 忽略窗口已关闭等边界情况。
      }
    },

    async toggleMaximize() {
      if (!available) return;
      try {
        await getCurrentWindow().toggleMaximize();
        const value = await getCurrentWindow().isMaximized();
        setMaximized(value);
      } catch {
        // 忽略权限或窗口状态变化。
      }
    },

    async requestClose() {
      if (!available) return;
      try {
        // close 会触发 onCloseRequested，进而走未保存守卫。
        await getCurrentWindow().close();
      } catch {
        // 关闭被守卫拦截时属于正常情况。
      }
    },
  };
}
