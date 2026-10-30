import { saveActiveDocument } from "../features/editor/save";
import { useDocumentStore } from "../stores/document";
import { useEditorStore } from "../stores/editor";
import { useSettingsStore } from "../stores/settings";
import { useWorkspaceStore } from "../stores/workspace";

function formatSavedAt(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (!sameDay) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function StatusBar() {
  const hasWorkspace = useWorkspaceStore((state) => Boolean(state.root));
  const docPath = useDocumentStore((state) => state.path);
  const dirty = useDocumentStore((state) => state.dirty);
  const saving = useDocumentStore((state) => state.saving);
  const saveBlocked = useDocumentStore((state) => state.saveBlocked);
  const savedModifiedMs = useDocumentStore((state) => state.savedModifiedMs);
  const cursor = useDocumentStore((state) => state.cursor);
  const stats = useDocumentStore((state) => state.stats);
  const selectedWords = useEditorStore((state) => state.selectedWords);
  const autoSaveOff = useSettingsStore(
    (state) => state.preferences.autoSaveDelay <= 0,
  );

  const savedAt =
    savedModifiedMs !== null ? formatSavedAt(savedModifiedMs) : "";
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
    savedModifiedMs !== null
      ? new Date(savedModifiedMs).toLocaleString("zh-CN")
      : null,
    saveBlocked,
    dirty && autoSaveOff && !saveBlocked
      ? "自动保存已关闭，按 Ctrl+S 保存"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <footer className="statusbar">
      <span className="status-path">
        {docPath ?? (hasWorkspace ? "未选择文件" : "未打开工作区")}
      </span>
      <span className="status-meta">
        {docPath ? (
          <>
            <span>
              {cursor.line}:{cursor.column}
            </span>
            {selectedWords > 0 ? (
              <span className="status-stat" title="当前选区的字数（不含空白）">
                选中 {selectedWords.toLocaleString("zh-CN")} 字
              </span>
            ) : null}
            <span
              className="status-stat"
              title={`${stats.chars.toLocaleString("zh-CN")} 个字符（不含空白）`}
            >
              {stats.words.toLocaleString("zh-CN")} 字
            </span>
            <span>UTF-8</span>
            {saveBlocked ? (
              // 自动保存被冲突或错误挡下后，状态栏直接作为重试入口，
              // 不用让用户自己猜「按 Ctrl+S」。
              <button
                type="button"
                className="status-save status-blocked status-action"
                title={saveTitle || "点击重试保存"}
                onClick={() => void saveActiveDocument()}
              >
                <span key={saveKey} className="status-save-text">
                  {saveLabel}
                </span>
              </button>
            ) : (
              <span
                className={`status-save${dirty ? " status-dirty" : ""}`}
                title={saveTitle || undefined}
              >
                <span key={saveKey} className="status-save-text">
                  {saveLabel}
                </span>
              </span>
            )}
          </>
        ) : null}
      </span>
    </footer>
  );
}
