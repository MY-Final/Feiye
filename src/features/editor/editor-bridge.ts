import { EditorView } from "@codemirror/view";

import {
  createEditorState,
  editorModeCompartment,
  editorModeExtension,
  type EditorHandlers,
  type EditorMode,
  type EditorOptions,
} from "./editor-setup";
import { readFormatState, type FormatState } from "./formatting";

let view: EditorView | null = null;
let handlers: EditorHandlers | null = null;
let options: EditorOptions | null = null;
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
  onFormatState(state) {
    handlers?.onFormatState(state);
  },
};

export function mountEditor(
  parent: HTMLElement,
  nextHandlers: EditorHandlers,
  nextOptions: EditorOptions,
): void {
  handlers = nextHandlers;
  options = nextOptions;

  // StrictMode 下 effect 会执行两次，先清理旧实例。
  view?.destroy();
  view = new EditorView({
    state: createEditorState("", guardedHandlers, nextOptions),
    parent,
  });
}

export function unmountEditor(): void {
  view?.destroy();
  view = null;
  handlers = null;
  options = null;
}

/** 用新内容替换编辑器文档（切换文件、重新加载时使用）。 */
export function setEditorDocument(content: string): void {
  if (!view || !options) return;
  suppressChange = true;
  try {
    view.setState(createEditorState(content, guardedHandlers, options));
  } finally {
    suppressChange = false;
  }
  guardedHandlers.onFormatState(readFormatState(view.state));
  view.focus();
}

/** 切换源码 / 所见即所得，不重建文档、选区或撤销历史。 */
export function setEditorMode(mode: EditorMode): void {
  if (!view || !options) return;
  if (options.mode === mode) return;
  options = { ...options, mode };
  view.dispatch({
    effects: editorModeCompartment.reconfigure(
      editorModeExtension(mode, options),
    ),
  });
}

export function runEditorCommand(
  command: (view: EditorView) => boolean,
): boolean {
  if (!view) return false;
  const result = command(view);
  view.focus();
  return result;
}

export function getEditorFormatState(): FormatState | null {
  return view ? readFormatState(view.state) : null;
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
