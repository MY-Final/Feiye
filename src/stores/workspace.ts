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
  // 与当前状态合并：目录改名后会先把展开状态改成新路径，不能被旧列表覆盖。
  useWorkspaceStore.setState((state) => ({
    expanded: { ...expanded, ...state.expanded },
  }));
  await Promise.all(
    paths.map((path) => useWorkspaceStore.getState().loadDir(path, true)),
  );
}

const RECENT_KEY = "recentDocuments";
const RECENT_LIMIT = 5;
/** 浏览历史只留最近 50 步，足够读完一长串链接；不落盘，随会话结束清空。 */
const HISTORY_LIMIT = 50;

/** 文件 / 目录改名、移动或删除后，把旧前缀换成新前缀；`nextPath` 为 null 时移除。 */
function remapPath(
  path: string,
  oldPath: string,
  nextPath: string | null,
): string | null {
  if (path === oldPath) return nextPath;
  if (!path.startsWith(`${oldPath}/`)) return path;
  return nextPath === null ? null : `${nextPath}${path.slice(oldPath.length)}`;
}

/** 批量重映射；没有变化时返回原数组，避免无谓的状态更新与落盘。 */
function remapPaths(
  paths: string[],
  oldPath: string,
  nextPath: string | null,
): string[] {
  const next = paths
    .map((path) => remapPath(path, oldPath, nextPath))
    .filter((path): path is string => path !== null);
  if (
    next.length === paths.length &&
    next.every((path, index) => path === paths[index])
  ) {
    return paths;
  }
  return next;
}

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
  /** 读取失败的目录：树里给出重试入口，而不是留一块空白。 */
  failed: Record<string, boolean>;
  /** 当前工作区最近打开的文档，最新的在前。 */
  recent: string[];
  /**
   * 本次会话的浏览历史：每打开一篇就把上一篇压栈，「返回」逐级退回，
   * 而不是在最近两篇之间来回切换。换库时清空。
   */
  history: string[];
  /**
   * 「前进」栈：后退之后还能沿原路走回去。只有「返回」会往里放，
   * 任何一次新的打开都会清空它，避免把旧分支混进来。
   */
  forward: string[];

  setWorkspace(info: WorkspaceInfo | null): void;
  noteRecent(relPath: string): void;
  pushHistory(relPath: string): void;
  /** 弹掉栈顶并返回它；历史为空时返回 null。 */
  popHistory(): string | null;
  /** 文件已读不到时，把它从浏览历史里摘掉，避免反复退回同一处报错。 */
  forgetHistory(relPath: string): void;
  pushForward(relPath: string): void;
  popForward(): string | null;
  /** 前进目标已读不到时摘掉它，避免每次 Alt+→ 都重试同一条失效路径。 */
  forgetForward(relPath: string): void;
  clearForward(): void;
  /** 重命名或删除后同步「最近打开」，避免留下打不开的旧路径。 */
  updateRecent(oldPath: string, nextPath: string | null): void;
  /** 同上，同步浏览历史与前进栈：改名后「返回」仍能找到那篇笔记。 */
  remapHistory(oldPath: string, nextPath: string | null): void;
  /** 一键清空最近打开；只影响历史列表，不动磁盘文件。返回清空前的列表以便撤销。 */
  clearRecent(): string[];
  /** 撤销清空：把之前的列表放回去并落盘。 */
  restoreRecent(paths: string[]): void;
  loadDir(relPath: string, silent?: boolean): Promise<void>;
  refreshDir(relPath: string): Promise<void>;
  refreshTree(): Promise<void>;
  toggleDir(relPath: string): Promise<void>;
  invalidateDir(relPath: string): void;
  expandDir(relPath: string): Promise<void>;
  /** 批量展开目录并只持久化一次；用于目录改名后恢复展开状态。 */
  expandDirs(relPaths: string[]): Promise<void>;
  collapseAll(): void;
}

/**
 * 工作区代号：换库（含重建树）时递增。目录读取是异步的，
 * 先发起的结果可能在切库后才回来，不能写进新库的树里。
 */
let workspaceSeq = 0;

const EMPTY_MAPS = {
  children: {} as Record<string, Entry[]>,
  expanded: {} as Record<string, boolean>,
  loading: {} as Record<string, boolean>,
  failed: {} as Record<string, boolean>,
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  root: null,
  name: null,
  recent: [],
  history: [],
  forward: [],
  ...EMPTY_MAPS,

  setWorkspace(info) {
    workspaceSeq += 1;
    set({
      root: info?.root ?? null,
      name: info?.name ?? null,
      recent: [],
      history: [],
      forward: [],
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

  pushHistory(relPath) {
    const current = get().history;
    if (current[current.length - 1] === relPath) return;
    set({ history: [...current, relPath].slice(-HISTORY_LIMIT) });
  },

  popHistory() {
    const current = get().history;
    if (current.length === 0) return null;
    set({ history: current.slice(0, -1) });
    return current[current.length - 1];
  },

  forgetHistory(relPath) {
    const current = get().history;
    if (!current.includes(relPath)) return;
    set({ history: current.filter((path) => path !== relPath) });
  },

  pushForward(relPath) {
    const current = get().forward;
    if (current[current.length - 1] === relPath) return;
    set({ forward: [...current, relPath].slice(-HISTORY_LIMIT) });
  },

  popForward() {
    const current = get().forward;
    if (current.length === 0) return null;
    set({ forward: current.slice(0, -1) });
    return current[current.length - 1];
  },

  forgetForward(relPath) {
    const current = get().forward;
    if (!current.includes(relPath)) return;
    set({ forward: current.filter((path) => path !== relPath) });
  },

  clearForward() {
    if (get().forward.length === 0) return;
    set({ forward: [] });
  },

  updateRecent(oldPath, nextPath) {
    const root = get().root;
    if (!root) return;
    const current = get().recent;
    // 目录改名 / 删除时，它下面的最近文档也要一起换前缀或移除。
    const next = remapPaths(current, oldPath, nextPath);
    if (next === current) return;
    set({ recent: next });
    persistRecent(root, next);
  },

  remapHistory(oldPath, nextPath) {
    const { history, forward } = get();
    const nextHistory = remapPaths(history, oldPath, nextPath);
    const nextForward = remapPaths(forward, oldPath, nextPath);
    if (nextHistory === history && nextForward === forward) return;
    set({ history: nextHistory, forward: nextForward });
  },

  clearRecent() {
    const root = get().root;
    const previous = get().recent;
    if (!root || previous.length === 0) return previous;
    set({ recent: [] });
    persistRecent(root, []);
    return previous;
  },

  restoreRecent(paths) {
    const root = get().root;
    if (!root) return;
    const next = paths.slice(0, RECENT_LIMIT);
    set({ recent: next });
    persistRecent(root, next);
  },

  async loadDir(relPath, silent = false) {
    if (get().loading[relPath]) return;
    const seq = workspaceSeq;
    set((state) => ({ loading: { ...state.loading, [relPath]: true } }));

    try {
      const entries = await listDir(relPath);
      // 读取期间切了库：这份目录属于旧库，丢掉而不是写进新库的树。
      if (seq !== workspaceSeq) return;
      set((state) => ({
        children: { ...state.children, [relPath]: entries },
        loading: { ...state.loading, [relPath]: false },
        failed: { ...state.failed, [relPath]: false },
      }));
    } catch (error) {
      if (seq !== workspaceSeq) return;
      set((state) => ({
        loading: { ...state.loading, [relPath]: false },
        failed: { ...state.failed, [relPath]: true },
      }));
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
    const { expanded, children, loading } = get();
    const dirs: string[] = loading[""] ? [] : [""];
    for (const [relPath, open] of Object.entries(expanded)) {
      // 正在加载的目录跳过：refreshDir 会先清空子项，
      // 与进行中的 loadDir 撞车会留下空目录。
      if (open && children[relPath] && !loading[relPath]) {
        dirs.push(relPath);
      }
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

  async expandDirs(relPaths) {
    if (relPaths.length === 0) return;
    const expanded = { ...get().expanded };
    for (const relPath of relPaths) expanded[relPath] = true;
    set({ expanded });
    persistExpanded(get().root, expanded);
    await Promise.all(
      relPaths.map((relPath) => get().loadDir(relPath, true)),
    );
  },

  invalidateDir(relPath) {
    set((state) => {
      const children = { ...state.children };
      delete children[relPath];
      return { children };
    });
  },
}));
