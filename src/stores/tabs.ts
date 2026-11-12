import { create } from "zustand";

import { useSettingsStore } from "./settings";

export interface DocumentTab {
  path: string;
  name: string;
}

interface TabsStore {
  tabs: DocumentTab[];
  /** 返回因超出上限而被挤掉的最旧标签；未发生挤占时返回 null。 */
  addTab(path: string, name: string): DocumentTab | null;
  removeTab(path: string): void;
  /** 文件或目录改名 / 移动后同步标签路径；newPath 为 null 时移除。 */
  remap(oldPath: string, newPath: string | null): void;
  clear(): void;
}

/** 默认上限（设置里可选 8 / 12 / 20）；偏好加载或改动后同步为当前值，挤占提示据此显示。 */
export let MAX_TABS = 12;

// 设置里调整上限时即时同步；调低后已开的标签不动，等下一次 addTab 收敛。
useSettingsStore.subscribe((state) => {
  MAX_TABS = state.preferences.maxTabs;
});

function nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * 多标签只记录「打开了哪些笔记」，当前文档仍由 document store 持有；
 * 不落盘，重启后从上次打开的笔记重新开始。
 */
export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],

  addTab(path, name) {
    const state = get();
    const existing = state.tabs.find((tab) => tab.path === path);
    if (existing) {
      if (existing.name !== name) {
        set({
          tabs: state.tabs.map((tab) =>
            tab.path === path ? { ...tab, name } : tab,
          ),
        });
      }
      return null;
    }
    // 标签太多时先关掉最久没打开的那些（当前文档所在标签除外），
    // 把最早被挤掉的标签交给调用方提示，别让它无声消失。
    const tabs = [...state.tabs, { path, name }];
    let evicted: DocumentTab | null = null;
    if (tabs.length > MAX_TABS) {
      evicted = tabs.shift() ?? null;
      // 上限被调低时，下一次打开就一次收敛到新上限。
      while (tabs.length > MAX_TABS) tabs.shift();
    }
    set({ tabs });
    return evicted;
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
