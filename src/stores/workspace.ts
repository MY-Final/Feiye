import { create } from "zustand";

import {
  describeError,
  listDir,
  type Entry,
  type WorkspaceInfo,
} from "../lib/tauri";
import { useUiStore } from "./ui";

interface WorkspaceStore {
  root: string | null;
  name: string | null;
  children: Record<string, Entry[]>;
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;

  setWorkspace(info: WorkspaceInfo | null): void;
  loadDir(relPath: string): Promise<void>;
  refreshDir(relPath: string): Promise<void>;
  refreshTree(): Promise<void>;
  toggleDir(relPath: string): Promise<void>;
  invalidateDir(relPath: string): void;
  expandDir(relPath: string): Promise<void>;
  collapseAll(): void;
}

const EMPTY_MAPS = {
  children: {} as Record<string, Entry[]>,
  expanded: {} as Record<string, boolean>,
  loading: {} as Record<string, boolean>,
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  root: null,
  name: null,
  ...EMPTY_MAPS,

  setWorkspace(info) {
    set({
      root: info?.root ?? null,
      name: info?.name ?? null,
      ...EMPTY_MAPS,
    });
  },

  async loadDir(relPath) {
    if (get().loading[relPath]) return;
    set((state) => ({ loading: { ...state.loading, [relPath]: true } }));

    try {
      const entries = await listDir(relPath);
      set((state) => ({
        children: { ...state.children, [relPath]: entries },
        loading: { ...state.loading, [relPath]: false },
      }));
    } catch (error) {
      set((state) => ({ loading: { ...state.loading, [relPath]: false } }));
      useUiStore.getState().toast(`读取目录失败：${describeError(error)}`, "error");
    }
  },

  async refreshDir(relPath) {
    set((state) => {
      const children = { ...state.children };
      delete children[relPath];
      return { children };
    });
    await get().loadDir(relPath);
  },

  /** 重新读取根目录与所有已展开的目录。 */
  async refreshTree() {
    const { expanded, children } = get();
    const dirs = [""];
    for (const [relPath, open] of Object.entries(expanded)) {
      if (open && children[relPath]) dirs.push(relPath);
    }
    await Promise.all(dirs.map((relPath) => get().refreshDir(relPath)));
  },

  collapseAll() {
    set({ expanded: {} });
  },

  async toggleDir(relPath) {
    const expanded = get().expanded[relPath];
    if (expanded) {
      set((state) => ({ expanded: { ...state.expanded, [relPath]: false } }));
      return;
    }
    await get().expandDir(relPath);
  },

  async expandDir(relPath) {
    set((state) => ({ expanded: { ...state.expanded, [relPath]: true } }));
    if (!get().children[relPath]) {
      await get().loadDir(relPath);
    }
  },

  invalidateDir(relPath) {
    set((state) => {
      const children = { ...state.children };
      delete children[relPath];
      return { children };
    });
  },
}));
