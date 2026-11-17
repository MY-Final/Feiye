import { useMemo } from "react";

import { renameActiveDocument } from "../features/workspace/workspace-actions";
import { parentRel } from "../lib/paths";
import { useDocumentStore } from "../stores/document";
import { useSettingsStore } from "../stores/settings";

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.4 2.9a1.4 1.4 0 0 1 2 2l-6.8 6.8-2.7.7.7-2.7 6.8-6.8z" />
      <path d="M9.3 4l2.7 2.7" />
    </svg>
  );
}

function formatSavedAt(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

/**
 * 正文顶部的"文档的脸"：标题、所在目录、字数与保存状态。
 * 标签只说明打开了哪几篇，这里才回答"我正在写什么"。
 */
export function DocumentHeader() {
  const docPath = useDocumentStore((state) => state.path);
  const docName = useDocumentStore((state) => state.name);
  const dirty = useDocumentStore((state) => state.dirty);
  const saving = useDocumentStore((state) => state.saving);
  const saveBlocked = useDocumentStore((state) => state.saveBlocked);
  const savedModifiedMs = useDocumentStore((state) => state.savedModifiedMs);
  const words = useDocumentStore((state) => state.stats.words);
  const hideExt = useSettingsStore(
    (state) => state.preferences.hideFileExtensions,
  );

  const title = useMemo(() => {
    if (!docName) return "";
    return hideExt ? docName.replace(/\.(md|markdown|mdx)$/i, "") : docName;
  }, [docName, hideExt]);

  if (!docPath) return null;

  // 库名已经在标题栏里，这里只回答「在这篇库的哪一层」。
  const location = parentRel(docPath) || "根目录";
  const savedAt =
    savedModifiedMs !== null ? formatSavedAt(savedModifiedMs) : "";
  const saveLabel = saving
    ? "保存中…"
    : dirty
      ? saveBlocked
        ? "保存暂停"
        : "未保存"
      : savedAt
        ? `已保存 ${savedAt}`
        : "已保存";
  const name = title || docName || "未命名笔记";

  return (
    <header className="doc-header">
      <div className="doc-header-inner">
        <div className="doc-title-row">
          <h1
            className="doc-title-large"
            title={`${docPath}（双击重命名）`}
            onDoubleClick={() => void renameActiveDocument()}
          >
            {name}
          </h1>
          <button
            type="button"
            className="doc-title-action"
            title="重命名"
            aria-label={`重命名 ${name}`}
            onClick={() => void renameActiveDocument()}
          >
            <PencilIcon />
          </button>
        </div>
        <div className="doc-meta">
          <span className="path" title={location}>
            {location}
          </span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span>{words.toLocaleString("zh-CN")} 字</span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className={saveBlocked ? "blocked" : dirty ? "dirty" : undefined}>
            {saveLabel}
          </span>
        </div>
      </div>
    </header>
  );
}
