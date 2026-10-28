import type { EditorView, KeyBinding } from "@codemirror/view";

import {
  insertHorizontalRule,
  insertLink,
  insertMath,
  insertTable,
  setHeading,
  toggleBlockPrefix,
  toggleFencedCode,
  toggleInline,
  type BlockKind,
  type InlineKind,
} from "./formatting";

function inline(kind: InlineKind, key: string): KeyBinding {
  return {
    key,
    preventDefault: true,
    run: (view) => toggleInline(view, kind),
  };
}

function block(kind: BlockKind, key: string): KeyBinding {
  return {
    key,
    preventDefault: true,
    run: (view) => toggleBlockPrefix(view, kind),
  };
}

export const formatKeymap: readonly KeyBinding[] = [
  inline("bold", "Mod-b"),
  inline("italic", "Mod-i"),
  inline("strike", "Mod-Shift-5"),
  inline("strike", "Alt-Shift-5"),
  inline("code", "Mod-Shift-`"),
  inline("code", "Mod-Shift-Backquote"),
  {
    key: "Mod-k",
    preventDefault: true,
    run: (view) => {
      void insertLink(view);
      return true;
    },
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    key: `Mod-${level}`,
    preventDefault: true,
    run: (view: EditorView) => setHeading(view, level),
  })),
  {
    key: "Mod-0",
    preventDefault: true,
    run: (view) => setHeading(view, 0),
  },
  block("quote", "Mod-Shift-q"),
  block("bullet", "Mod-Shift-["),
  block("ordered", "Mod-Shift-]"),
  block("task", "Mod-Shift-x"),
  {
    key: "Mod-Shift-k",
    preventDefault: true,
    run: (view) => toggleFencedCode(view),
  },
  {
    key: "Mod-Shift-m",
    preventDefault: true,
    run: (view) => insertMath(view, true),
  },
  {
    key: "Mod-Shift-4",
    preventDefault: true,
    run: (view) => insertMath(view, false),
  },
  {
    key: "Mod-t",
    preventDefault: true,
    run: (view) => insertTable(view),
  },
  {
    key: "Mod-Shift-h",
    preventDefault: true,
    run: (view) => insertHorizontalRule(view),
  },
];
