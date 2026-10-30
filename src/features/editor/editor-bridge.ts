import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
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
/** 多标签切换时按文档缓存 EditorState：撤销历史与选区不会随切换丢失。 */
let currentKey: string | null = null;
const stateCache = new Map<string, EditorState>();
const MAX_CACHED_STATES = 12;

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
  // 编辑器重建意味着文档上下文可能整体换了（工作区切换）：缓存一并清空。
  stateCache.clear();
  currentKey = null;
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
  stateCache.clear();
  currentKey = null;
}

function cacheCurrentState(): void {
  if (!view || !currentKey) return;
  stateCache.set(currentKey, view.state);
  // 只留最近的若干份：标签有上限，这里再兜一层，避免长期占用内存。
  while (stateCache.size > MAX_CACHED_STATES) {
    const oldest = stateCache.keys().next().value;
    if (oldest === undefined || oldest === currentKey) break;
    stateCache.delete(oldest);
  }
}

/**
 * 用新内容替换编辑器文档（切换文件、重新加载时使用）。
 * 传入 cacheKey 后，切走时缓存当前 EditorState，切回同一篇且内容没变时恢复，
 * 撤销历史与光标位置都还在。
 */
export function setEditorDocument(content: string, cacheKey?: string): void {
  if (!view || !options) return;
  if (cacheKey && cacheKey === currentKey) {
    // 同一篇重新加载：磁盘内容已变，旧状态作废。
    stateCache.delete(cacheKey);
  } else {
    cacheCurrentState();
  }

  let cached: EditorState | null = null;
  if (cacheKey) {
    const candidate = stateCache.get(cacheKey);
    if (candidate && candidate.doc.toString() === content) {
      cached = candidate;
      stateCache.delete(cacheKey);
    }
  }
  currentKey = cacheKey ?? null;

  suppressChange = true;
  try {
    if (cached) {
      view.setState(cached);
      // 缓存期间可能切过源码 / 所见即所得，按当前模式重新套一层。
      view.dispatch({
        effects: editorModeCompartment.reconfigure(
          editorModeExtension(options.mode, options),
        ),
      });
    } else {
      view.setState(createEditorState(content, guardedHandlers, options));
    }
  } finally {
    suppressChange = false;
  }
  guardedHandlers.onStats();
  guardedHandlers.onFormatState(readFormatState(view.state));
  view.focus();
}

/** 标签关闭 / 文档被删除时释放对应的缓存状态。 */
export function forgetEditorState(cacheKey: string): void {
  stateCache.delete(cacheKey);
  if (currentKey === cacheKey) currentKey = null;
}

export function clearEditorStateCache(): void {
  stateCache.clear();
  currentKey = null;
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
