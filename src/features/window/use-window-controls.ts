import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

    const sync = () => {
      void window_
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {
          // 权限或窗口已销毁时保持原状态。
        });
    };

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
