import { getSetting, setSetting } from "../../lib/tauri";
import { useTabsStore } from "../../stores/tabs";
import { useWorkspaceStore } from "../../stores/workspace";

/**
 * 各工作区上次打开的一组标签，重启或切回库时原样摆回来。
 * 只记相对路径；内容仍以磁盘为准，文档自己保存。
 */
const KEY = "tabsByWorkspace";

let byRoot: Record<string, string[]> | null = null;
// 换库时先清空标签再恢复，这期间的库存变化不该把刚记下的列表抹掉。
// 用计数而不是布尔：连续切库时多个恢复流程可能重叠，各自结束才真正解冻。
let pauseCount = 0;

function writeCurrentTabs(): void {
  void rememberOpenTabs(useTabsStore.getState().tabs.map((tab) => tab.path));
}

async function readAll(): Promise<Record<string, string[]>> {
  if (byRoot) return byRoot;
  const raw = await getSetting<unknown>(KEY);
  const map: Record<string, string[]> = {};
  if (raw && typeof raw === "object") {
    for (const [root, paths] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (!Array.isArray(paths)) continue;
      const list = paths.filter(
        (path): path is string => typeof path === "string",
      );
      if (list.length) map[root] = list;
    }
  }
  byRoot = map;
  return map;
}

/** 记住当前工作区打开的标签；关掉全部标签时一并清掉记录。 */
export async function rememberOpenTabs(paths: string[]): Promise<void> {
  const root = useWorkspaceStore.getState().root;
  if (!root || pauseCount > 0) return;
  const map = await readAll();
  if (paths.length) map[root] = paths.slice(0, 12);
  else delete map[root];
  await setSetting(KEY, { ...map });
}

/** 某个工作区上次打开的标签路径，按打开顺序。 */
export async function recallOpenTabs(root: string): Promise<string[]> {
  const map = await readAll();
  return map[root] ?? [];
}

/** 恢复标签期间暂停落盘，避免「先清空、后补回」的中间态覆盖旧记录。 */
export function pauseTabsSave(): void {
  pauseCount += 1;
}

/** 恢复结束：解除暂停，并把当前标签写回，保证磁盘上是最终状态。 */
export function resumeTabsSave(): void {
  pauseCount = Math.max(0, pauseCount - 1);
  if (pauseCount > 0) return;
  writeCurrentTabs();
}

/**
 * 已被后来的切库请求取代：只解除自己的暂停，不写盘。
 * 否则旧库的恢复结束会把新库正在恢复的中间态当成最终标签记下。
 */
export function releaseTabsSave(): void {
  pauseCount = Math.max(0, pauseCount - 1);
}
