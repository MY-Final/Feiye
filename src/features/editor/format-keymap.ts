import type { EditorView, KeyBinding } from "@codemirror/view";

import {
  continueTaskList,
  exitCodeBlock,
  focusCodeLanguage,
  handleCodeBlockEnter,
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

/** Tab / Shift+Tab：按 Markdown 习惯以两个空格缩进或反缩进所选的每一行。 */
function indentLines(view: EditorView, outdent: boolean): boolean {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const changes: { from: number; to?: number; insert: string }[] = [];
  let delta = 0;

  for (let number = first; number <= last; number += 1) {
    const line = state.doc.line(number);
    if (outdent) {
      const match = /^(\t| {1,2})/.exec(line.text);
      if (match) {
        changes.push({
          from: line.from,
          to: line.from + match[0].length,
          insert: "",
        });
        delta -= match[0].length;
      }
    } else {
      changes.push({ from: line.from, insert: "  " });
      delta += 2;
    }
  }

  if (changes.length === 0) return true;

  view.dispatch({
    changes,
    userEvent: "input.indent",
    // 单选区时让光标跟着缩进移动；多行选区交给变更映射。
    selection: range.empty
      ? { anchor: Math.max(0, range.head + delta) }
      : undefined,
  });
  return true;
}

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
  // 编辑器内 Tab 用于缩进，不再把焦点移出正文。
  { key: "Tab", run: (view) => indentLines(view, false) },
  { key: "Shift-Tab", run: (view) => indentLines(view, true) },
  // 代码块内：块尾空行回车退出；Ctrl/Cmd+Enter 随时退出。
  { key: "Enter", run: handleCodeBlockEnter },
  // 代码块里 handleCodeBlockEnter 会先接住，这里只落到普通正文的任务项。
  { key: "Enter", run: continueTaskList },
  { key: "Mod-Enter", run: exitCodeBlock },
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
    key: "Mod-Shift-l",
    preventDefault: true,
    run: (view) => focusCodeLanguage(view),
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
