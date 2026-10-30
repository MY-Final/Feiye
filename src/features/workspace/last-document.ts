import { getSetting, setSetting } from "../../lib/tauri";
import { useWorkspaceStore } from "../../stores/workspace";

/**
 * 各工作区上次打开的文档。以前只记一个全局路径，
 * 两个库来回切换时后打开的会覆盖前一个，启动后总要重新找笔记。
 */
const KEY = "lastDocumentByWorkspace";

let byRoot: Record<string, string> | null = null;

async function readAll(): Promise<Record<string, string>> {
  if (byRoot) return byRoot;
  const raw = await getSetting<unknown>(KEY);
  const map: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [root, relPath] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (typeof relPath === "string") map[root] = relPath;
    }
  }
  byRoot = map;
  return map;
}

/** 记住当前工作区最后打开的文档；传 null 表示清除。 */
export async function rememberLastDocument(
  relPath: string | null,
): Promise<void> {
  const root = useWorkspaceStore.getState().root;
  if (!root) return;
  const map = await readAll();
  if (relPath) map[root] = relPath;
  else delete map[root];
  await setSetting(KEY, { ...map });
}

/** 取某个工作区上次打开的文档；早期版本的全局值顺手迁移过来。 */
export async function recallLastDocument(root: string): Promise<string | null> {
  const map = await readAll();
  const saved = map[root];
  if (saved) return saved;

  const legacy = await getSetting<string>("lastDocument");
  if (!legacy) return null;

  // 只迁移一次，避免把一个库的文档带到另一个库。
  await setSetting("lastDocument", null);
  if (useWorkspaceStore.getState().root === root) {
    map[root] = legacy;
    await setSetting(KEY, { ...map });
  }
  return legacy;
}
