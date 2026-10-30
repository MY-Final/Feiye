import { useEffect, useRef, useState } from "react";

import { trapTab } from "../../components/Dialog";
import {
  listHistory,
  readHistory,
  type HistoryEntry,
} from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { setEditorDocument } from "../editor/editor-bridge";
import { requestPreview } from "../preview/preview-controller";
import { changeViewMode } from "../workspace/workspace-actions";
import "./history.css";

function formatTime(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * 文档历史：列出每次保存留下的快照，右侧预览内容；
 * 「恢复此版本」把旧内容载入编辑器并标记未保存，由用户再按保存写盘。
 */
export function HistoryDialog() {
  const open = useUiStore((state) => state.historyOpen);
  const closeHistory = useUiStore((state) => state.closeHistory);
  const docPath = useDocumentStore((state) => state.path);
  const docName = useDocumentStore((state) => state.name);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !docPath) return;
    restoreFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    setSelected(null);
    setContent(null);
    listHistory(docPath)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setSelected(list[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, docPath]);

  // 选中哪一版就读哪一版，避免一次把所有正文都塞进内存。
  useEffect(() => {
    if (!open || !docPath || !selected) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setReading(true);
    readHistory(docPath, selected)
      .then((revision) => {
        if (!cancelled) setContent(revision.content);
      })
      .catch(() => {
        if (!cancelled) setContent(null);
      })
      .finally(() => {
        if (!cancelled) setReading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, docPath, selected]);

  if (!open) return null;

  const close = () => {
    closeHistory();
    const previous = restoreFocus.current;
    if (previous?.isConnected) previous.focus();
  };

  const restore = async () => {
    if (!docPath || content === null) return;
    const choice = await useUiStore.getState().ask({
      title: "恢复这个历史版本？",
      message:
        "该版本会载入编辑器并标记为未保存修改，当前内容先留在编辑器里；按 Ctrl+S 保存后才会写入磁盘。",
      buttons: [
        { label: "载入此版本", value: "restore", tone: "primary" },
        { label: "取消", value: "cancel" },
      ],
    });
    if (choice !== "restore") return;

    if (useDocumentStore.getState().viewMode === "preview") {
      await changeViewMode("split");
    }
    setEditorDocument(content, docPath);
    useDocumentStore.getState().markDirty(true);
    requestPreview(content, true);
    close();
    useUiStore
      .getState()
      .toast("已载入历史版本，按 Ctrl+S 保存后写入磁盘");
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="文档历史"
        onKeyDown={trapTab}
      >
        <h2 className="modal-title">文档历史</h2>
        <p className="modal-message history-subtitle">
          {docName ?? "当前文档"} · 每次保存自动留档，最多保留最近 20 份
        </p>

        {loading ? (
          <div className="history-empty">读取中…</div>
        ) : entries.length === 0 ? (
          <div className="history-empty">
            还没有历史版本。保存一次后，这里会出现该版本的快照。
          </div>
        ) : (
          <div className="history-layout">
            <ul className="history-list" aria-label="历史版本列表">
              {entries.map((entry, position) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`history-item${entry.id === selected ? " is-active" : ""}`}
                    autoFocus={position === 0}
                    onClick={() => setSelected(entry.id)}
                  >
                    <span className="history-time">
                      {formatTime(entry.savedAt)}
                      {position === 0 ? (
                        <span className="history-latest">最新</span>
                      ) : null}
                    </span>
                    <span className="history-size">
                      {formatSize(entry.size)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="history-preview" aria-label="版本内容预览">
              {reading ? (
                <div className="history-empty">读取中…</div>
              ) : content !== null ? (
                <pre className="history-text">{content}</pre>
              ) : (
                <div className="history-empty">选择左侧版本查看内容</div>
              )}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            关闭
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={content === null || reading}
            onClick={() => void restore()}
          >
            恢复此版本
          </button>
        </div>
      </div>
    </div>
  );
}
