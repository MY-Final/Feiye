import { EditorView } from "@codemirror/view";

import { createEditorState, type EditorHandlers } from "./editor-setup";

let view: EditorView | null = null;
let handlers: EditorHandlers | null = null;
let suppressChange = false;

const guardedHandlers: EditorHandlers = {
  onSave() {
    handlers?.onSave();
  },
  onChange() {
    if (!suppressChange) handlers?.onChange();
  },
  onCursor(line, column) {
    handlers?.onCursor(line, column);
  },
};

export function mountEditor(
  parent: HTMLElement,
  nextHandlers: EditorHandlers,
): void {
  handlers = nextHandlers;

  // StrictMode 下 effect 会执行两次，先清理旧实例。
  view?.destroy();
  view = new EditorView({
    state: createEditorState("", guardedHandlers),
    parent,
  });
}

export function unmountEditor(): void {
  view?.destroy();
  view = null;
  handlers = null;
}

/** 用新内容替换编辑器文档（切换文件、重新加载时使用）。 */
export function setEditorDocument(content: string): void {
  if (!view) return;
  suppressChange = true;
  try {
    view.setState(createEditorState(content, guardedHandlers));
  } finally {
    suppressChange = false;
  }
  view.focus();
}

export function getEditorText(): string | null {
  return view?.state.doc.toString() ?? null;
}

export function focusEditor(): void {
  view?.focus();
}

export function refreshEditorLayout(): void {
  view?.requestMeasure();
}
