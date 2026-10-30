import {
  clearRecovery,
  deleteRecovery,
  describeError,
  listRecoveries,
  readFile,
  saveRecovery,
  type RecoverySnapshot,
} from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { getEditorText, setEditorDocument } from "./editor-bridge";
import { requestPreview } from "../preview/preview-controller";

let prompting = false;
let recoveryWarned = false;
let writeInFlight: Promise<void> | null = null;

function formatTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "刚才";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 把当前编辑器的未保存内容写入应用数据目录。
 * 恢复副本只用于崩溃恢复，不会触碰工作区的源文件。
 */
export function snapshotActiveDocument(): Promise<void> {
  if (writeInFlight) return writeInFlight;

  const run = (async () => {
    const doc = useDocumentStore.getState();
    if (!doc.path || !doc.name || !doc.dirty) return;

    const text = getEditorText();
    if (text === null) return;

    try {
      await saveRecovery(doc.path, doc.name, text, doc.savedModifiedMs);
      recoveryWarned = false;
    } catch (error) {
      if (!recoveryWarned) {
        recoveryWarned = true;
        console.warn("恢复副本写入失败", error);
      }
    }
  })();

  writeInFlight = run;
  void run.finally(() => {
    if (writeInFlight === run) writeInFlight = null;
  });
  return run;
}

/** 正常保存、重新加载或明确放弃修改后，删除恢复副本。 */
export async function clearRecoverySnapshot(relPath: string): Promise<void> {
  try {
    // 等待正在进行的副本写入，避免清理完成后旧副本又被落盘。
    if (writeInFlight) await writeInFlight;
    await clearRecovery(relPath);
  } catch {
    // 清理失败不应阻止保存或切换文档。
  }
}

/** 用户明确放弃修改时调用。 */
export async function discardRecoveryForPath(relPath: string): Promise<void> {
  await clearRecoverySnapshot(relPath);
}

/**
 * 文档路径变化后（重命名文件或所在目录），把恢复副本迁到新路径。
 * 与自动保存共用写入锁，避免旧副本覆盖刚写入的新副本；
 * 新路径已有副本时只删旧的，保留更新的那份。
 */
export async function migrateRecoverySnapshot(
  oldPath: string,
  nextPath: string,
): Promise<void> {
  const run = (async () => {
    try {
      if (writeInFlight) await writeInFlight;
      const snapshots = await listRecoveries();
      const previous = snapshots.find((item) => item.relPath === oldPath);
      if (!previous) return;
      if (snapshots.some((item) => item.relPath === nextPath)) {
        await deleteRecovery(previous.id);
        return;
      }
      await saveRecovery(
        nextPath,
        previous.name,
        previous.content,
        previous.baseModifiedMs,
      );
      await deleteRecovery(previous.id);
    } catch {
      // 迁移失败时保留旧副本，下次启动仍会提示，不会丢内容。
    }
  })();

  writeInFlight = run;
  void run.finally(() => {
    if (writeInFlight === run) writeInFlight = null;
  });
  await run;
}

async function deleteSnapshot(id: string): Promise<void> {
  try {
    await deleteRecovery(id);
  } catch {
    // 删除失败时保留下次启动的恢复机会。
  }
}

async function restoreSnapshot(snapshot: RecoverySnapshot): Promise<boolean> {
  try {
    const file = await readFile(snapshot.relPath);
    const doc = useDocumentStore.getState();
    doc.setDocument(snapshot.relPath, snapshot.name, file.modifiedMs);
    setEditorDocument(snapshot.content);
    // 恢复出来的内容仍属于未保存内容，等用户确认或继续编辑后再由自动保存写入。
    useDocumentStore.getState().markDirty(true);
    requestPreview(snapshot.content, true);
    useUiStore
      .getState()
      .toast(`已恢复「${snapshot.name}」的未保存内容`, "success");
    return true;
  } catch (error) {
    useUiStore
      .getState()
      .toast(`恢复失败：${describeError(error)}`, "error");
    return false;
  }
}

/**
 * 启动或切换工作区后检查恢复副本。一次只恢复一篇，其余留到下次启动，
 * 避免在已打开文档时悄悄替换内容。
 */
export async function promptPendingRecoveries(): Promise<void> {
  if (prompting) return;

  prompting = true;
  try {
    const snapshots = await listRecoveries();
    if (snapshots.length === 0) return;

    for (const snapshot of snapshots) {
      // 有其他文档开着时先不动编辑器；但当前文档自己的副本仍要提示，
      // 否则启动时自动打开上次文档会把崩溃恢复整个挡掉。
      const openPath = useDocumentStore.getState().path;
      if (openPath && openPath !== snapshot.relPath) continue;

      let fileContent: string | null = null;
      let fileModifiedMs = 0;
      let missing = false;

      try {
        const file = await readFile(snapshot.relPath);
        fileContent = file.content;
        fileModifiedMs = file.modifiedMs;
      } catch {
        missing = true;
      }

      // 崩溃发生在保存完成、副本清理之前：磁盘内容已经是这份副本，直接清理。
      if (!missing && fileContent === snapshot.content) {
        await deleteSnapshot(snapshot.id);
        continue;
      }

      const changedOnDisk =
        !missing && fileModifiedMs > snapshot.savedAt + 1000;

      const choice = await useUiStore.getState().ask({
        title: "发现未保存的恢复副本",
        message: missing
          ? `「${snapshot.name}」有一份 ${formatTime(snapshot.savedAt)} 的恢复副本，但原文件已经不在。副本仍保存在本地，可以先丢弃或稍后处理。`
          : `「${snapshot.name}」有一份 ${formatTime(snapshot.savedAt)} 的恢复副本。恢复只会放回编辑器，不会立即写入磁盘。${
              changedOnDisk ? "（磁盘上的文件在副本之后被修改过。）" : ""
            }`,
        buttons: missing
          ? [
              { label: "丢弃副本", value: "discard", tone: "danger" },
              { label: "稍后", value: "later" },
            ]
          : [
              { label: "恢复内容", value: "restore", tone: "primary" },
              { label: "丢弃副本", value: "discard", tone: "danger" },
              { label: "稍后", value: "later" },
            ],
      });

      if (choice === "later") return;
      if (choice === "discard") {
        await deleteSnapshot(snapshot.id);
        continue;
      }
      if (choice === "restore") {
        await restoreSnapshot(snapshot);
        return;
      }
    }
  } catch (error) {
    useUiStore
      .getState()
      .toast(`检查恢复副本失败：${describeError(error)}`, "error");
  } finally {
    prompting = false;
  }
}
