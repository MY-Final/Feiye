import { copyText } from "../../lib/clipboard";
import {
  baseName,
  isWithin,
  parentRel,
  relativeLinkPath,
} from "../../lib/paths";
import {
  createFile as apiCreateFile,
  createFolder as apiCreateFolder,
  deleteEntry as apiDeleteEntry,
  describeError,
  getSetting,
  openWorkspace as apiOpenWorkspace,
  pickWorkspaceFolder,
  readFile,
  renameEntry as apiRenameEntry,
  revealEntry as apiRevealEntry,
  writeFile as apiWriteFile,
  setSetting,
  type Entry,
} from "../../lib/tauri";
import { useDocumentStore, type ViewMode } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import { resetAutoSave } from "../editor/autosave";
import { captureActiveCursor, restoreCursorFor } from "../editor/cursor-memory";
import { getEditorText, setEditorDocument } from "../editor/editor-bridge";
import {
  clearRecoverySnapshot,
  promptPendingRecoveries,
} from "../editor/recovery";
import { guardUnsaved } from "../editor/save";
import {
  clearPreview,
  requestPreview,
} from "../preview/preview-controller";

const MARKDOWN_NAME = /\.(md|markdown|mdx)$/i;
const HAS_EXTENSION = /\.[^./\\]+$/;

/** 没写扩展名的 Markdown 名称补上 `.md`；已有非 Markdown 扩展名的由校验拦下。 */
function ensureMarkdownName(value: string): string {
  return MARKDOWN_NAME.test(value) ? value : `${value}.md`;
}

/** 输入校验：无扩展名视为可以自动补全，只有写了别的扩展名才报错。 */
function markdownNameError(value: string): string | null {
  if (!HAS_EXTENSION.test(value)) return null;
  return MARKDOWN_NAME.test(value) ? null : "只支持 .md / .markdown / .mdx";
}

function resetDocument(): void {
  resetAutoSave();
  captureActiveCursor();
  setEditorDocument("");
  useDocumentStore.getState().clearDocument();
  useOutlineStore.getState().clear();
  clearPreview();
}

function toastError(prefix: string, error: unknown): void {
  useUiStore.getState().toast(`${prefix}：${describeError(error)}`, "error");
}

export async function chooseWorkspace(): Promise<void> {
  try {
    const path = await pickWorkspaceFolder();
    if (path) await openWorkspaceAt(path);
  } catch (error) {
    toastError("选择文件夹失败", error);
  }
}

export async function openWorkspaceAt(path: string): Promise<void> {
  if (!(await guardUnsaved())) return;

  try {
    const info = await apiOpenWorkspace(path);
    useWorkspaceStore.getState().setWorkspace(info);
    resetDocument();
    await useWorkspaceStore.getState().loadDir("");
    await setSetting("lastWorkspace", info.root);
    await setSetting("lastDocument", null);
    void promptPendingRecoveries();
  } catch (error) {
    toastError("打开工作区失败", error);
  }
}

/** 逐级展开文件所在的父目录，让文件树能定位到它。 */
async function expandAncestors(relPath: string): Promise<void> {
  const segments = relPath.split("/").slice(0, -1);
  let dir = "";
  for (const segment of segments) {
    dir = dir ? `${dir}/${segment}` : segment;
    await useWorkspaceStore.getState().expandDir(dir);
  }
}

export async function restoreLastWorkspace(): Promise<void> {
  const last = await getSetting<string>("lastWorkspace");
  if (!last) return;

  try {
    const info = await apiOpenWorkspace(last);
    useWorkspaceStore.getState().setWorkspace(info);
    await useWorkspaceStore.getState().loadDir("");

    // 恢复上次打开的文档；文件已不存在时静默清除记录，不打扰启动。
    const lastDocument = await getSetting<string>("lastDocument");
    if (lastDocument) {
      await openFile(
        {
          relPath: lastDocument,
          name: baseName(lastDocument),
          isDir: false,
        },
        true,
      );
    }

    await promptPendingRecoveries();
  } catch {
    await setSetting("lastWorkspace", null);
  }
}

export async function openFile(
  entry: Entry,
  silent = false,
): Promise<void> {
  if (entry.isDir) return;
  if (useDocumentStore.getState().path === entry.relPath) return;
  if (!(await guardUnsaved())) return;

  try {
    const file = await readFile(entry.relPath);
    // 离开当前文档前记下光标，打开新文档后再恢复到它上次的位置。
    captureActiveCursor();
    // 先更新文档路径，图片 widget 需要在构建时解析相对地址。
    useDocumentStore
      .getState()
      .setDocument(entry.relPath, entry.name, file.modifiedMs);
    setEditorDocument(file.content);
    requestPreview(file.content, true);
    void setSetting("lastDocument", entry.relPath);
    useWorkspaceStore.getState().noteRecent(entry.relPath);
    await expandAncestors(entry.relPath);
    await restoreCursorFor(entry.relPath);
  } catch (error) {
    if (silent) {
      void setSetting("lastDocument", null);
      return;
    }
    // 可能是文件已在应用外被删除：从最近打开里摘掉，避免反复点开报错。
    useWorkspaceStore.getState().updateRecent(entry.relPath, null);
    toastError("打开文件失败", error);
  }
}

export async function createMarkdownFile(parent: string): Promise<void> {
  const name = await useUiStore.getState().askInput({
    title: "新建 Markdown 文件",
    label: "文件名",
    initialValue: "未命名.md",
    confirmLabel: "创建",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "文件名不能为空";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "文件名不能包含路径分隔符";
      }
      return markdownNameError(trimmed);
    },
  });

  if (!name) return;

  try {
    const created = await apiCreateFile(parent, ensureMarkdownName(name.trim()));
    await useWorkspaceStore.getState().refreshDir(parent);
    if (parent) await useWorkspaceStore.getState().expandDir(parent);
    await openFile(created);
  } catch (error) {
    toastError("新建文件失败", error);
  }
}

/** 把当前内容另存为同目录下的新笔记，并把编辑器切到新文件。 */
export async function saveDocumentAs(): Promise<void> {
  const doc = useDocumentStore.getState();
  if (!doc.path || !doc.name) return;

  const text = getEditorText();
  if (text === null) return;

  const parent = parentRel(doc.path);
  const name = await useUiStore.getState().askInput({
    title: "另存为",
    label: "新文件名",
    initialValue: `${doc.name.replace(MARKDOWN_NAME, "")}-副本.md`,
    confirmLabel: "保存副本",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "文件名不能为空";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "文件名不能包含路径分隔符";
      }
      return markdownNameError(trimmed);
    },
  });

  if (!name) return;

  try {
    const created = await apiCreateFile(parent, ensureMarkdownName(name.trim()));
    const meta = await apiWriteFile(created.relPath, text, null);

    // 内容已写入新文件：当前文档改指向它，保留光标与正文，视为已保存。
    const oldPath = doc.path;
    useDocumentStore.getState().renameActive(created.relPath, created.name);
    useDocumentStore.getState().markSaved(meta.modifiedMs);
    resetAutoSave();
    await clearRecoverySnapshot(oldPath);
    void setSetting("lastDocument", created.relPath);

    const workspace = useWorkspaceStore.getState();
    await workspace.refreshDir(parent);
    if (parent) await workspace.expandDir(parent);
  } catch (error) {
    toastError("另存为失败", error);
  }
}

export async function createFolderIn(parent: string): Promise<void> {
  const name = await useUiStore.getState().askInput({
    title: "新建文件夹",
    label: "文件夹名称",
    initialValue: "新建文件夹",
    confirmLabel: "创建",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "名称不能为空";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "名称不能包含路径分隔符";
      }
      return null;
    },
  });

  if (!name) return;

  try {
    const created = await apiCreateFolder(parent, name.trim());
    const workspace = useWorkspaceStore.getState();
    await workspace.refreshDir(parent);
    if (parent) await workspace.expandDir(parent);
    // 新目录默认展开，方便立刻往里新建笔记。
    await workspace.expandDir(created.relPath);
  } catch (error) {
    toastError("新建文件夹失败", error);
  }
}

/** 复制指向该文件的 Markdown 链接，基准是当前文档所在目录。 */
export async function copyEntryLink(entry: Entry): Promise<void> {
  if (entry.isDir) return;

  const fromFile = useDocumentStore.getState().path ?? entry.relPath;
  const href = relativeLinkPath(fromFile, entry.relPath);
  const label = entry.name.replace(MARKDOWN_NAME, "");
  const copied = await copyText(`[${label}](${href})`);
  useUiStore
    .getState()
    .toast(copied ? "已复制链接" : "复制到剪贴板失败", copied ? "info" : "error");
}

export async function revealEntry(entry: Entry | null): Promise<void> {
  try {
    await apiRevealEntry(entry?.relPath ?? "");
  } catch (error) {
    toastError("打开资源管理器失败", error);
  }
}

export async function renameEntry(entry: Entry): Promise<void> {
  const nextName = await useUiStore.getState().askInput({
    title: "重命名",
    label: "新名称",
    initialValue: entry.name,
    confirmLabel: "重命名",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "名称不能为空";
      if (trimmed === entry.name) return "名称没有变化";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "名称不能包含路径分隔符";
      }
      if (!entry.isDir) {
        return markdownNameError(trimmed);
      }
      return null;
    },
  });

  if (!nextName) return;
  const trimmed = nextName.trim();
  const target = entry.isDir ? trimmed : ensureMarkdownName(trimmed);
  if (target === entry.name) return;

  try {
    const renamed = await apiRenameEntry(entry.relPath, target);
    await useWorkspaceStore.getState().refreshDir(parentRel(entry.relPath));
    useWorkspaceStore.getState().updateRecent(entry.relPath, renamed.relPath);

    const doc = useDocumentStore.getState();
    if (doc.path === entry.relPath) {
      void clearRecoverySnapshot(entry.relPath);
      doc.renameActive(renamed.relPath, renamed.name);
      void setSetting("lastDocument", renamed.relPath);
    } else if (entry.isDir && doc.path && isWithin(doc.path, entry.relPath)) {
      // 当前文档所在目录被改名：保持文档打开，只把路径前缀换成新目录，
      // 正文、脏状态与自动保存都继续，避免静默丢失未保存内容。
      const nextPath = `${renamed.relPath}${doc.path.slice(entry.relPath.length)}`;
      doc.renameActive(nextPath, doc.name ?? baseName(nextPath));
      void setSetting("lastDocument", nextPath);
    }

    if (entry.isDir) {
      const { root, name, setWorkspace } = useWorkspaceStore.getState();
      if (root && name) {
        setWorkspace({ root, name });
        await useWorkspaceStore.getState().loadDir("");
      }
    }
  } catch (error) {
    toastError("重命名失败", error);
  }
}

export async function deleteEntry(entry: Entry): Promise<void> {
  const choice = await useUiStore.getState().ask({
    title: "删除",
    message: `确定将「${entry.name}」移到回收站吗？此操作可以在系统回收站中撤销。`,
    buttons: [
      { label: "移到回收站", value: "delete", tone: "danger" },
      { label: "取消", value: "cancel" },
    ],
  });

  if (choice !== "delete") return;

  try {
    await apiDeleteEntry(entry.relPath);
    await useWorkspaceStore.getState().refreshDir(parentRel(entry.relPath));
    useWorkspaceStore.getState().updateRecent(entry.relPath, null);

    const doc = useDocumentStore.getState();
    if (doc.path && isWithin(doc.path, entry.relPath)) {
      void clearRecoverySnapshot(doc.path);
      void setSetting("lastDocument", null);
      resetDocument();
    }
  } catch (error) {
    toastError("删除失败", error);
  }
}

export async function changeViewMode(mode: ViewMode): Promise<void> {
  useDocumentStore.getState().setViewMode(mode);
  await setSetting("viewMode", mode);

  const doc = useDocumentStore.getState();
  if (doc.path && (mode === "split" || mode === "preview")) {
    const text = getEditorText();
    if (text !== null) requestPreview(text, true);
  }
}

/** 在当前位置新建一篇 Markdown，并打开它。 */
export async function newDocumentNearActive(): Promise<void> {
  const doc = useDocumentStore.getState();
  await createMarkdownFile(doc.path ? parentRel(doc.path) : "");
}

/** 重命名当前文档。 */
export async function renameActiveDocument(): Promise<void> {
  const doc = useDocumentStore.getState();
  if (!doc.path || !doc.name) return;
  await renameEntry({
    name: doc.name,
    relPath: doc.path,
    isDir: false,
  });
}
