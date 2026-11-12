import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { trapTab } from "../../components/Dialog";
import {
  listHistory,
  readHistory,
  type HistoryEntry,
} from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { getEditorText, setEditorDocument } from "../editor/editor-bridge";
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

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

/**
 * 轻量行级 diff：去掉公共前后缀，中间变化块先列删除行、再列新增行。
 * 不做逐行配对，超长文档也只是同一路径，不会有平方级开销。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = oldText === "" ? [] : oldText.split("\n");
  const after = newText === "" ? [] : newText.split("\n");
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tailOld = before.length - 1;
  let tailNew = after.length - 1;
  while (tailOld >= head && tailNew >= head && before[tailOld] === after[tailNew]) {
    tailOld--;
    tailNew--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) out.push({ type: "same", text: before[i] });
  for (let i = head; i <= tailOld; i++) out.push({ type: "del", text: before[i] });
  for (let i = head; i <= tailNew; i++) out.push({ type: "add", text: after[i] });
  for (let i = tailOld + 1; i < before.length; i++) out.push({ type: "same", text: before[i] });
  return out;
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
  const [mode, setMode] = useState<"content" | "diff">("content");
  /** 切到对比时给编辑器正文拍个快照；弹层开着时正文不会再变。 */
  const [currentText, setCurrentText] = useState<string | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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
    setMode("content");
    setCurrentText(null);
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

  // 笔记还没有历史版本时，框内没有可聚焦的条目；把焦点先收进对话框本身，
  // 读屏会报出标题，Tab 也不会跑回后面的编辑器 / 文件树。若随后读到版本，
  // 首条的 autoFocus 会把焦点交给它。
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

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

  // Esc 与其他弹层一致：直接关掉并把焦点还给打开前的元素。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 确认框叠在历史上面时，Esc 只关最上层，历史保持打开。
      const ui = useUiStore.getState();
      if (ui.confirm || ui.prompt) return;
      event.preventDefault();
      closeHistory();
      const previous = restoreFocus.current;
      if (previous?.isConnected) previous.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeHistory]);

  if (!open) return null;

  const close = () => {
    closeHistory();
    const previous = restoreFocus.current;
    if (previous?.isConnected) previous.focus();
  };

  const showDiff = () => {
    setCurrentText(getEditorText());
    setMode("diff");
  };

  const diff =
    mode === "diff" && content !== null && currentText !== null
      ? diffLines(content, currentText)
      : null;
  const identical =
    diff !== null && diff.every((line) => line.type === "same");

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

  // 历史最多 20 个版本，逐个 Tab 太慢：像大纲一样用方向键换版本，
  // 选中即预览；只有当前版本留在 Tab 顺序里，Tab 一次就能到窗口按钮。
  const handleListKeys = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const item = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-history-index]",
    );
    if (!item) return;
    const index = Number(item.dataset.historyIndex);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index + 1;
    else if (event.key === "ArrowUp") next = index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    if (next === null) return;
    event.preventDefault();
    const position = Math.min(Math.max(next, 0), entries.length - 1);
    const target = entries[position];
    if (!target) return;
    setSelected(target.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-history-index="${position}"]`)
      ?.focus();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
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
            <ul
              className="history-list"
              ref={listRef}
              role="listbox"
              aria-label="历史版本列表"
              onKeyDown={handleListKeys}
            >
              {entries.map((entry, position) => (
                <li key={entry.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={entry.id === selected}
                    tabIndex={entry.id === selected ? 0 : -1}
                    data-history-index={position}
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
              <div className="segmented history-mode" role="group" aria-label="版本视图">
                <button
                  type="button"
                  className={mode === "content" ? "active" : ""}
                  aria-pressed={mode === "content"}
                  onClick={() => setMode("content")}
                >
                  内容
                </button>
                <button
                  type="button"
                  className={mode === "diff" ? "active" : ""}
                  aria-pressed={mode === "diff"}
                  onClick={showDiff}
                >
                  对比当前
                </button>
              </div>
              <div className="history-preview-body">
                {reading ? (
                  <div className="history-empty">读取中…</div>
                ) : mode === "diff" ? (
                  currentText === null || currentText.trim() === "" ? (
                    <div className="history-empty">
                      编辑器里还没有内容，无法对比。
                    </div>
                  ) : identical ? (
                    <div className="history-empty">与当前内容一致。</div>
                  ) : (
                    <>
                      <p className="history-diff-note">
                        与编辑器当前内容对比 · <span className="is-add">+ 新增</span>{" "}
                        / <span className="is-del">- 删除</span>
                      </p>
                      <pre
                        className="history-text history-diff"
                        role="region"
                        aria-label="与编辑器当前内容对比"
                      >
                        {(diff ?? []).map((line, index) => (
                          <span key={index} className={`history-diff-line is-${line.type}`}>
                            {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
                            {line.text}
                          </span>
                        ))}
                      </pre>
                    </>
                  )
                ) : content !== null ? (
                  <pre className="history-text">{content}</pre>
                ) : (
                  <div className="history-empty">选择左侧版本查看内容</div>
                )}
              </div>
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
