import { redo, undo } from "@codemirror/commands";
import { useRef, type ReactNode } from "react";

import { SlidingSegmented } from "../components/SlidingSegmented";
import { getEditorText, runEditorCommand } from "../features/editor/editor-bridge";
import { insertImageFiles } from "../features/editor/image-insert";
import {
  insertHorizontalRule,
  insertLink,
  insertMath,
  insertTable,
  setHeading,
  toggleBlockPrefix,
  toggleFencedCode,
  toggleInline,
} from "../features/editor/formatting";
import { saveActiveDocument } from "../features/editor/save";
import {
  changeViewMode,
  newDocumentNearActive,
  openNextDocument,
  openPreviousDocument,
  renameActiveDocument,
  saveDocumentAs,
} from "../features/workspace/workspace-actions";
import { renderMarkdownToHtml } from "../features/preview/preview-controller";
import { useDocumentStore } from "../stores/document";
import { useEditorStore } from "../stores/editor";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";
import { copyHtml } from "../lib/clipboard";
import { VIEW_MODES } from "../lib/view-modes";

async function copyActiveAsHtml(): Promise<void> {
  const text = getEditorText();
  if (text === null) return;

  try {
    const html = await renderMarkdownToHtml(text);
    const copied = await copyHtml(html);
    useUiStore
      .getState()
      .toast(
        copied ? "HTML 已复制，可直接粘贴到邮件或公众号草稿" : "复制 HTML 失败，请重试",
        copied ? "info" : "error",
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useUiStore.getState().toast(`生成 HTML 失败：${message}`, "error");
  }
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4 2.8 7.2 6 10.4" />
      <path d="M3 7.2h5.6a3.4 3.4 0 0 1 0 6.8H6.4" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 4l3.2 3.2L10 10.4" />
      <path d="M13 7.2H7.4a3.4 3.4 0 0 0 0 6.8h2.2" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.4 9.6l3.2-3.2M5.1 8.4l-1 1a2.2 2.2 0 0 0 3.1 3.1l1-1M10.9 7.6l1-1a2.2 2.2 0 0 0-3.1-3.1l-1 1" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.8" width="12" height="10.4" rx="1.6" />
      <circle cx="6" cy="6.4" r="1.1" />
      <path d="M3.4 11.6l3.1-3.2 2.2 2.2 1.6-1.6 2.3 2.6" />
    </svg>
  );
}

function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.6 6V3.4a.8.8 0 0 1 .8-.8H6M10 2.6h2.6a.8.8 0 0 1 .8.8V6M13.4 10v2.6a.8.8 0 0 1-.8.8H10M6 13.4H3.4a.8.8 0 0 1-.8-.8V10" />
    </svg>
  );
}

interface ToolButtonProps {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
  className?: string;
}

function ToolButton({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
  className = "",
}: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-btn ${className}${active ? " active" : ""}`.trim()}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Toolbar() {
  const root = useWorkspaceStore((state) => state.root);
  const docPath = useDocumentStore((state) => state.path);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const format = useEditorStore((state) => state.format);
  const previousPath = useWorkspaceStore((state) =>
    docPath ? (state.history[state.history.length - 1] ?? null) : null,
  );
  const nextPath = useWorkspaceStore((state) =>
    docPath ? (state.forward[state.forward.length - 1] ?? null) : null,
  );
  const imageInput = useRef<HTMLInputElement>(null);

  const hasDoc = Boolean(docPath);
  const formattingDisabled = !hasDoc || viewMode === "preview";

  const headingValue = format.heading;
  const list = format.list;

  return (
    <div className="toolbar" role="toolbar" aria-label="编辑工具栏">
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // 清空以便再次选择同一张图片时仍能触发 change。
          event.target.value = "";
          insertImageFiles(files);
        }}
      />
      <div className="toolbar-group file-actions">
        <button
          type="button"
          className="toolbar-text-btn"
          title={
            previousPath
              ? `返回上一篇笔记 (Alt+←)：${previousPath}`
              : "返回上一篇笔记（本次会话里还没有打开过其他笔记）"
          }
          disabled={!previousPath}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void openPreviousDocument()}
        >
          返回
        </button>
        <button
          type="button"
          className="toolbar-text-btn"
          title={
            nextPath
              ? `前进下一篇笔记 (Alt+→)：${nextPath}`
              : "前进下一篇笔记（还没有可前进的笔记）"
          }
          disabled={!nextPath}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void openNextDocument()}
        >
          前进
        </button>
        <button
          type="button"
          className="toolbar-text-btn"
          title="新建 Markdown (Ctrl+N)"
          disabled={!root}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void newDocumentNearActive()}
        >
          新建
        </button>
        <button
          type="button"
          className="toolbar-text-btn"
          title="保存 (Ctrl+S)"
          disabled={!hasDoc}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void saveActiveDocument()}
        >
          保存
        </button>
        <button
          type="button"
          className="toolbar-text-btn"
          title="另存为 (Ctrl+Shift+S)"
          disabled={!hasDoc}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void saveDocumentAs()}
        >
          另存为
        </button>
        <button
          type="button"
          className="toolbar-text-btn"
          title="按预览排版复制 HTML，可直接粘贴到邮件或公众号草稿"
          disabled={!hasDoc}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copyActiveAsHtml()}
        >
          复制 HTML
        </button>
        <button
          type="button"
          className="toolbar-text-btn"
          title="重命名当前文件 (F2)"
          disabled={!hasDoc}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void renameActiveDocument()}
        >
          重命名
        </button>
      </div>

      <span className="toolbar-sep" aria-hidden="true" />

      <div className="toolbar-group" aria-label="撤销与重做">
        <ToolButton
          title="撤销 (Ctrl+Z)"
          disabled={formattingDisabled || !format.canUndo}
          onClick={() => runEditorCommand((view) => undo(view))}
        >
          <UndoIcon />
        </ToolButton>
        <ToolButton
          title="重做 (Ctrl+Shift+Z)"
          disabled={formattingDisabled || !format.canRedo}
          onClick={() => runEditorCommand((view) => redo(view))}
        >
          <RedoIcon />
        </ToolButton>
      </div>

      <span className="toolbar-sep" aria-hidden="true" />

      <div className="toolbar-group" aria-label="行内格式">
        <ToolButton
          title="加粗 (Ctrl+B)"
          active={format.bold}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleInline(view, "bold"))}
        >
          <span className="glyph bold">B</span>
        </ToolButton>
        <ToolButton
          title="斜体 (Ctrl+I)"
          active={format.italic}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleInline(view, "italic"))}
        >
          <span className="glyph italic">I</span>
        </ToolButton>
        <ToolButton
          title="删除线 (Ctrl+Shift+5)"
          active={format.strike}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleInline(view, "strike"))}
        >
          <span className="glyph strike">S</span>
        </ToolButton>
        <ToolButton
          title="行内代码 (Ctrl+Shift+`)"
          active={format.code}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleInline(view, "code"))}
        >
          <span className="glyph mono">{"</>"}</span>
        </ToolButton>
        <ToolButton
          title="插入链接 (Ctrl+K)"
          active={format.link}
          disabled={formattingDisabled}
          onClick={() =>
            runEditorCommand((view) => {
              void insertLink(view);
              return true;
            })
          }
        >
          <LinkIcon />
        </ToolButton>
      </div>

      <span className="toolbar-sep" aria-hidden="true" />

      <div className="toolbar-group" aria-label="段落样式">
        <select
          className="heading-select"
          title="段落样式"
          aria-label="段落样式"
          value={headingValue}
          disabled={formattingDisabled}
          onChange={(event) => {
            const level = Number(event.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
            runEditorCommand((view) => setHeading(view, level));
          }}
        >
          <option value={0}>正文</option>
          <option value={1}>标题 1</option>
          <option value={2}>标题 2</option>
          <option value={3}>标题 3</option>
          <option value={4}>标题 4</option>
          <option value={5}>标题 5</option>
          <option value={6}>标题 6</option>
        </select>
        <ToolButton
          title="引用 (Ctrl+Shift+Q)"
          active={format.quote}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleBlockPrefix(view, "quote"))}
        >
          ❝
        </ToolButton>
        <ToolButton
          title="无序列表 (Ctrl+Shift+[)"
          active={list === "bullet"}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleBlockPrefix(view, "bullet"))}
        >
          <span className="glyph">•</span>
        </ToolButton>
        <ToolButton
          title="有序列表 (Ctrl+Shift+])"
          active={list === "ordered"}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleBlockPrefix(view, "ordered"))}
        >
          <span className="glyph">1.</span>
        </ToolButton>
        <ToolButton
          title="任务列表 (Ctrl+Shift+X)"
          active={list === "task"}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleBlockPrefix(view, "task"))}
        >
          <span className="glyph">☑</span>
        </ToolButton>
      </div>

      <span className="toolbar-sep" aria-hidden="true" />

      <div className="toolbar-group" aria-label="块级内容">
        <ToolButton
          title="代码块 (Ctrl+Shift+K)"
          active={format.codeBlock}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => toggleFencedCode(view))}
        >
          <span className="glyph mono">{"{}"}</span>
        </ToolButton>
        <ToolButton
          title="公式 (Ctrl+Shift+M)"
          active={format.math !== "none"}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => insertMath(view, true))}
        >
          <span className="glyph">∑</span>
        </ToolButton>
        <ToolButton
          title="表格 (Ctrl+T)"
          active={format.table}
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => insertTable(view))}
        >
          <span className="glyph">▦</span>
        </ToolButton>
        <ToolButton
          title="分隔线 (Ctrl+Shift+H)"
          disabled={formattingDisabled}
          onClick={() => runEditorCommand((view) => insertHorizontalRule(view))}
        >
          <span className="glyph">―</span>
        </ToolButton>
        <ToolButton
          title="插入图片"
          disabled={formattingDisabled}
          onClick={() => imageInput.current?.click()}
        >
          <ImageIcon />
        </ToolButton>
      </div>

      <div className="toolbar-spacer" />

      {root ? (
        <SlidingSegmented
          className="view-switch"
          options={VIEW_MODES}
          value={viewMode}
          ariaLabel="视图模式"
          onChange={(mode) => void changeViewMode(mode)}
        />
      ) : null}

      {root ? (
        <>
          <span className="toolbar-sep" aria-hidden="true" />
          {/* 快捷键之外也给一个看得见的入口，不然只有翻快捷键表才知道。 */}
          <ToolButton
            title="专注模式 (Ctrl + Shift + F)"
            disabled={!hasDoc}
            onClick={() => useUiStore.getState().toggleZenMode()}
          >
            <FocusIcon />
          </ToolButton>
        </>
      ) : null}
    </div>
  );
}
