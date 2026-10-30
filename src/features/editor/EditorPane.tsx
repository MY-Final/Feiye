import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { baseName, resolveRelLink } from "../../lib/paths";
import { countTextStats } from "../../lib/text-stats";
import { useDocumentStore } from "../../stores/document";
import { useEditorStore } from "../../stores/editor";
import { useOutlineStore } from "../../stores/outline";
import { requestPreview } from "../preview/preview-controller";
import {
  normalizeAnchor,
  scrollPreviewToHeading,
} from "../preview/preview-scroll";
import { openFile } from "../workspace/workspace-actions";
import { noteDocumentChange } from "./autosave";
import { noteCursorOffset } from "./cursor-memory";
import { resolveEditorImage } from "./editor-images";
import {
  getEditorText,
  getEditorView,
  jumpToEditorPosition,
  linkAtPosition,
  mountEditor,
  refreshEditorLayout,
  setEditorMode,
  unmountEditor,
} from "./editor-bridge";
import { readOutline } from "./outline";
import { saveActiveDocument } from "./save";

const STATS_DELAY_MS = 150;
const MARKDOWN_LINK = /\.(md|markdown|mdx)$/i;

/** 文档内锚点：按标题文字定位，移动光标；分栏时同步滚动预览。 */
function openEditorAnchor(fragment: string): void {
  const target = normalizeAnchor(fragment);
  if (!target) return;

  const headings = useOutlineStore.getState().headings;
  const index = headings.findIndex(
    (heading) => normalizeAnchor(heading.text) === target,
  );
  if (index < 0) return;

  jumpToEditorPosition(headings[index].from);
  if (useDocumentStore.getState().viewMode === "split") {
    scrollPreviewToHeading(index);
  }
}

/** 按预览里的同一套规则打开链接：外链交系统浏览器，笔记走应用内打开。 */
function openEditorLink(href: string): void {
  // 指向本文档标题的锚点，在编辑器里也直接跳过去，和预览一致。
  if (href.startsWith("#")) {
    openEditorAnchor(href.slice(1));
    return;
  }

  if (/^https?:\/\//i.test(href)) {
    void openUrl(href).catch(() => {
      // 权限或系统调用失败时保持页面不动。
    });
    return;
  }

  const current = useDocumentStore.getState().path;
  const relPath = current ? resolveRelLink(href, current) : null;
  if (relPath && MARKDOWN_LINK.test(relPath)) {
    const hash = href.indexOf("#");
    const fragment = hash >= 0 ? href.slice(hash + 1) : undefined;
    // 带文件名的自链接（如 `本文.md#小节`）直接在本文档内跳转。
    if (current === relPath) {
      if (fragment) openEditorAnchor(fragment);
      return;
    }
    // `笔记.md#标题` 打开后还要定位到目标标题。
    void openFile(
      { relPath, name: baseName(relPath), isDir: false },
      false,
      fragment,
    );
  }
}

/** Ctrl/⌘ + 左键点链接时打开；捕获阶段拦截，避免编辑器先移动光标。 */
function handleLinkClick(event: ReactMouseEvent<HTMLDivElement>): void {
  if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;

  const view = getEditorView();
  if (!view) return;
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return;

  const href = linkAtPosition(position);
  if (!href) return;

  event.preventDefault();
  event.stopPropagation();
  openEditorLink(href);
}

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const statsTimer = useRef<number | null>(null);
  const viewMode = useDocumentStore((state) => state.viewMode);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const mode = useDocumentStore.getState().viewMode;

    // 最多每 150ms 取一次全文统计与大纲，连续输入时也不会卡顿。
    const scheduleStats = () => {
      if (statsTimer.current !== null) return;
      statsTimer.current = window.setTimeout(() => {
        statsTimer.current = null;
        const text = getEditorText();
        if (text !== null) {
          useDocumentStore.getState().setStats(countTextStats(text));
        }
        const state = getEditorView()?.state;
        if (state) {
          useOutlineStore.getState().setHeadings(readOutline(state));
        }
      }, STATS_DELAY_MS);
    };

    mountEditor(
      host,
      {
        onSave() {
          void saveActiveDocument();
        },
        onChange() {
          useDocumentStore.getState().markDirty(true);
          noteDocumentChange();
          if (useDocumentStore.getState().viewMode === "wysiwyg") return;

          const text = getEditorText();
          if (text !== null && useDocumentStore.getState().path) {
            requestPreview(text);
          }
        },
        onStats: scheduleStats,
        onCursor(line, column) {
          useDocumentStore.getState().setCursor(line, column);
          const view = getEditorView();
          const range = view?.state.selection.main;
          if (view) {
            noteCursorOffset(
              useDocumentStore.getState().path,
              range?.head ?? 0,
            );
          }
          const words =
            view && range && !range.empty
              ? countTextStats(view.state.sliceDoc(range.from, range.to)).words
              : 0;
          useEditorStore.getState().setSelectedWords(words);
        },
        onFormatState(state) {
          useEditorStore.getState().setFormat(state);
        },
      },
      {
        mode: mode === "wysiwyg" ? "wysiwyg" : "source",
        resolveImage: resolveEditorImage,
      },
    );

    return () => {
      unmountEditor();
      useOutlineStore.getState().clear();
      if (statsTimer.current !== null) {
        window.clearTimeout(statsTimer.current);
        statsTimer.current = null;
      }
    };
  }, []);

  // 视图切换：只重配置编辑器，不重建文档。
  useEffect(() => {
    setEditorMode(viewMode === "wysiwyg" ? "wysiwyg" : "source");
    requestAnimationFrame(() => refreshEditorLayout());
  }, [viewMode]);

  return (
    <div
      className="editor-host"
      ref={hostRef}
      onMouseDownCapture={handleLinkClick}
    />
  );
}
