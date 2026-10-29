import { create } from "zustand";

import type { OutlineHeading } from "../features/editor/outline";

interface OutlineStore {
  headings: OutlineHeading[];
  setHeadings(headings: OutlineHeading[]): void;
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

  setHeadings(headings) {
    if (sameHeadings(get().headings, headings)) return;
    set({ headings });
  },

  clear() {
    if (get().headings.length === 0) return;
    set({ headings: [] });
  },
}));
