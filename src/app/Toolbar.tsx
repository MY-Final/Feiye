import { redo, undo } from "@codemirror/commands";
import { invoke } from "@tauri-apps/api/core";
import { useRef, type ReactNode } from "react";

import { SlidingSegmented } from "../components/SlidingSegmented";
import {
  getEditorText,
  getEditorView,
  runEditorCommand,
} from "../features/editor/editor-bridge";
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
  existingNameError,
  nameCharError,
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
import { countLocalImages, normalizeImagePath } from "../lib/images";
import { baseName, parentRel } from "../lib/paths";
import { describeError, isAppError } from "../lib/tauri";
import { VIEW_MODES } from "../lib/view-modes";

/** 把预览 HTML 中的工作区图片换成 data URL，超过上限或读取失败时保留原地址。 */
async function inlineLocalImages(
  html: string,
  root: string | null,
  docPath: string | null,
): Promise<{ html: string; inlined: number }> {
  if (!root || !docPath) return { html, inlined: 0 };

  const template = document.createElement("template");
  template.innerHTML = html;
  const dirRel = parentRel(docPath);
  let inlined = 0;

  for (const img of template.content.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src")?.trim() ?? "";
    if (!src || /^(?:https?:|data:|blob:|\/\/)/i.test(src)) continue;
    const rel = src.startsWith("/")
      ? normalizeImagePath(src.slice(1))
      : normalizeImagePath(dirRel ? `${dirRel}/${src}` : src);
    if (!rel) continue;
    try {
      const dataUrl = await invoke<string | null>("read_image_data_url", {
        relPath: rel,
      });
      if (dataUrl) {
        img.setAttribute("src", dataUrl);
        inlined += 1;
      }
    } catch {
      // 读取失败时保留原地址，由随后的提示说明。
    }
  }

  return { html: template.innerHTML, inlined };
}

/** 预览图片的 feiyeimg 地址还原成工作区相对路径；不是本工作区的返回 null。 */
function feiyeimgRel(src: string, root: string | null): string | null {
  if (!root || !/^[a-z]+:\/\//i.test(src)) return null;
  let pathname = "";
  try {
    pathname = decodeURIComponent(new URL(src).pathname);
  } catch {
    return null;
  }
  const abs = pathname.replace(/^\/+/, "").replace(/\\/g, "/");
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!abs.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return null;
  return abs.slice(base.length + 1);
}

/** 把预览区里选中的内容变成可复制的 HTML，去掉复制按钮等界面装饰。 */
function previewSelectionHtml(root: string | null): string | null {
  const body = document.querySelector<HTMLElement>(
    ".preview-pane .markdown-body",
  );
  const selection = window.getSelection();
  if (!body || !selection || selection.rangeCount === 0) return null;
  if (selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer)) return null;

  const holder = document.createElement("div");
  holder.append(range.cloneContents());
  holder
    .querySelectorAll(".preview-code-copy, .preview-code-lang")
    .forEach((node) => node.remove());
  holder.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((heading) => {
    heading.removeAttribute("id");
    heading.removeAttribute("data-heading-index");
  });
  // 链接上由预览补的路径提示不该跟着进剪贴板。
  holder.querySelectorAll<HTMLElement>("[data-link-hint]").forEach((node) => {
    node.removeAttribute("title");
    node.removeAttribute("data-link-hint");
  });
  holder.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    const rel = feiyeimgRel(image.getAttribute("src") ?? "", root);
    if (rel) image.setAttribute("src", `/${rel}`);
  });

  return holder.innerHTML.trim() ? holder.innerHTML : null;
}

export async function copyActiveAsHtml(): Promise<void> {
  const editorView = getEditorView();
  const viewMode = useDocumentStore.getState().viewMode;
  // 预览模式下编辑器可能留着旧选区，此时按整篇复制。
  const selection =
    viewMode !== "preview" ? editorView?.state.selection.main : undefined;
  const selected =
    selection && !selection.empty
      ? editorView!.state.sliceDoc(selection.from, selection.to)
      : "";
  const useSelection = selected.trim().length > 0;
  // 渲染等待期间可能已经切到别的笔记；图片路径要以按下快捷键时的文档为准。
  const root = useWorkspaceStore.getState().root;
  const docPath = useDocumentStore.getState().path;
  // 编辑区没有选区时，尊重在预览区里选中的那段。
  const previewHtml = useSelection ? null : previewSelectionHtml(root);
  const usePreviewSelection = previewHtml !== null;
  const text = useSelection ? selected : getEditorText();
  if (!usePreviewSelection && text === null) return;

  try {
    const rendered = usePreviewSelection
      ? (previewHtml ?? "")
      : await renderMarkdownToHtml(text!);
    const { html, inlined } = await inlineLocalImages(rendered, root, docPath);
    const copied = await copyHtml(html);
    const localImages = countLocalImages(html);
    const notes: string[] = [];
    if (inlined > 0) notes.push(`${inlined} 张本地图片已内联`);
    if (localImages > 0) notes.push(`${localImages} 张本地图片在应用外可能无法显示`);
    const warning = notes.length > 0 ? `（${notes.join("；")}）` : "";
    const fromSelection = useSelection || usePreviewSelection;
    const plain = useSelection
      ? selected
      : usePreviewSelection
        ? (window.getSelection()?.toString() ?? "")
        : "";
    const size = plain.replace(/\s+/g, "").length;
    const okMessage =
      (fromSelection
        ? `所选内容（${size} 字）已复制为 HTML，可直接粘贴到邮件或公众号草稿`
        : "HTML 已复制，可直接粘贴到邮件或公众号草稿") + warning;
    useUiStore
      .getState()
      .toast(
        copied ? okMessage : "复制 HTML 失败，请重试",
        copied ? "info" : "error",
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useUiStore.getState().toast(`生成 HTML 失败：${message}`, "error");
  }
}

/** 没写 `.html` 时自动补上，避免导出成没有扩展名的文件。 */
function ensureHtmlName(value: string): string {
  return /\.html$/i.test(value) ? value : `${value}.html`;
}

/** 同目录已有同名文件时退到 `名字-2.html`，与「另存为」连续保存的默认名一致。 */
function nextFreeHtmlName(parent: string, leaf: string): string {
  const entries = useWorkspaceStore.getState().children[parent] ?? [];
  const used = new Set(
    entries.filter((item) => !item.isDir).map((item) => item.name.toLowerCase()),
  );
  if (!used.has(leaf.toLowerCase())) return leaf;
  const stem = leaf.replace(/\.html$/i, "");
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem}-${n}.html`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return leaf;
}

/** 把整篇笔记导出成同目录下的 `.html` 文件；已存在时后端拒绝，不静默覆盖。 */
export async function exportActiveAsHtml(): Promise<void> {
  const ui = useUiStore.getState();
  const root = useWorkspaceStore.getState().root;
  const docPath = useDocumentStore.getState().path;
  if (!root || !docPath) {
    ui.toast("先打开一篇笔记再导出 HTML");
    return;
  }
  const text = getEditorText();
  if (text === null) return;

  const parent = parentRel(docPath);
  const defaultName = nextFreeHtmlName(
    parent,
    `${baseName(docPath).replace(/\.[^./\\]+$/, "") || "笔记"}.html`,
  );
  const name = await ui.askInput({
    title: parent ? `导出 HTML · ${parent}` : "导出 HTML",
    label: "文件名（保存在当前笔记所在目录，自动补 .html）",
    initialValue: defaultName,
    confirmLabel: "导出",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "文件名不能为空";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "文件名不能包含路径分隔符";
      }
      const leaf = ensureHtmlName(trimmed);
      return nameCharError(leaf) ?? existingNameError(parent, leaf);
    },
  });
  if (!name) return;

  const leaf = ensureHtmlName(name.trim());
  const rel = parent ? `${parent}/${leaf}` : leaf;
  try {
    const rendered = await renderMarkdownToHtml(text);
    const { html } = await inlineLocalImages(rendered, root, docPath);
    await invoke("export_html", { relPath: rel, content: html });
    ui.toast(`已导出 HTML：${rel}`);
    void useWorkspaceStore.getState().refreshDir(parent);
  } catch (error) {
    if (isAppError(error) && error.code === "already-exists") {
      const suggestion = nextFreeHtmlName(parent, leaf);
      const hint =
        suggestion === leaf ? "换个文件名再试" : `可改用「${suggestion}」`;
      ui.toast(`「${leaf}」已存在，未覆盖；${hint}`, "error");
    } else {
      ui.toast(`导出 HTML 失败：${describeError(error)}`, "error");
    }
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
          title="按预览排版复制 HTML (Ctrl+Shift+E)；选中正文时只复制所选部分，本地图片自动内联（单张 4 MB 以内）"
          disabled={!hasDoc}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copyActiveAsHtml()}
        >
          复制 HTML
        </button>
        <button
          type="button"
          className="toolbar-text-btn"
          title="把整篇笔记导出成当前目录下的 .html 文件（不覆盖已有文件）"
          disabled={!hasDoc}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void exportActiveAsHtml()}
        >
          导出 HTML…
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
