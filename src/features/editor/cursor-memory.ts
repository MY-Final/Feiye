import { getSetting, setSetting } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { getEditorView, jumpToEditorPosition } from "./editor-bridge";

/** 记住每篇文档上次的光标位置，重新打开时接着写。 */
const STORE_KEY = "editorPositions";
const SAVE_DELAY_MS = 400;
const MAX_ENTRIES = 200;

let positions: Record<string, number> | null = null;
let loading: Promise<void> | null = null;
let saveTimer: number | null = null;

function isPositionMap(value: unknown): value is Record<string, number> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function ensureLoaded(): Promise<void> {
  if (positions) return;
  if (!loading) {
    loading = getSetting<unknown>(STORE_KEY)
      .then((raw) => {
        positions = isPositionMap(raw) ? raw : {};
      })
      .catch(() => {
        positions = {};
      });
  }
  await loading;
}

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    if (!positions) return;
    // 只保留最近的若干个文件，避免长期使用后无限增长。
    positions = Object.fromEntries(
      Object.entries(positions).slice(-MAX_ENTRIES),
    );
    void setSetting(STORE_KEY, positions);
  }, SAVE_DELAY_MS);
}

/** 记录光标位置；顶部（0）不写，避免新文档加载时覆盖已有记录。 */
export function noteCursorOffset(path: string | null, offset: number): void {
  if (!path || offset <= 0) return;
  void ensureLoaded().then(() => {
    if (!positions) return;
    if (positions[path] === offset) return;
    positions[path] = offset;
    scheduleSave();
  });
}

/** 切换文件或清空文档前调用，把当前光标存下来；停在顶部则清掉旧记录。 */
export function captureActiveCursor(): void {
  const path = useDocumentStore.getState().path;
  const view = getEditorView();
  if (!path || !view) return;
  const offset = view.state.selection.main.head;
  if (offset > 0) {
    noteCursorOffset(path, offset);
    return;
  }
  void ensureLoaded().then(() => {
    if (!positions || positions[path] === undefined) return;
    delete positions[path];
    scheduleSave();
  });
}

/** 文件或目录改名后，把记住的光标位置一起挪到新路径。 */
export function migrateCursor(oldPath: string, nextPath: string): void {
  void ensureLoaded().then(() => {
    if (!positions) return;
    let changed = false;
    for (const [path, offset] of Object.entries(positions)) {
      const next =
        path === oldPath
          ? nextPath
          : path.startsWith(`${oldPath}/`)
            ? `${nextPath}${path.slice(oldPath.length)}`
            : null;
      if (next === null) continue;
      delete positions[path];
      positions[next] = offset;
      changed = true;
    }
    if (changed) scheduleSave();
  });
}

/** 打开文档后调用，把光标移到上次的位置；记录失效时留在开头。 */
export async function restoreCursorFor(path: string): Promise<void> {
  await ensureLoaded();
  const offset = positions?.[path] ?? 0;
  if (offset > 0) jumpToEditorPosition(offset, false);
}
