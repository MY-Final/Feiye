import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
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
  onStats() {
    handlers?.onStats();
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
  guardedHandlers.onStats();
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

export function getEditorView(): EditorView | null {
  return view;
}

export function getEditorScroller(): HTMLElement | null {
  return view?.scrollDOM ?? null;
}

export interface EditorScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  paddingTop: number;
  headingTops: number[];
}

/** 供分栏滚动同步使用：标题在编辑器滚动内容中的纵坐标。 */
export function getEditorScrollMetrics(
  positions: number[],
): EditorScrollMetrics | null {
  const editor = view;
  if (!editor) return null;
  const paddingTop = editor.documentPadding.top;
  return {
    scrollTop: editor.scrollDOM.scrollTop,
    scrollHeight: editor.scrollDOM.scrollHeight,
    clientHeight: editor.scrollDOM.clientHeight,
    paddingTop,
    headingTops: positions.map((position) => {
      const target = Math.max(0, Math.min(position, editor.state.doc.length));
      return paddingTop + editor.lineBlockAt(target).top;
    }),
  };
}

export function setEditorScrollTop(top: number): void {
  if (!view) return;
  view.scrollDOM.scrollTop = top;
}

/** 把光标移动到指定文档位置，并滚动到视口上方。 */
export function jumpToEditorPosition(position: number, focus = true): boolean {
  if (!view) return false;
  const target = Math.max(0, Math.min(position, view.state.doc.length));
  view.dispatch({
    selection: { anchor: target },
    effects: EditorView.scrollIntoView(target, { y: "start", yMargin: 24 }),
  });
  if (focus) view.focus();
  return true;
}

export function focusEditor(): void {
  view?.focus();
}

/** 打开编辑器内置的查找 / 替换面板；编辑器隐藏时调用方负责先切回可见模式。 */
export function openEditorSearch(): void {
  if (!view) return;
  openSearchPanel(view);
  view.focus();
}

export function refreshEditorLayout(): void {
  view?.requestMeasure();
}

/** 位置所在的链接地址；不在链接内返回 null。 */
export function linkAtPosition(position: number): string | null {
  if (!view) return null;
  const state = view.state;
  let node = syntaxTree(state).resolveInner(position, 1);
  while (node.name !== "Link" && node.name !== "Autolink") {
    if (!node.parent) return null;
    node = node.parent;
  }

  const url = node.getChild("URL");
  if (url) return state.doc.sliceString(url.from, url.to);

  const raw = state.doc.sliceString(node.from, node.to);
  return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
}

/**
 * 预览里点击第 index 个任务复选框：翻转文档中对应的 [ ] / [x]。
 * 预览节点与语法树节点数量不一致时放弃，避免勾错行。
 */
export function toggleTaskMarkerAt(
  index: number,
  expectedTotal: number,
): boolean {
  if (!view) return false;
  const state = view.state;
  const tree =
    ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
  const markers: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "TaskMarker") {
        markers.push({ from: node.from, to: node.to });
      }
    },
  });

  if (markers.length !== expectedTotal) return false;
  const target = markers[index];
  if (!target) return false;

  const marker = state.doc.sliceString(target.from, target.to);
  if (!/^\[[ xX]\]$/.test(marker)) return false;

  view.dispatch({
    changes: {
      from: target.from,
      to: target.to,
      insert: /^\[[xX]\]$/.test(marker) ? "[ ]" : "[x]",
    },
    userEvent: "input.format",
  });
  return true;
}
