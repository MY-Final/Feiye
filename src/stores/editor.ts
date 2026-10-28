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
};

interface EditorStore {
  format: FormatState;
  setFormat(next: FormatState): void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  format: EMPTY_FORMAT,

  setFormat(next) {
    set((state) =>
      sameFormatState(state.format, next) ? state : { format: next },
    );
  },
}));
