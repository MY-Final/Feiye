import { create } from "zustand";

import {
  sameFormatState,
  type FormatState,
} from "../features/editor/formatting";

const EMPTY_FORMAT: FormatState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  heading: 0,
  quote: false,
  list: "none",
  codeBlock: false,
  math: "none",
  table: false,
  canUndo: false,
  canRedo: false,
};

interface EditorStore {
  format: FormatState;
  selectedWords: number;
  setFormat(next: FormatState): void;
  setSelectedWords(words: number): void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  format: EMPTY_FORMAT,
  selectedWords: 0,

  setFormat(next) {
    set((state) =>
      sameFormatState(state.format, next) ? state : { format: next },
    );
  },

  setSelectedWords(words) {
    set((state) =>
      state.selectedWords === words ? state : { selectedWords: words },
    );
  },
}));
