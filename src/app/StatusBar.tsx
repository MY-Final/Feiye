import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ContextMenu } from "../components/Menu";
import { copyText } from "../lib/clipboard";
import { countTextStats } from "../lib/text-stats";
import { saveActiveDocument } from "../features/editor/save";
import {
  changeViewMode,
  chooseWorkspace,
} from "../features/workspace/workspace-actions";
import { VIEW_MODES } from "../lib/view-modes";
import { useDocumentStore } from "../stores/document";
import { useEditorStore } from "../stores/editor";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";

/** 已保存时间的时分部分。格式化较贵，只在保存时间变化时重算。 */
function formatSavedTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 同一天只显示时分，隔天补上日期；每次渲染重新判断日期，跨午夜也不会停在昨天。 */
function formatSavedAt(ms: number, time: string): string {
  if (!time) return "";
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (!sameDay) {
    // 隔天打开时只有日期会让人分不清是早上还是晚上存的，时间一起带上。
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }
  return time;
}

export function StatusBar() {
  const hasWorkspace = useWorkspaceStore((state) => Boolean(state.root));
  const root = useWorkspaceStore((state) => state.root);
  const docPath = useDocumentStore((state) => state.path);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const dirty = useDocumentStore((state) => state.dirty);
  const saving = useDocumentStore((state) => state.saving);
  const saveBlocked = useDocumentStore((state) => state.saveBlocked);
  const zenMode = useUiStore((state) => state.zenMode);
  const savedModifiedMs = useDocumentStore((state) => state.savedModifiedMs);
  const cursor = useDocumentStore((state) => state.cursor);
  const stats = useDocumentStore((state) => state.stats);
  const selectedWords = useEditorStore((state) => state.selectedWords);
  const autoSaveOff = useSettingsStore(
    (state) => state.preferences.autoSaveDelay <= 0,
  );
  const manualSaveSeq = useDocumentStore((state) => state.manualSaveSeq);

  // 手动保存成功后播报一次；自动保存不逐次播报，免得写一会儿就念一遍。
  const [saveNotice, setSaveNotice] = useState({ seq: 0, text: "" });
  useEffect(() => {
    if (manualSaveSeq === 0) return;
    setSaveNotice({ seq: manualSaveSeq, text: "已保存" });
  }, [manualSaveSeq]);

  // 窄窗口里工具栏的视图切换会收起，状态栏留一个常驻入口。
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const currentViewLabel =
    VIEW_MODES.find((mode) => mode.value === viewMode)?.label ?? "视图";

  // 预览里也能选中正文，和编辑区一样在状态栏报出选中字数。
  // 纯预览时编辑器可能还留着切走前的选区，此时以预览里的选择为准。
  const [previewSelectedWords, setPreviewSelectedWords] = useState(0);
  useEffect(() => {
    const sync = () => {
      const mode = useDocumentStore.getState().viewMode;
      if (mode !== "preview" && mode !== "split") {
        setPreviewSelectedWords((prev) => (prev === 0 ? prev : 0));
        return;
      }
      const body = document.querySelector<HTMLElement>(
        ".preview-pane .markdown-body",
      );
      const selection = window.getSelection();
      let words = 0;
      if (
        body &&
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        body.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        words = countTextStats(selection.toString()).words;
      }
      setPreviewSelectedWords((prev) => (prev === words ? prev : words));
    };
    document.addEventListener("selectionchange", sync);
    sync();
    return () => document.removeEventListener("selectionchange", sync);
  }, [viewMode, docPath]);

  // 以最近一次真实选区为准：分栏里在预览选中时，编辑区可能还留着切走前的
  // 选区（CodeMirror 失焦不清空），此时该显示预览里的字数而不是旧的编辑区字数。
  const shownSelectedWords =
    viewMode === "preview"
      ? previewSelectedWords
      : previewSelectedWords > 0
        ? previewSelectedWords
        : selectedWords;

  // 击键时状态栏会跟着光标频繁重渲染，保存时间是旧值，没必要每次重新格式化。
  const savedTime = useMemo(
    () => (savedModifiedMs !== null ? formatSavedTime(savedModifiedMs) : ""),
    [savedModifiedMs],
  );
  const savedTitle = useMemo(
    () =>
      savedModifiedMs !== null
        ? new Date(savedModifiedMs).toLocaleString("zh-CN")
        : null,
    [savedModifiedMs],
  );
  const savedAt =
    savedModifiedMs !== null ? formatSavedAt(savedModifiedMs, savedTime) : "";
  const wordsLabel = useMemo(
    () => stats.words.toLocaleString("zh-CN"),
    [stats.words],
  );
  const charsLabel = useMemo(
    () => stats.chars.toLocaleString("zh-CN"),
    [stats.chars],
  );
  const saveLabel = saving
    ? "保存中…"
    : dirty
      ? saveBlocked
        ? "保存暂停"
        : autoSaveOff
          ? "未保存 · Ctrl+S"
          : "待保存"
      : savedAt
        ? `已保存 ${savedAt}`
        : "已保存";
  const saveKey = saving
    ? "saving"
    : dirty
      ? saveBlocked ?? "dirty"
      : `saved-${savedModifiedMs ?? 0}`;
  const saveTitle = [
    savedTitle,
    saveBlocked,
    dirty && autoSaveOff && !saveBlocked
      ? "自动保存已关闭，按 Ctrl+S 保存"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <footer className="statusbar">
      <span className="sr-only" role="status" aria-live="polite">
        {saveNotice.text ? (
          <span key={saveNotice.seq}>{saveNotice.text}</span>
        ) : null}
      </span>
      {docPath && root ? (
        // 状态栏一直显示着相对路径，点一下就能拿到完整路径贴到别处。
        <button
          type="button"
          className="status-path status-path-button"
          title={`${root}${root.includes("\\") ? "\\" : "/"}${docPath.split("/").join(root.includes("\\") ? "\\" : "/")}（点击复制完整路径）`}
          onClick={() => {
            const sep = root.includes("\\") ? "\\" : "/";
            const full = `${root}${sep}${docPath.split("/").join(sep)}`;
            void copyText(full).then((copied) => {
              useUiStore
                .getState()
                .toast(
                  copied ? "已复制完整路径" : "复制到剪贴板失败",
                  copied ? "info" : "error",
                );
            });
          }}
        >
          {docPath}
        </button>
      ) : (
        hasWorkspace ? (
          <span className="status-path">未选择文件</span>
        ) : (
          // 空白状态里最该做的就是选个文件夹，直接把它变成入口。
          <button
            type="button"
            className="status-path status-path-button"
            title="打开文件夹作为工作区（Ctrl+O）"
            onClick={() => void chooseWorkspace()}
          >
            未打开工作区 · 打开文件夹
          </button>
        )
      )}
      <span className="status-meta">
        {docPath ? (
          <>
            {/* 工具栏窄到收起视图分段控件时，这里仍能看见并切换当前视图。 */}
            <button
              type="button"
              className="status-group status-view"
              title={`切换视图（当前：${currentViewLabel} · Ctrl+E）`}
              aria-haspopup="menu"
              aria-expanded={viewMenu !== null}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                if (viewMenu) {
                  setViewMenu(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setViewMenu({ x: rect.left, y: rect.top - 150 });
              }}
            >
              {currentViewLabel}
              <span className="status-view-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {viewMode !== "preview" ? (
              // 纯预览里编辑器不显示，光标行列是切走前的旧值，只会让人误解。
              <span className="status-group status-cursor">
                {cursor.line}:{cursor.column}
              </span>
            ) : null}
            <span className="status-group status-stats">
              {shownSelectedWords > 0 ? (
                <span
                  className="status-stat status-selected"
                  title="当前选区的字数（不含空白）"
                >
                  选中 {shownSelectedWords.toLocaleString("zh-CN")} 字
                </span>
              ) : null}
              <span
                className="status-stat"
                title={`${charsLabel} 个字符（不含空白）`}
              >
                {wordsLabel} 字
              </span>
            </span>
            <span className="status-group status-encoding">UTF-8</span>
            {saveBlocked ? (
              // 自动保存被冲突或错误挡下后，状态栏直接作为重试入口，
              // 不用让用户自己猜「按 Ctrl+S」。
              <button
                type="button"
                className="status-group status-save status-blocked status-action"
                title={saveTitle || "点击重试保存"}
                onClick={() => void saveActiveDocument()}
              >
                <span key={saveKey} className="status-save-text">
                  {saveLabel}
                </span>
              </button>
            ) : (
              <span
                className={`status-group status-save${dirty ? " status-dirty" : ""}`}
                title={saveTitle || undefined}
              >
                <span key={saveKey} className="status-save-text">
                  {saveLabel}
                </span>
              </span>
            )}
            {zenMode ? (
              // 专注模式收起工具栏后，状态栏留一个可见的出口，
              // 忘了快捷键也能点着退出。
              <button
                type="button"
                className="status-zen"
                title="退出专注模式（Ctrl + Shift + F）"
                aria-label="退出专注模式"
                onClick={() => useUiStore.getState().toggleZenMode()}
              >
                专注
              </button>
            ) : null}
          </>
        ) : null}
      </span>
      {viewMenu
        ? createPortal(
            <ContextMenu
              x={viewMenu.x}
              y={viewMenu.y}
              onClose={() => setViewMenu(null)}
              actions={VIEW_MODES.map((mode) => ({
                label: mode.value === viewMode ? `✓ ${mode.label}` : mode.label,
                title: mode.title,
                onSelect: () => void changeViewMode(mode.value),
              }))}
            />,
            document.body,
          )
        : null}
    </footer>
  );
}
