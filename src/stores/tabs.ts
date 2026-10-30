import { create } from "zustand";

export interface DocumentTab {
  path: string;
  name: string;
}

interface TabsStore {
  tabs: DocumentTab[];
  addTab(path: string, name: string): void;
  removeTab(path: string): void;
  /** 文件或目录改名 / 移动后同步标签路径；newPath 为 null 时移除。 */
  remap(oldPath: string, newPath: string | null): void;
  clear(): void;
}

const MAX_TABS = 12;

function nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * 多标签只记录「打开了哪些笔记」，当前文档仍由 document store 持有；
 * 不落盘，重启后从上次打开的笔记重新开始。
 */
export const useTabsStore = create<TabsStore>((set) => ({
  tabs: [],

  addTab(path, name) {
    set((state) => {
      const existing = state.tabs.find((tab) => tab.path === path);
      if (existing) {
        if (existing.name === name) return state;
        return {
          tabs: state.tabs.map((tab) =>
            tab.path === path ? { ...tab, name } : tab,
          ),
        };
      }
      // 标签太多时先关掉最久没打开的那个（当前文档所在标签除外）。
      const tabs = [...state.tabs, { path, name }];
      return { tabs: tabs.slice(-MAX_TABS) };
    });
  },

  removeTab(path) {
    set((state) => ({
      tabs: state.tabs.filter((tab) => tab.path !== path),
    }));
  },

  remap(oldPath, newPath) {
    set((state) => ({
      tabs: state.tabs.flatMap((tab) => {
        if (tab.path !== oldPath && !tab.path.startsWith(`${oldPath}/`)) {
          return [tab];
        }
        if (!newPath) return [];
        const path = `${newPath}${tab.path.slice(oldPath.length)}`;
        return [{ path, name: nameOf(path) }];
      }),
    }));
  },

  clear() {
    set({ tabs: [] });
  },
}));
