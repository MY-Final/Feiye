import { useState, type MouseEvent } from "react";

import { ContextMenu, type MenuAction } from "../../components/Menu";
import { OutlinePanel } from "../outline/OutlinePanel";
import { parentRel } from "../../lib/paths";
import type { Entry } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";
import { useWorkspaceStore } from "../../stores/workspace";
import {
  createMarkdownFile,
  deleteEntry,
  openFile,
  renameEntry,
} from "./workspace-actions";

interface MenuState {
  x: number;
  y: number;
  entry: Entry | null;
}

function buildMenuActions(entry: Entry | null): MenuAction[] {
  const parent = entry
    ? entry.isDir
      ? entry.relPath
      : parentRel(entry.relPath)
    : "";

  const actions: MenuAction[] = [
    {
      label: "新建 Markdown",
      onSelect: () => {
        void createMarkdownFile(parent);
      },
    },
  ];

  if (entry) {
    actions.push({
      label: "重命名",
      onSelect: () => {
        void renameEntry(entry);
      },
    });
    actions.push({
      label: "删除",
      danger: true,
      onSelect: () => {
        void deleteEntry(entry);
      },
    });
  }

  return actions;
}

interface TreeNodeProps {
  entry: Entry;
  depth: number;
  onMenu(event: MouseEvent, entry: Entry): void;
}

function TreeNode({ entry, depth, onMenu }: TreeNodeProps) {
  const expanded = useWorkspaceStore((state) =>
    Boolean(state.expanded[entry.relPath]),
  );
  const children = useWorkspaceStore((state) => state.children[entry.relPath]);
  const loading = useWorkspaceStore((state) =>
    Boolean(state.loading[entry.relPath]),
  );
  const active = useDocumentStore((state) => state.path === entry.relPath);
  const toggleDir = useWorkspaceStore((state) => state.toggleDir);

  const indent = 8 + depth * 14;

  return (
    <div className="tree-node">
      <button
        type="button"
        className={`tree-row${active ? " active" : ""}`}
        style={{ paddingLeft: indent }}
        title={entry.name}
        onClick={() => {
          if (entry.isDir) {
            void toggleDir(entry.relPath);
          } else {
            void openFile(entry);
          }
        }}
        onContextMenu={(event) => onMenu(event, entry)}
      >
        <span className={`tree-caret${entry.isDir ? " visible" : ""}`}>
          {entry.isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className="tree-label">{entry.name}</span>
      </button>

      {entry.isDir && expanded ? (
        <div className="tree-children">
          {!children && loading ? (
            <div className="tree-hint" style={{ paddingLeft: indent + 14 }}>
              加载中…
            </div>
          ) : null}
          {children?.map((child) => (
            <TreeNode
              key={child.relPath}
              entry={child}
              depth={depth + 1}
              onMenu={onMenu}
            />
          ))}
          {children && children.length === 0 ? (
            <div className="tree-hint" style={{ paddingLeft: indent + 14 }}>
              空
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type SidebarTab = "files" | "outline";

export function WorkspaceSidebar() {
  const children = useWorkspaceStore((state) => state.children[""]);
  const rootLoading = useWorkspaceStore((state) => Boolean(state.loading[""]));
  const headingCount = useOutlineStore((state) => state.headings.length);
  const [tab, setTab] = useState<SidebarTab>("files");
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = (event: MouseEvent, entry: Entry | null) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };

  return (
    <aside className="sidebar" aria-label="工作区文件与大纲">
      <div className="sidebar-header">
        <div className="sidebar-tabs" role="tablist" aria-label="侧栏内容">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            className={`sidebar-tab${tab === "files" ? " active" : ""}`}
            onClick={() => {
              setMenu(null);
              setTab("files");
            }}
          >
            文件
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "outline"}
            className={`sidebar-tab${tab === "outline" ? " active" : ""}`}
            onClick={() => {
              setMenu(null);
              setTab("outline");
            }}
          >
            大纲
            {headingCount > 0 ? (
              <span className="sidebar-count">{headingCount}</span>
            ) : null}
          </button>
        </div>

        {tab === "files" ? (
          <button
            type="button"
            className="icon-btn"
            title="新建 Markdown"
            onClick={() => {
              void createMarkdownFile("");
            }}
          >
            ＋
          </button>
        ) : null}
      </div>

      {tab === "files" ? (
        <div
          className="tree"
          onContextMenu={(event) => {
            // 只在空白区域弹出根目录菜单，行上的右键由 TreeNode 处理。
            const target = event.target as HTMLElement;
            if (!target.closest(".tree-row")) openMenu(event, null);
          }}
          onMouseDown={(event) => {
            // 点击空白区域关闭右键菜单。
            if (event.target === event.currentTarget && menu) setMenu(null);
          }}
        >
          {children?.map((entry) => (
            <TreeNode key={entry.relPath} entry={entry} depth={0} onMenu={openMenu} />
          ))}

          {!children && rootLoading ? (
            <div className="tree-hint">加载中…</div>
          ) : null}

          {children && children.length === 0 ? (
            <div className="tree-hint">
              这个文件夹里还没有 Markdown 文件
            </div>
          ) : null}
        </div>
      ) : (
        <OutlinePanel />
      )}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={buildMenuActions(menu.entry)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </aside>
  );
}
