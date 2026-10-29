import { create } from "zustand";

import { EMPTY_TEXT_STATS, type TextStats } from "../lib/text-stats";

export type ViewMode = "source" | "split" | "preview" | "wysiwyg";

interface DocumentStore {
  path: string | null;
  name: string | null;
  dirty: boolean;
  savedModifiedMs: number | null;
  viewMode: ViewMode;
  cursor: { line: number; column: number };
  stats: TextStats;

  setDocument(path: string, name: string, modifiedMs: number): void;
  renameActive(path: string, name: string): void;
  clearDocument(): void;
  markDirty(dirty: boolean): void;
  markSaved(modifiedMs: number): void;
  setViewMode(mode: ViewMode): void;
  setCursor(line: number, column: number): void;
  setStats(stats: TextStats): void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  path: null,
  name: null,
  dirty: false,
  savedModifiedMs: null,
  viewMode: "wysiwyg",
  cursor: { line: 1, column: 1 },
  stats: EMPTY_TEXT_STATS,

  setDocument(path, name, modifiedMs) {
    set({
      path,
      name,
      dirty: false,
      savedModifiedMs: modifiedMs,
      cursor: { line: 1, column: 1 },
      stats: EMPTY_TEXT_STATS,
    });
  },

  renameActive(path, name) {
    set({ path, name });
  },

  clearDocument() {
    set({
      path: null,
      name: null,
      dirty: false,
      savedModifiedMs: null,
      cursor: { line: 1, column: 1 },
      stats: EMPTY_TEXT_STATS,
    });
  },

  markDirty(dirty) {
    set({ dirty });
  },

  markSaved(modifiedMs) {
    set({ dirty: false, savedModifiedMs: modifiedMs });
  },

  setViewMode(mode) {
    set({ viewMode: mode });
  },

  setCursor(line, column) {
    set({ cursor: { line, column } });
  },

  setStats(stats) {
    set((state) =>
      state.stats.words === stats.words && state.stats.chars === stats.chars
        ? state
        : { stats },
    );
  },
}));
