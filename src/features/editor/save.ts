import {
  describeError,
  isAppError,
  readFile,
  saveHistory,
  writeFile,
} from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { requestPreview } from "../preview/preview-controller";
import { getEditorText, setEditorDocument } from "./editor-bridge";
import { waitForCompositionEnd } from "./composition";
import {
  clearRecoverySnapshot,
  discardRecoveryForPath,
} from "./recovery";

export interface SaveOptions {
  /** 自动保存不弹冲突对话框，只暂停并提示。 */
  auto?: boolean;
}

// 自动保存与手动保存可能同时发生；串行执行，避免用旧文本覆盖新文本。
let saveQueue: Promise<boolean> = Promise.resolve(true);

export function saveActiveDocument(options: SaveOptions = {}): Promise<boolean> {
  const run = saveQueue.then(
    () => performSave(options),
    () => performSave(options),
  );
  saveQueue = run;
  return run;
}

async function performSave(options: SaveOptions): Promise<boolean> {
  const doc = useDocumentStore.getState();
  if (!doc.path) return false;

  // 组词中的正文含未上屏拼音：等提交后再读文本，别把半截拼音写进源文件。
  // 超时仍未提交则放弃本次保存，下次自动保存 / 手动保存再落盘。
  if (!(await waitForCompositionEnd())) {
    if (!options.auto) {
      useUiStore.getState().toast("输入法组词尚未结束，完成输入后再保存", "info");
    }
    return false;
  }

  const path = doc.path;
  // 等组词结束期间用户可能已切到别的笔记：此时编辑器正文已不属于 path，
  // 再读正文就会把新文档的内容写进旧文件。
  if (useDocumentStore.getState().path !== path) return false;

  let text = getEditorText();
  if (text === null) return false;

  useDocumentStore.getState().setSaving(true);

  try {
    let meta = await writeFile(path, text, doc.savedModifiedMs);

    // 写入期间用户继续输入时，尽量把最新内容一并保存；
    // 但只有仍停在同一篇时才读编辑器，避免再次串写。
    const stillSame = () => useDocumentStore.getState().path === path;
    let latest = stillSame() ? getEditorText() : null;
    if (latest !== null && latest !== text) {
      meta = await writeFile(path, latest, meta.modifiedMs);
      text = latest;
      latest = stillSame() ? getEditorText() : null;
    }

    const current = useDocumentStore.getState();
    const sameDocument = current.path === path;
    const stillDirty = latest === null || latest !== text;

    if (sameDocument) {
      current.markSaved(meta.modifiedMs, stillDirty);
    }
    if (!stillDirty) {
      await clearRecoverySnapshot(path);
    }
    // 历史快照只是顺手留档：写失败不影响保存结果。
    void saveHistory(path, text).catch(() => {});
    return sameDocument && !stillDirty;
  } catch (error) {
    const current = useDocumentStore.getState();
    const sameDocument = current.path === path;

    if (isAppError(error) && error.code === "conflict") {
      if (sameDocument && options.auto) {
        current.markSaveBlocked("文件已被其他程序修改");
        useUiStore
          .getState()
          .toast(
            "自动保存已暂停：文件已被其他程序修改。按 Ctrl+S 处理。",
            "error",
          );
      } else if (sameDocument) {
        const choice = await useUiStore.getState().ask({
          title: "文件已被其他程序修改",
          message:
            "磁盘上的内容与编辑器不一致，本次保存没有写入。覆盖保存会用编辑器里的内容替换磁盘版本（外部修改会丢失）；另存副本可保留两边的修改；重新加载会丢弃当前未保存的修改。",
          buttons: [
            { label: "另存副本…", value: "copy", tone: "primary" },
            { label: "覆盖保存", value: "overwrite", tone: "danger" },
            { label: "重新加载", value: "reload", tone: "danger" },
            { label: "取消", value: "cancel" },
          ],
        });
        if (choice === "reload") {
          await reloadActiveDocument();
        } else if (choice === "copy") {
          // save 与 workspace-actions 互相引用，用动态导入避免静态循环依赖。
          const { saveDocumentAs } = await import(
            "../workspace/workspace-actions"
          );
          await saveDocumentAs();
        } else if (choice === "overwrite") {
          return await overwriteActiveDocument(path);
        }
      }
    } else {
      if (sameDocument) {
        current.markSaveBlocked(`保存失败：${describeError(error)}`);
      }
      if (!options.auto || sameDocument) {
        useUiStore
          .getState()
          .toast(`保存失败：${describeError(error)}`, "error");
      }
    }
    return false;
  } finally {
    if (useDocumentStore.getState().path === path) {
      useDocumentStore.getState().setSaving(false);
    }
  }
}

/**
 * 冲突对话框里用户明确选择「覆盖保存」后才走这里：跳过 mtime 校验，
 * 用编辑器当前内容替换磁盘版本。只在显式点击后发生，不是静默覆盖。
 */
async function overwriteActiveDocument(path: string): Promise<boolean> {
  // 对话框期间可能已切走：编辑器正文不再属于 path，不能拿来覆盖。
  if (useDocumentStore.getState().path !== path) return false;
  const text = getEditorText();
  if (text === null) return false;

  try {
    const meta = await writeFile(path, text, null);
    const current = useDocumentStore.getState();
    if (current.path !== path) return false;

    // 写盘期间若又输入了新内容，保留脏状态；下一次自动保存会写到新基线。
    const latest = getEditorText();
    const stillDirty = latest !== null && latest !== text;
    current.markSaved(meta.modifiedMs, stillDirty);
    if (!stillDirty) await clearRecoverySnapshot(path);
    void saveHistory(path, text).catch(() => {});

    useUiStore
      .getState()
      .toast("已覆盖保存，磁盘上的外部修改已被替换", "info");
    return true;
  } catch (error) {
    useDocumentStore
      .getState()
      .markSaveBlocked(`保存失败：${describeError(error)}`);
    useUiStore
      .getState()
      .toast(`覆盖保存失败：${describeError(error)}`, "error");
    return false;
  }
}

export async function reloadActiveDocument(): Promise<boolean> {
  const doc = useDocumentStore.getState();
  if (!doc.path || !doc.name) return false;

  try {
    const file = await readFile(doc.path);
    // 读盘期间若已切到别的笔记，别把旧内容重新装回去。
    if (useDocumentStore.getState().path !== doc.path) return false;
    useDocumentStore.getState().setDocument(doc.path, doc.name, file.modifiedMs);
    setEditorDocument(file.content, doc.path);
    requestPreview(file.content, true);
    await clearRecoverySnapshot(doc.path);
    return true;
  } catch (error) {
    useUiStore.getState().toast(`重新加载失败：${describeError(error)}`, "error");
    return false;
  }
}

/**
 * 有未保存内容时询问用户。返回 true 表示可以继续后续操作。
 * 自动保存开启后，先尝试落盘；失败（例如外部冲突）才询问。
 */
export async function guardUnsaved(): Promise<boolean> {
  const doc = useDocumentStore.getState();
  if (!doc.dirty) return true;

  if (doc.path && !doc.saveBlocked) {
    const saved = await saveActiveDocument({ auto: true });
    if (saved && !useDocumentStore.getState().dirty) return true;
  }

  const choice = await useUiStore.getState().ask({
    title: "有未保存的修改",
    message: "当前文档尚未保存，继续操作会丢失这些修改。",
    buttons: [
      { label: "保存并继续", value: "save", tone: "primary" },
      { label: "放弃修改", value: "discard", tone: "danger" },
      { label: "取消", value: "cancel" },
    ],
  });

  if (choice === "cancel") return false;
  if (choice === "save") {
    const saved = await saveActiveDocument();
    return saved && !useDocumentStore.getState().dirty;
  }

  const path = useDocumentStore.getState().path;
  if (path) {
    await discardRecoveryForPath(path);
  }
  return true;
}
