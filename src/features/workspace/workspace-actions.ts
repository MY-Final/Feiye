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
  isAppError,
  listDir,
  moveEntry as apiMoveEntry,
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
import { useTabsStore } from "../../stores/tabs";
import { useOutlineStore } from "../../stores/outline";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import {
  noteDocumentChange,
  resetAutoSave,
} from "../editor/autosave";
import {
  captureActiveCursor,
  forgetCursor,
  migrateCursor,
  restoreCursorFor,
} from "../editor/cursor-memory";
import {
  clearEditorStateCache,
  forgetEditorState,
} from "../editor/editor-bridge";
import {
  getEditorText,
  getEditorView,
  jumpToEditorPosition,
  setEditorDocument,
} from "../editor/editor-bridge";
import { readOutline } from "../editor/outline";
import {
  clearRecoverySnapshot,
  migrateRecoverySnapshot,
  promptPendingRecoveries,
} from "../editor/recovery";
import { guardUnsaved, saveActiveDocument } from "../editor/save";
import {
  clearPreview,
  forgetPreview,
  requestPreview,
} from "../preview/preview-controller";
import {
  normalizeAnchor,
  scrollPreviewToHeading,
} from "../preview/preview-scroll";
import { recallLastDocument, rememberLastDocument } from "./last-document";
import { pauseTabsSave, recallOpenTabs, resumeTabsSave } from "./tabs-memory";

const MARKDOWN_NAME = /\.(md|markdown|mdx)$/i;
const HAS_EXTENSION = /\.[^./\\]+$/;

/** 已加载目录里同名文件的提示：输入阶段就告诉用户，省得关掉对话框再重来。 */
export function existingNameError(
  parent: string,
  name: string,
  selfRel?: string,
): string | null {
  const entries = useWorkspaceStore.getState().children[parent];
  if (!entries) return null;
  const hit = entries.find(
    (item) => item.name === name && item.relPath !== selfRel,
  );
  if (!hit) return null;
  return hit.isDir ? "同名文件夹已存在" : "同名文件已存在";
}

/** 没写扩展名的 Markdown 名称补上 `.md`；已有非 Markdown 扩展名的由校验拦下。 */
function ensureMarkdownName(value: string): string {
  return MARKDOWN_NAME.test(value) ? value : `${value}.md`;
}

/** 输入校验：无扩展名视为可以自动补全，只有写了别的扩展名才报错。 */
function markdownNameError(value: string): string | null {
  if (!HAS_EXTENSION.test(value)) return null;
  return MARKDOWN_NAME.test(value) ? null : "只支持 .md / .markdown / .mdx";
}

const ILLEGAL_NAME_CHAR = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** 文件系统层面的命名限制提前拦下，不要等创建失败才报一句看不懂的错。 */
export function nameCharError(value: string): string | null {
  if (ILLEGAL_NAME_CHAR.test(value)) {
    return '名称不能包含 < > : " | ? * 等字符';
  }
  if (/[. ]$/.test(value)) {
    return "名称不能以句点或空格结尾";
  }
  if (WINDOWS_RESERVED.test(value)) {
    return "名称与系统保留字冲突（如 CON、NUL、COM1）";
  }
  return null;
}

/** 在已加载的同级条目里找一个不重名的默认名称，避免连续新建时撞名。 */
function nextAvailableName(
  parent: string,
  base: string,
  extension: string,
): string {
  const siblings = useWorkspaceStore.getState().children[parent] ?? [];
  const taken = new Set(siblings.map((entry) => entry.name.toLowerCase()));
  let candidate = `${base}${extension}`;
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} ${index}${extension}`;
    index += 1;
  }
  return candidate;
}

function resetDocument(): void {
  // 文档被整体清空（切换笔记库、删除当前笔记、关闭最后一个标签）时，
  // 任何仍在进行的打开都应作废，别让它把旧笔记装回来。
  openRequestSeq += 1;
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

const RECENT_WORKSPACES_KEY = "recentWorkspaces";
const RECENT_WORKSPACES_LIMIT = 5;

/** 切换过的笔记库只记路径；切回时重新扫盘，不留任何内容副本。 */
export async function rememberWorkspace(path: string): Promise<void> {
  const raw = await getSetting<unknown>(RECENT_WORKSPACES_KEY);
  const others = Array.isArray(raw)
    ? raw.filter(
        (item): item is string => typeof item === "string" && item !== path,
      )
    : [];
  await setSetting(
    RECENT_WORKSPACES_KEY,
    [path, ...others].slice(0, RECENT_WORKSPACES_LIMIT),
  );
}

/** 库已不在（被删 / 被移走）时从最近列表摘掉，下次点菜单不再撞同一个错。 */
export async function forgetWorkspace(path: string): Promise<void> {
  const raw = await getSetting<unknown>(RECENT_WORKSPACES_KEY);
  if (!Array.isArray(raw)) return;
  const next = raw.filter(
    (item): item is string => typeof item === "string" && item !== path,
  );
  await setSetting(RECENT_WORKSPACES_KEY, next.length > 0 ? next : null);
}

/** 「最近工作区」菜单：去掉当前库，只列可以切过去的路径。 */
export async function listRecentWorkspaces(): Promise<string[]> {
  const raw = await getSetting<unknown>(RECENT_WORKSPACES_KEY);
  if (!Array.isArray(raw)) return [];
  const current = useWorkspaceStore.getState().root;
  return raw.filter(
    (item): item is string => typeof item === "string" && item !== current,
  );
}

export async function chooseWorkspace(): Promise<void> {
  try {
    const path = await pickWorkspaceFolder(
      useWorkspaceStore.getState().root ?? undefined,
    );
    if (path) await openWorkspaceAt(path);
  } catch (error) {
    toastError("选择文件夹失败", error);
  }
}

export async function openWorkspaceAt(
  path: string,
  fromRecent = false,
): Promise<void> {
  if (!(await guardUnsaved())) return;

  try {
    const info = await apiOpenWorkspace(path);
    const savedTabs = await recallOpenTabs(info.root);
    pauseTabsSave();
    useWorkspaceStore.getState().setWorkspace(info);
    // 换库是重新开始浏览，专注模式不该延续到新库上；退出时照常提示。
    if (useUiStore.getState().zenMode) {
      useUiStore.getState().toggleZenMode();
    }
    resetDocument();
    useTabsStore.getState().clear();
    clearEditorStateCache();
    await useWorkspaceStore.getState().loadDir("");
    await setSetting("lastWorkspace", info.root);
    await rememberWorkspace(info.root);

    // 每个工作区各自记着上次打开的文档：切换过来时直接打开它，
    // 和启动时一样；文件已不在时静默跳过。
    const lastDocument = await recallLastDocument(info.root);
    const active = lastDocument ?? savedTabs[0] ?? null;
    restoreSavedTabs(savedTabs, active);
    if (active) {
      await openFile(
        {
          relPath: active,
          name: baseName(active),
          isDir: false,
        },
        true,
      );
    }

    void promptPendingRecoveries();
  } catch (error) {
    // 从「最近工作区」点进来的库已经不存在：摘掉过期路径再提示，
    // 否则这个点不开的条目会在菜单里一直留着。取消未保存提示不走这里。
    const gone = fromRecent && isAppError(error) && error.code === "not-found";
    if (gone) await forgetWorkspace(path);
    useUiStore.getState().toast(
      gone
        ? `打开工作区失败：${describeError(error)}（已从最近工作区移除）`
        : `打开工作区失败：${describeError(error)}`,
      "error",
    );
  } finally {
    resumeTabsSave();
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
    const savedTabs = await recallOpenTabs(info.root);
    pauseTabsSave();
    useWorkspaceStore.getState().setWorkspace(info);
    await useWorkspaceStore.getState().loadDir("");
    await rememberWorkspace(info.root);

    // 恢复这个工作区上次打开的文档；文件已不存在时静默清除记录，不打扰启动。
    const lastDocument = await recallLastDocument(last);
    const active = lastDocument ?? savedTabs[0] ?? null;
    restoreSavedTabs(savedTabs, active);
    if (active) {
      await openFile(
        {
          relPath: active,
          name: baseName(active),
          isDir: false,
        },
        true,
      );
    }

    await promptPendingRecoveries();
  } catch {
    await setSetting("lastWorkspace", null);
  } finally {
    resumeTabsSave();
  }
}

/** 把上次打开的标签摆回标签栏；当前文档仍由 openFile 打开，避免重复。 */
function restoreSavedTabs(saved: string[], active: string | null): void {
  for (const relPath of saved) {
    if (relPath === active) continue;
    useTabsStore.getState().addTab(relPath, baseName(relPath));
  }
}

/** 跨笔记链接带 `#标题` 时，打开后定位到对应标题。 */
function jumpToAnchorInOpenDocument(fragment: string): void {
  const view = getEditorView();
  if (!view) return;

  const target = normalizeAnchor(fragment);
  if (!target) return;

  const headings = readOutline(view.state);
  const index = headings.findIndex(
    (heading) => normalizeAnchor(heading.text) === target,
  );
  if (index < 0) return;

  jumpToEditorPosition(headings[index].from);
  if (useDocumentStore.getState().viewMode === "split") {
    scrollPreviewToHeading(index);
  }
}

/** 全部折叠，但保留当前笔记的目录链展开：正在写的那篇不该从树里消失。 */
export async function collapseAllKeepingActive(): Promise<void> {
  useWorkspaceStore.getState().collapseAll();
  const path = useDocumentStore.getState().path;
  if (!path) return;
  const folders = path.split("/").slice(0, -1);
  let prefix = "";
  for (const folder of folders) {
    prefix = prefix ? `${prefix}/${folder}` : folder;
    await useWorkspaceStore.getState().expandDir(prefix);
  }
}

/**
 * 打开请求序号：快速连点两篇笔记时，以最后一次点击为准。
 * 先发起的读盘即使后返回（或用户点回当前这篇），也不能覆盖后来的选择。
 */
let openRequestSeq = 0;

export async function openFile(
  entry: Entry,
  silent = false,
  anchor?: string,
  recordHistory = true,
): Promise<void> {
  if (entry.isDir) return;
  const requestId = ++openRequestSeq;
  // 点回当前这篇：作废仍在进行的打开，最后点的算数。
  if (useDocumentStore.getState().path === entry.relPath) return;
  if (!(await guardUnsaved())) return;
  if (requestId !== openRequestSeq) return;

  try {
    const file = await readFile(entry.relPath);
    // 读盘期间又打开了别的笔记：丢弃这次过期结果，
    // 否则会用旧文档覆盖新选择。
    if (requestId !== openRequestSeq) return;
    // 成功读到新文档后再记一步浏览历史：取消未保存提示、读盘失败都不留脏记录。
    if (recordHistory) {
      const current = useDocumentStore.getState().path;
      if (current) useWorkspaceStore.getState().pushHistory(current);
      // 从文件树、链接等地方打开新文档，等于走了新分支，旧的前进记录作废。
      useWorkspaceStore.getState().clearForward();
    }
    // 离开当前文档前记下光标，打开新文档后再恢复到它上次的位置。
    captureActiveCursor();
    // 先更新文档路径，图片 widget 需要在构建时解析相对地址。
    useDocumentStore
      .getState()
      .setDocument(entry.relPath, entry.name, file.modifiedMs);
    setEditorDocument(file.content, entry.relPath);
    useTabsStore.getState().addTab(entry.relPath, entry.name);
    // 所见 / 源码模式下预览是隐藏的：不在这里让 Worker 解析整篇，
    // 切到分栏 / 预览时 changeViewMode 会立即按当前内容补一次。
    const previewMode = useDocumentStore.getState().viewMode;
    if (previewMode === "split" || previewMode === "preview") {
      requestPreview(file.content, true);
    } else {
      // 顺手释放上一篇留下的预览 HTML；切到分栏时再按当前内容重新解析。
      clearPreview();
    }
    void rememberLastDocument(entry.relPath);
    useWorkspaceStore.getState().noteRecent(entry.relPath);
    await expandAncestors(entry.relPath);
    if (requestId !== openRequestSeq) return;
    await restoreCursorFor(entry.relPath);
    if (requestId !== openRequestSeq) return;
    // 从文件树点开笔记后默认就要接着写：把焦点交给正文，
    // 纯预览模式没有可见的编辑区，不抢焦点。
    if (useDocumentStore.getState().viewMode !== "preview") {
      getEditorView()?.focus();
    }
    if (anchor) jumpToAnchorInOpenDocument(anchor);
  } catch (error) {
    // 已过期（后来点了别的笔记）的失败不必提示，也别动标签栏。
    if (requestId !== openRequestSeq) return;
    if (silent) {
      void rememberLastDocument(null);
      return;
    }
    // 可能是文件已在应用外被删除：从最近打开、浏览历史与前进栈里摘掉，
    // 避免反复点开 / 反复按 Alt+→ 都报同一个错。
    useWorkspaceStore.getState().updateRecent(entry.relPath, null);
    useWorkspaceStore.getState().forgetHistory(entry.relPath);
    useWorkspaceStore.getState().forgetForward(entry.relPath);
    useTabsStore.getState().removeTab(entry.relPath);
    forgetPreview(entry.relPath);
    toastError("打开文件失败", error);
  }
}

/** 关闭一个标签；关闭当前文档时切到相邻标签，并先处理未保存内容。 */
export async function closeDocumentTab(path: string): Promise<void> {
  const tabs = useTabsStore.getState().tabs;
  const index = tabs.findIndex((tab) => tab.path === path);
  if (index < 0) return;

  if (useDocumentStore.getState().path !== path) {
    useTabsStore.getState().removeTab(path);
    forgetEditorState(path);
    forgetPreview(path);
    return;
  }
  if (!(await guardUnsaved())) return;

  // 先按关闭前的顺序找邻居，再从列表里摘掉。
  const next = tabs[index + 1] ?? tabs[index - 1] ?? null;
  useTabsStore.getState().removeTab(path);
  forgetEditorState(path);
  forgetPreview(path);
  if (next) {
    await openFile(
      { name: next.name, relPath: next.path, isDir: false },
      false,
      undefined,
      false,
    );
  } else {
    resetDocument();
  }
}

/** Ctrl+Tab / Ctrl+Shift+Tab 在已打开的标签之间循环切换。 */
export async function switchDocumentTab(delta: number): Promise<void> {
  const tabs = useTabsStore.getState().tabs;
  if (tabs.length < 2) return;
  const active = useDocumentStore.getState().path;
  const index = tabs.findIndex((tab) => tab.path === active);
  const target =
    tabs[((index < 0 ? 0 : index) + delta + tabs.length) % tabs.length];
  if (!target || target.path === active) return;
  await openFile(
    { name: target.name, relPath: target.path, isDir: false },
    false,
    undefined,
    false,
  );
}

/** 「上一篇」的目标：本次会话里真正上一步打开的笔记。 */
export function previousDocumentPath(): string | null {
  const history = useWorkspaceStore.getState().history;
  return history[history.length - 1] ?? null;
}

/** 「下一篇」的目标：后退之后留在前进栈里的那一篇。 */
export function forwardDocumentPath(): string | null {
  const forward = useWorkspaceStore.getState().forward;
  return forward[forward.length - 1] ?? null;
}

/** 回到上一篇打开的笔记：沿着链接读下去之后，不用再去文件树里找回来的路。 */
export async function openPreviousDocument(): Promise<void> {
  const relPath = previousDocumentPath();
  if (!relPath) return;
  const from = useDocumentStore.getState().path;
  // 这次打开不再记历史，否则退一步之后「上一篇」又会指回刚离开的那篇。
  await openFile(
    { relPath, name: baseName(relPath), isDir: false },
    false,
    undefined,
    false,
  );
  // 真的打开了才退一步；被未保存提示取消或读盘失败时，历史保持原样。
  if (useDocumentStore.getState().path === relPath) {
    useWorkspaceStore.getState().popHistory();
    // 刚离开的那篇放进前进栈，Alt+→ 可以原路走回来。
    if (from) useWorkspaceStore.getState().pushForward(from);
  }
}

/** 「前进」：退回之后又想回到刚才那篇，和浏览器里的 Alt+→ 一致。 */
export async function openNextDocument(): Promise<void> {
  const relPath = forwardDocumentPath();
  if (!relPath) return;
  const from = useDocumentStore.getState().path;
  await openFile(
    { relPath, name: baseName(relPath), isDir: false },
    false,
    undefined,
    false,
  );
  if (useDocumentStore.getState().path === relPath) {
    useWorkspaceStore.getState().popForward();
    // 前进也是一次真实的浏览，退回时仍应经过这一篇。
    if (from) useWorkspaceStore.getState().pushHistory(from);
  }
}

export async function createMarkdownFile(parent: string): Promise<void> {
  const name = await useUiStore.getState().askInput({
    // 从文件树右键新建时，标题里带上目标目录，避免建到别的文件夹里。
    title: parent ? `新建 Markdown · ${parent}` : "新建 Markdown 文件",
    label: "文件名",
    initialValue: nextAvailableName(parent, "未命名", ".md"),
    confirmLabel: "创建",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "文件名不能为空";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "文件名不能包含路径分隔符";
      }
      return (
        nameCharError(trimmed) ??
        markdownNameError(trimmed) ??
        existingNameError(parent, ensureMarkdownName(trimmed))
      );
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
  const copyBase = `${doc.name.replace(MARKDOWN_NAME, "")}-副本`;
  const name = await useUiStore.getState().askInput({
    // 副本会落在当前笔记所在目录，和右键新建一样把位置写进标题里。
    title: parent ? `另存为 · ${parent}` : "另存为",
    label: parent ? `新文件名（保存在 ${parent}）` : "新文件名",
    // 连续另存时默认名自动加序号，不再撞上上一篇副本报「目标已存在」。
    initialValue: nextAvailableName(parent, copyBase, ".md"),
    confirmLabel: "保存副本",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "文件名不能为空";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "文件名不能包含路径分隔符";
      }
      return (
        nameCharError(trimmed) ??
        markdownNameError(trimmed) ??
        existingNameError(parent, ensureMarkdownName(trimmed))
      );
    },
  });

  if (!name) return;

  try {
    const created = await apiCreateFile(parent, ensureMarkdownName(name.trim()));
    const meta = await apiWriteFile(created.relPath, text, null);

    // 写入期间用户可能继续输入：只有编辑器内容仍等于写入内容时才算已保存，
    // 否则保持脏状态并重新排自动保存，避免关闭时静默丢掉这段新输入。
    const latest = getEditorText();
    const stillDirty = latest !== null && latest !== text;
    const oldPath = doc.path;
    useDocumentStore.getState().renameActive(created.relPath, created.name);
    useDocumentStore.getState().markSaved(meta.modifiedMs, stillDirty);
    resetAutoSave();
    if (stillDirty) noteDocumentChange();
    await clearRecoverySnapshot(oldPath);
    void rememberLastDocument(created.relPath);
    // 当前打开的笔记一定在「最近打开」里，另存出来的副本也不例外。
    useWorkspaceStore.getState().noteRecent(created.relPath);

    const workspace = useWorkspaceStore.getState();
    await workspace.refreshDir(parent);
    if (parent) await workspace.expandDir(parent);
    // 编辑器已经切到副本，再明确说一句存在哪，避免以为只是切换了视图。
    useUiStore.getState().toast(`已另存为 ${created.relPath}`);
  } catch (error) {
    toastError("另存为失败", error);
  }
}

export async function createFolderIn(parent: string): Promise<void> {
  const name = await useUiStore.getState().askInput({
    title: parent ? `新建文件夹 · ${parent}` : "新建文件夹",
    label: "文件夹名称",
    initialValue: nextAvailableName(parent, "新建文件夹", ""),
    confirmLabel: "创建",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "名称不能为空";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "名称不能包含路径分隔符";
      }
      return (
        nameCharError(trimmed) ?? existingNameError(parent, trimmed.trim())
      );
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
    // 同名文件可能散在好几个目录里，标题带上路径才改得准。
    title: parentRel(entry.relPath)
      ? `重命名 · ${entry.relPath}`
      : "重命名",
    label: "新名称",
    initialValue: entry.name,
    confirmLabel: "重命名",
    selectBaseName: !entry.isDir,
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "名称不能为空";
      if (trimmed === entry.name) return "名称没有变化";
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return "名称不能包含路径分隔符";
      }
      const base = entry.isDir
        ? nameCharError(trimmed)
        : (nameCharError(trimmed) ?? markdownNameError(trimmed));
      if (base) return base;
      return existingNameError(
        parentRel(entry.relPath),
        entry.isDir ? trimmed : ensureMarkdownName(trimmed),
        entry.relPath,
      );
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
    useWorkspaceStore.getState().remapHistory(entry.relPath, renamed.relPath);
    useTabsStore.getState().remap(entry.relPath, renamed.relPath);
    // 改名后路径变了，光标记录也换到新路径，重新打开时才能接着上次的位置写。
    migrateCursor(entry.relPath, renamed.relPath);

    const doc = useDocumentStore.getState();
    if (doc.path === entry.relPath) {
      // 恢复副本跟着改名迁移，而不是直接删掉：改名后若立刻崩溃，
      // 未保存的内容仍能找回。
      const oldPath = doc.path;
      doc.renameActive(renamed.relPath, renamed.name);
      void rememberLastDocument(renamed.relPath);
      void migrateRecoverySnapshot(oldPath, renamed.relPath);
    } else if (entry.isDir && doc.path && isWithin(doc.path, entry.relPath)) {
      // 当前文档所在目录被改名：保持文档打开，只把路径前缀换成新目录，
      // 正文、脏状态与自动保存都继续，避免静默丢失未保存内容。
      const oldPath = doc.path;
      const nextPath = `${renamed.relPath}${oldPath.slice(entry.relPath.length)}`;
      doc.renameActive(nextPath, doc.name ?? baseName(nextPath));
      void rememberLastDocument(nextPath);
      // 恢复副本按旧路径保存，迁移过去，避免下次启动误报「原文件已不在」。
      void migrateRecoverySnapshot(oldPath, nextPath);
    }

    if (entry.isDir) {
      const { root, name, expanded, setWorkspace, history, forward } =
        useWorkspaceStore.getState();
      if (root && name) {
        // 展开状态里的路径跟着改名换前缀，重建后再恢复，
        // 避免改完目录整个树收起、当前文档被藏起来。
        const remap = (path: string) =>
          path === entry.relPath || path.startsWith(`${entry.relPath}/`)
            ? `${renamed.relPath}${path.slice(entry.relPath.length)}`
            : path;
        const openDirs = Object.entries(expanded)
          .filter(([, open]) => open)
          .map(([path]) => remap(path))
          .sort((a, b) => a.split("/").length - b.split("/").length);

        setWorkspace({ root, name });
        // 重建文件树只为刷新展开状态，会话内的浏览历史与前进栈不能跟着清空。
        useWorkspaceStore.setState({ history, forward });
        await useWorkspaceStore.getState().loadDir("");
        await useWorkspaceStore.getState().expandDirs(openDirs);
      }
    }
  } catch (error) {
    toastError("重命名失败", error);
  }
}

/**
 * 把文件 / 文件夹拖到另一个目录下。
 * 和改名共用同一套迁移：最近打开、光标记录、恢复副本、当前文档路径都要跟着走。
 */
export async function moveEntry(
  entry: Entry,
  targetParent: string,
): Promise<void> {
  if (targetParent === parentRel(entry.relPath)) return;

  if (entry.isDir && isWithin(targetParent, entry.relPath)) {
    useUiStore.getState().toast("不能把文件夹移动到它自己里面", "error");
    return;
  }

  const conflict = existingNameError(targetParent, entry.name, entry.relPath);
  if (conflict) {
    useUiStore.getState().toast(conflict, "error");
    return;
  }

  try {
    const moved = await apiMoveEntry(entry.relPath, targetParent);
    const oldParent = parentRel(entry.relPath);
    await useWorkspaceStore.getState().refreshDir(oldParent);
    // 根目录的 key 是空字符串，也要刷新，否则拖回根目录后树里看不到。
    await useWorkspaceStore.getState().refreshDir(targetParent);

    useWorkspaceStore.getState().updateRecent(entry.relPath, moved.relPath);
    useWorkspaceStore.getState().remapHistory(entry.relPath, moved.relPath);
    useTabsStore.getState().remap(entry.relPath, moved.relPath);
    migrateCursor(entry.relPath, moved.relPath);

    const doc = useDocumentStore.getState();
    if (doc.path === entry.relPath) {
      const oldPath = doc.path;
      doc.renameActive(moved.relPath, moved.name);
      void rememberLastDocument(moved.relPath);
      void migrateRecoverySnapshot(oldPath, moved.relPath);
    } else if (entry.isDir && doc.path && isWithin(doc.path, entry.relPath)) {
      // 当前文档就在被拖走的文件夹里：保持打开，只换路径前缀。
      const oldPath = doc.path;
      const nextPath = `${moved.relPath}${oldPath.slice(entry.relPath.length)}`;
      doc.renameActive(nextPath, doc.name ?? baseName(nextPath));
      void rememberLastDocument(nextPath);
      void migrateRecoverySnapshot(oldPath, nextPath);
    }

    if (entry.isDir) {
      // 整个目录换了前缀，展开状态要重映射后再重建，免得树收起来。
      const { root, name, expanded, setWorkspace, history, forward } =
        useWorkspaceStore.getState();
      if (root && name) {
        const remap = (path: string) =>
          path === entry.relPath || path.startsWith(`${entry.relPath}/`)
            ? `${moved.relPath}${path.slice(entry.relPath.length)}`
            : path;
        const openDirs = Object.entries(expanded)
          .filter(([, open]) => open)
          .map(([path]) => remap(path))
          .sort((a, b) => a.split("/").length - b.split("/").length);
        if (targetParent && !openDirs.includes(targetParent)) {
          openDirs.push(targetParent);
        }
        setWorkspace({ root, name });
        // 重建文件树只为刷新展开状态，会话内的浏览历史与前进栈不能跟着清空。
        useWorkspaceStore.setState({ history, forward });
        await useWorkspaceStore.getState().loadDir("");
        await useWorkspaceStore.getState().expandDirs(openDirs);
      }
    } else if (targetParent) {
      // 目标文件夹原本是收起的就展开，拖完马上能看到结果。
      await useWorkspaceStore.getState().expandDir(targetParent);
    }

    useUiStore
      .getState()
      .toast(targetParent ? `已移动到 ${targetParent}` : "已移动到根目录");
  } catch (error) {
    toastError("移动失败", error);
  }
}

/** 统计文件夹里会被一起删掉的内容：上限内扫完，别为大目录卡住确认框。 */
async function countFolderContents(
  relPath: string,
): Promise<{ files: number; dirs: number; capped: boolean }> {
  const LIMIT = 500;
  let files = 0;
  let dirs = 0;
  const queue = [relPath];
  while (queue.length > 0) {
    if (files + dirs >= LIMIT) return { files, dirs, capped: true };
    const current = queue.shift();
    if (!current) break;
    let entries: Entry[] = [];
    try {
      entries = await listDir(current);
    } catch {
      // 读不到的目录不计入，删除本身仍交给后端裁决。
      continue;
    }
    for (const item of entries) {
      if (files + dirs >= LIMIT) return { files, dirs, capped: true };
      if (item.isDir) {
        dirs += 1;
        queue.push(item.relPath);
      } else {
        files += 1;
      }
    }
  }
  return { files, dirs, capped: false };
}

/** 删目录时把"里面还有多少东西"说清楚，避免以为只删了一个空壳。 */
function folderContentsNote(count: {
  files: number;
  dirs: number;
  capped: boolean;
}): string {
  const parts: string[] = [];
  if (count.files > 0) parts.push(`${count.files} 个文件`);
  if (count.dirs > 0) parts.push(`${count.dirs} 个子文件夹`);
  if (parts.length === 0) return "";
  const prefix = count.capped ? "至少 " : "";
  return `其中的${prefix}${parts.join("、")}也会一起进回收站。`;
}

export async function deleteEntry(entry: Entry): Promise<void> {
  // 删除正在编辑且未保存的文件（或它所在的文件夹）时，编辑器里的内容
  // 会随文档一起清空，必须在确认框里说清楚，不能只提回收站可撤销。
  const doc = useDocumentStore.getState();
  const deletingActive = Boolean(
    doc.path && isWithin(doc.path, entry.relPath),
  );
  const hasUnsaved = deletingActive && doc.dirty;
  // 同名文件可能散在好几个目录里，确认框带上路径才删得准。
  const shown = `「${parentRel(entry.relPath) ? entry.relPath : entry.name}」`;
  const inside = entry.isDir
    ? folderContentsNote(await countFolderContents(entry.relPath))
    : "";

  const choice = await useUiStore.getState().ask({
    title: "删除",
    message: hasUnsaved
      ? `${shown}里有正在编辑的笔记，还有未保存的修改。${inside}可以直接删掉，也可以先保存再删除——保存后的内容会随文件一起进回收站。`
      : `确定将${shown}移到回收站吗？${inside}此操作可以在系统回收站中撤销。`,
    buttons: hasUnsaved
      ? [
          { label: "保存后删除", value: "save-delete", tone: "primary" },
          { label: "直接删除", value: "delete", tone: "danger" },
          { label: "取消", value: "cancel" },
        ]
      : [
          { label: "移到回收站", value: "delete", tone: "danger" },
          { label: "取消", value: "cancel" },
        ],
  });

  if (choice === "save-delete") {
    // 保存失败（冲突、IO 错误或用户取消重载）时放弃删除，避免内容真的丢掉。
    if (!(await saveActiveDocument())) return;
  } else if (choice !== "delete") {
    return;
  }

  try {
    await apiDeleteEntry(entry.relPath);
    await useWorkspaceStore.getState().refreshDir(parentRel(entry.relPath));
    useWorkspaceStore.getState().updateRecent(entry.relPath, null);
    // 删除目录时，历史和前进栈里它下面的笔记也一起摘掉，返回不再撞旧路径。
    useWorkspaceStore.getState().remapHistory(entry.relPath, null);
    useTabsStore.getState().remap(entry.relPath, null);

    const doc = useDocumentStore.getState();
    if (doc.path && isWithin(doc.path, entry.relPath)) {
      void clearRecoverySnapshot(doc.path);
      void rememberLastDocument(null);
      resetDocument();
    }
    // resetDocument 会先把当前光标记下来，所以清理放在它之后，
    // 否则同名新文件打开时会跳到被删文档的旧位置。
    forgetCursor(entry.relPath);
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
  // 切回可编辑的视图后焦点交给正文，Ctrl+E 来回按也能直接接着写。
  // 设置面板里改「默认视图」也会走到这里，那时不能把焦点抢到遮罩后面。
  const ui = useUiStore.getState();
  if (doc.path && mode !== "preview" && !ui.settingsOpen && !ui.confirm && !ui.prompt) {
    requestAnimationFrame(() => getEditorView()?.focus());
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
