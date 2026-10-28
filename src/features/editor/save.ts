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

/**
 * 保存当前文档。返回是否成功写入磁盘。
 * 保存前携带打开/上次保存时的 mtime，磁盘被外部改动时拒绝覆盖。
 */
export async function saveActiveDocument(): Promise<boolean> {
  const doc = useDocumentStore.getState();
  if (!doc.path) return false;

  const text = getEditorText();
  if (text === null) return false;

  try {
    const meta = await writeFile(doc.path, text, doc.savedModifiedMs);
    useDocumentStore.getState().markSaved(meta.modifiedMs);
    return true;
  } catch (error) {
    if (isAppError(error) && error.code === "conflict") {
      const choice = await useUiStore.getState().ask({
        title: "文件已被其他程序修改",
        message:
          "磁盘上的内容与编辑器不一致，本次保存没有写入。重新加载会丢弃当前未保存的修改。",
        buttons: [
          { label: "重新加载", value: "reload", tone: "danger" },
          { label: "取消", value: "cancel" },
        ],
      });
      if (choice === "reload") {
        await reloadActiveDocument();
      }
    } else {
      useUiStore.getState().toast(`保存失败：${describeError(error)}`, "error");
    }
    return false;
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
    return true;
  } catch (error) {
    useUiStore.getState().toast(`重新加载失败：${describeError(error)}`, "error");
    return false;
  }
}

/**
 * 有未保存内容时询问用户。返回 true 表示可以继续后续操作。
 */
export async function guardUnsaved(): Promise<boolean> {
  if (!useDocumentStore.getState().dirty) return true;

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
  if (choice === "save") return saveActiveDocument();
  return true;
}
