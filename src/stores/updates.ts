import { create } from "zustand";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdateState {
  /** 更新对话框是否打开。 */
  open: boolean;
  phase: UpdatePhase;
  version: string | null;
  /** 发布说明，已压成几行纯文本。 */
  notes: string | null;
  /** 下载进度 0–1；总大小未知时为 null。 */
  progress: number | null;
  error: string | null;
}

export const useUpdateStore = create<UpdateState>(() => ({
  open: false,
  phase: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
}));
