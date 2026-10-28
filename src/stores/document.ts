import { create } from "zustand";

export type ViewMode = "source" | "split" | "preview" | "wysiwyg";

interface DocumentStore {
  path: string | null;
  name: string | null;
  dirty: boolean;
  savedModifiedMs: number | null;
  viewMode: ViewMode;
  cursor: { line: number; column: number };

  setDocument(path: string, name: string, modifiedMs: number): void;
  renameActive(path: string, name: string): void;
  clearDocument(): void;
  markDirty(dirty: boolean): void;
  markSaved(modifiedMs: number): void;
  setViewMode(mode: ViewMode): void;
  setCursor(line: number, column: number): void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  path: null,
  name: null,
  dirty: false,
  savedModifiedMs: null,
  viewMode: "wysiwyg",
  cursor: { line: 1, column: 1 },

  setDocument(path, name, modifiedMs) {
    set({
      path,
      name,
      dirty: false,
      savedModifiedMs: modifiedMs,
      cursor: { line: 1, column: 1 },
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
}));
