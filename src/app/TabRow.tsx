import { TabBar } from "../features/tabs/TabBar";
import { newDocumentNearActive } from "../features/workspace/workspace-actions";
import { useWorkspaceStore } from "../stores/workspace";

/**
 * 文档标签行：从标题栏里独立出来，只覆盖编辑区。
 * 与侧栏标题同高，标签从左侧排起，「+」紧跟最后一个标签。
 */
export function TabRow() {
  const root = useWorkspaceStore((state) => state.root);

  if (!root) return null;

  return (
    <div className="doc-tabrow" data-tauri-drag-region="false">
      <TabBar />
      <button
        type="button"
        className="tab-new"
        title="新建笔记 (Ctrl+N)"
        aria-label="新建笔记"
        onClick={() => void newDocumentNearActive()}
      >
        +
      </button>
    </div>
  );
}
