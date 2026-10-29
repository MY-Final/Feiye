import { create } from "zustand";

import { EMPTY_TEXT_STATS, type TextStats } from "../lib/text-stats";

export type ViewMode = "source" | "split" | "preview" | "wysiwyg";

interface DocumentStore {
  path: string | null;
  name: string | null;
  dirty: boolean;
  saving: boolean;
  /** 自动保存因冲突或 I/O 错误暂停时的说明。 */
  saveBlocked: string | null;
  savedModifiedMs: number | null;
  viewMode: ViewMode;
  cursor: { line: number; column: number };
  stats: TextStats;

  setDocument(path: string, name: string, modifiedMs: number): void;
  renameActive(path: string, name: string): void;
  clearDocument(): void;
  markDirty(dirty: boolean): void;
  markSaved(modifiedMs: number, keepDirty?: boolean): void;
  setSaving(saving: boolean): void;
  markSaveBlocked(message: string | null): void;
  setViewMode(mode: ViewMode): void;
  setCursor(line: number, column: number): void;
  setStats(stats: TextStats): void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  path: null,
  name: null,
  dirty: false,
  saving: false,
  saveBlocked: null,
  savedModifiedMs: null,
  viewMode: "wysiwyg",
  cursor: { line: 1, column: 1 },
  stats: EMPTY_TEXT_STATS,

  setDocument(path, name, modifiedMs) {
    set({
      path,
      name,
      dirty: false,
      saving: false,
      saveBlocked: null,
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
      saving: false,
      saveBlocked: null,
      savedModifiedMs: null,
      cursor: { line: 1, column: 1 },
      stats: EMPTY_TEXT_STATS,
    });
  },

  markDirty(dirty) {
    set((state) =>
      state.dirty === dirty
        ? state
        : { dirty, saveBlocked: dirty ? state.saveBlocked : null },
    );
  },

  markSaved(modifiedMs, keepDirty = false) {
    set({
      dirty: keepDirty,
      saving: false,
      saveBlocked: null,
      savedModifiedMs: modifiedMs,
    });
  },

  setSaving(saving) {
    set({ saving });
  },

  markSaveBlocked(message) {
    set({ saveBlocked: message });
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
