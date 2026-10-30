import { create } from "zustand";

import type { OutlineHeading } from "../features/editor/outline";

interface OutlineStore {
  headings: OutlineHeading[];
  /** 预览区滚动时位于顶部附近的标题下标；非预览模式为 null。 */
  scrollIndex: number | null;
  setHeadings(headings: OutlineHeading[]): void;
  setScrollIndex(index: number | null): void;
  clear(): void;
}

function sameHeadings(
  a: OutlineHeading[],
  b: OutlineHeading[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (heading, index) =>
      heading.id === b[index].id &&
      heading.level === b[index].level &&
      heading.text === b[index].text &&
      heading.line === b[index].line,
  );
}

export const useOutlineStore = create<OutlineStore>((set, get) => ({
  headings: [],
  scrollIndex: null,

  setHeadings(headings) {
    if (sameHeadings(get().headings, headings)) return;
    set({ headings });
  },

  setScrollIndex(index) {
    if (get().scrollIndex === index) return;
    set({ scrollIndex: index });
  },

  clear() {
    if (get().headings.length === 0 && get().scrollIndex === null) return;
    set({ headings: [], scrollIndex: null });
  },
}));
