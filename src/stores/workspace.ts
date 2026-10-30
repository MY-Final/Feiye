import { create } from "zustand";

import {
  describeError,
  getSetting,
  listDir,
  setSetting,
  type Entry,
  type WorkspaceInfo,
} from "../lib/tauri";
import { useUiStore } from "./ui";

const EXPANDED_KEY = "expandedDirs";

/** 各工作区上次展开的目录；第一次读取后常驻，避免反复读盘。 */
let expandedByRoot: Record<string, string[]> | null = null;

async function readExpandedMap(): Promise<Record<string, string[]>> {
  if (expandedByRoot) return expandedByRoot;

  const raw = await getSetting<unknown>(EXPANDED_KEY);
  const map: Record<string, string[]> = {};
  if (raw && typeof raw === "object") {
    for (const [root, paths] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(paths)) {
        map[root] = paths.filter(
          (path): path is string => typeof path === "string",
        );
      }
    }
  }
  expandedByRoot = map;
  return map;
}

function persistExpanded(
  root: string | null,
  expanded: Record<string, boolean>,
): void {
  if (!root) return;
  const openPaths = Object.keys(expanded).filter((path) => expanded[path]);
  void (async () => {
    const map = await readExpandedMap();
    expandedByRoot = { ...map, [root]: openPaths };
    await setSetting(EXPANDED_KEY, expandedByRoot);
  })();
}

/** 打开工作区后恢复上次展开的目录；失效目录静默跳过。 */
async function restoreExpanded(root: string): Promise<void> {
  const map = await readExpandedMap();
  if (useWorkspaceStore.getState().root !== root) return;

  const paths = map[root] ?? [];
  if (paths.length === 0) return;

  const expanded: Record<string, boolean> = {};
  for (const path of paths) expanded[path] = true;
  useWorkspaceStore.setState({ expanded });
  await Promise.all(
    paths.map((path) => useWorkspaceStore.getState().loadDir(path, true)),
  );
}

const RECENT_KEY = "recentDocuments";
const RECENT_LIMIT = 5;

/** 各工作区最近打开的文档；同样只在第一次读取后常驻。 */
let recentByRoot: Record<string, string[]> | null = null;

async function readRecentMap(): Promise<Record<string, string[]>> {
  if (recentByRoot) return recentByRoot;

  const raw = await getSetting<unknown>(RECENT_KEY);
  const map: Record<string, string[]> = {};
  if (raw && typeof raw === "object") {
    for (const [root, paths] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(paths)) {
        map[root] = paths.filter(
          (path): path is string => typeof path === "string",
        );
      }
    }
  }
  recentByRoot = map;
  return map;
}

function persistRecent(root: string | null, paths: string[]): void {
  if (!root) return;
  void (async () => {
    const map = await readRecentMap();
    recentByRoot = { ...map, [root]: paths };
    await setSetting(RECENT_KEY, recentByRoot);
  })();
}

async function restoreRecent(root: string): Promise<void> {
  const map = await readRecentMap();
  if (useWorkspaceStore.getState().root !== root) return;
  useWorkspaceStore.setState({ recent: map[root] ?? [] });
}

interface WorkspaceStore {
  root: string | null;
  name: string | null;
  children: Record<string, Entry[]>;
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  /** 当前工作区最近打开的文档，最新的在前。 */
  recent: string[];

  setWorkspace(info: WorkspaceInfo | null): void;
  noteRecent(relPath: string): void;
  loadDir(relPath: string, silent?: boolean): Promise<void>;
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
  recent: [],
  ...EMPTY_MAPS,

  setWorkspace(info) {
    set({
      root: info?.root ?? null,
      name: info?.name ?? null,
      recent: [],
      ...EMPTY_MAPS,
    });
    if (info) {
      void restoreExpanded(info.root);
      void restoreRecent(info.root);
    }
  },

  noteRecent(relPath) {
    const root = get().root;
    if (!root) return;
    const next = [
      relPath,
      ...get().recent.filter((path) => path !== relPath),
    ].slice(0, RECENT_LIMIT);
    set({ recent: next });
    persistRecent(root, next);
  },

  async loadDir(relPath, silent = false) {
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
      if (silent) return;
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
    persistExpanded(get().root, {});
  },

  async toggleDir(relPath) {
    const expanded = get().expanded[relPath];
    if (expanded) {
      const next = { ...get().expanded, [relPath]: false };
      set({ expanded: next });
      persistExpanded(get().root, next);
      return;
    }
    await get().expandDir(relPath);
  },

  async expandDir(relPath) {
    const next = { ...get().expanded, [relPath]: true };
    set({ expanded: next });
    persistExpanded(get().root, next);
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
