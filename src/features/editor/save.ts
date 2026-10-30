import {
  describeError,
  isAppError,
  readFile,
  writeFile,
} from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { requestPreview } from "../preview/preview-controller";
import { getEditorText, setEditorDocument } from "./editor-bridge";
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

  let text = getEditorText();
  if (text === null) return false;

  const path = doc.path;
  useDocumentStore.getState().setSaving(true);

  try {
    let meta = await writeFile(path, text, doc.savedModifiedMs);

    // 写入期间用户继续输入时，尽量把最新内容一并保存。
    let latest = getEditorText();
    if (latest !== null && latest !== text) {
      meta = await writeFile(path, latest, meta.modifiedMs);
      text = latest;
      latest = getEditorText();
    }

    const current = useDocumentStore.getState();
    const sameDocument = current.path === path;
    const stillDirty = latest !== text;

    if (sameDocument) {
      current.markSaved(meta.modifiedMs, stillDirty);
    }
    if (!stillDirty) {
      await clearRecoverySnapshot(path);
    }
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
            "磁盘上的内容与编辑器不一致，本次保存没有写入。可以直接另存一份副本，两边的修改都保留；重新加载会丢弃当前未保存的修改。",
          buttons: [
            { label: "另存副本…", value: "copy", tone: "primary" },
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

export async function reloadActiveDocument(): Promise<boolean> {
  const doc = useDocumentStore.getState();
  if (!doc.path || !doc.name) return false;

  try {
    const file = await readFile(doc.path);
    useDocumentStore.getState().setDocument(doc.path, doc.name, file.modifiedMs);
    setEditorDocument(file.content);
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
