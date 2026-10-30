import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { ContextMenu, type MenuAction } from "../../components/Menu";
import { copyText } from "../../lib/clipboard";
import { OutlinePanel } from "../outline/OutlinePanel";
import { parentRel } from "../../lib/paths";
import { getSetting, setSetting, type Entry } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import {
  collapseAllKeepingActive,
  copyEntryLink,
  createFolderIn,
  createMarkdownFile,
  deleteEntry,
  openFile,
  renameEntry,
  revealEntry,
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
    {
      label: "新建文件夹",
      onSelect: () => {
        void createFolderIn(parent);
      },
    },
    {
      label: "在资源管理器中显示",
      onSelect: () => {
        void revealEntry(entry);
      },
    },
  ];

  if (entry && !entry.isDir) {
    actions.push({
      label: "复制链接",
      onSelect: () => {
        void copyEntryLink(entry);
      },
    });
  }

  if (entry) {
    actions.push({
      // 贴到终端、别的应用里用的是完整路径，按工作区根拼出来。
      label: "复制路径",
      onSelect: () => {
        const root = useWorkspaceStore.getState().root;
        if (!root) return;
        const sep = root.includes("\\") ? "\\" : "/";
        const full = `${root}${sep}${entry.relPath.split("/").join(sep)}`;
        void copyText(full).then((copied) => {
          useUiStore
            .getState()
            .toast(copied ? "已复制路径" : "复制到剪贴板失败", copied ? "info" : "error");
        });
      },
    });
  }

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`tree-chevron${open ? " open" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 3.6 10.4 8 6 12.4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        className="folder-shape"
        d="M13.3 13.3a1.3 1.3 0 0 0 1.3-1.3V5.3a1.3 1.3 0 0 0-1.3-1.3H8.1a1.3 1.3 0 0 1-1.1-.6L6.4 2.6A1.3 1.3 0 0 0 5.3 2H2.7A1.3 1.3 0 0 0 1.4 3.3v8.7a1.3 1.3 0 0 0 1.3 1.3Z"
      />
    </svg>
  );
}

function MarkdownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect className="md-badge" x="1" y="2.6" width="14" height="10.8" rx="2" />
      <path className="md-mark" d="M3.7 10.2V5.9l1.8 2.2 1.8-2.2v4.3" />
      <path className="md-mark" d="M11.2 5.9v4m0 0L9.9 8.6m1.3 1.3 1.3-1.3" />
    </svg>
  );
}

function NewFileIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.2 2.5H4.6c-.7 0-1.2.5-1.2 1.2v8.6c0 .7.5 1.2 1.2 1.2h6.8c.7 0 1.2-.5 1.2-1.2V5.9L9.2 2.5z" />
      <path d="M9.2 2.7v3.2h3.3" />
      <path d="M8 8.3v3.2M6.4 9.9h3.2" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.7 4.3c0-.6.5-1.1 1.1-1.1h3l1.2 1.4h6.2c.6 0 1.1.5 1.1 1.1v5.9c0 .6-.5 1.1-1.1 1.1H2.8c-.6 0-1.1-.5-1.1-1.1V4.3z" />
      <path d="M8 7v3.4M6.3 8.7h3.4" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.4 3.2v3.6H9.8" />
      <path d="M12.8 9.2a5 5 0 1 1-1.4-4.8" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.8 6.4 8 3.2l3.2 3.2" />
      <path d="M4.8 9.6 8 12.8l3.2-3.2" />
    </svg>
  );
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
  const rowRef = useRef<HTMLButtonElement>(null);

  // 打开文件（含链接跳转、启动恢复）后让它在树里进入可见范围。
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const indent = 4 + depth * 14;

  return (
    <div className="tree-node">
      <button
        type="button"
        ref={rowRef}
        className={`tree-row${active ? " active" : ""}`}
        style={{ paddingLeft: indent }}
        title={entry.name}
        data-depth={depth}
        aria-expanded={entry.isDir ? expanded : undefined}
        onClick={() => {
          if (entry.isDir) {
            void toggleDir(entry.relPath);
          } else {
            void openFile(entry);
          }
        }}
        onContextMenu={(event) => onMenu(event, entry)}
        // 和文件管理器一致：F2 / Delete 针对的是获得焦点这一行，
        // 而不是编辑器里打开的那篇；删除仍走确认框。
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            event.stopPropagation();
            void renameEntry(entry);
          } else if (event.key === "Delete") {
            event.preventDefault();
            event.stopPropagation();
            void deleteEntry(entry);
          }
        }}
      >
        <span className="tree-caret">
          {entry.isDir ? <ChevronIcon open={expanded} /> : null}
        </span>
        <span className={`tree-icon ${entry.isDir ? "folder" : "markdown"}`}>
          {entry.isDir ? <FolderIcon /> : <MarkdownIcon />}
        </span>
        <span className="tree-label">{entry.name}</span>
      </button>

      {entry.isDir && expanded ? (
        <div
          className="tree-children"
          style={{ "--guide-left": `${indent + 8}px` } as CSSProperties}
        >
          {!children && loading ? (
            <div className="tree-hint" style={{ paddingLeft: indent + 36 }}>
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
            <div className="tree-hint" style={{ paddingLeft: indent + 36 }}>
              空
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type SidebarTab = "files" | "outline";

const SIDEBAR_WIDTH_KEY = "sidebarWidth";
const SIDEBAR_TAB_KEY = "sidebarTab";
const SIDEBAR_WIDTH = { min: 180, max: 420, default: 240 } as const;

function clampSidebarWidth(value: number): number {
  return Math.min(
    SIDEBAR_WIDTH.max,
    Math.max(SIDEBAR_WIDTH.min, Math.round(value)),
  );
}

export function WorkspaceSidebar() {
  const children = useWorkspaceStore((state) => state.children[""]);
  const rootLoading = useWorkspaceStore((state) => Boolean(state.loading[""]));
  const refreshTree = useWorkspaceStore((state) => state.refreshTree);
  const headingCount = useOutlineStore((state) => state.headings.length);
  const [tab, setTab] = useState<SidebarTab>("files");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [width, setWidth] = useState<number>(SIDEBAR_WIDTH.default);
  const widthRef = useRef<number>(SIDEBAR_WIDTH.default);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  // 记住上次看的标签：常看大纲的人重启后不用每次再点一下。
  useEffect(() => {
    void getSetting<unknown>(SIDEBAR_TAB_KEY).then((value) => {
      if (value === "files" || value === "outline") setTab(value);
    });
  }, []);

  useEffect(() => {
    void getSetting<number>(SIDEBAR_WIDTH_KEY).then((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const next = clampSidebarWidth(value);
      widthRef.current = next;
      setWidth(next);
    });
  }, []);

  const selectTab = (next: SidebarTab) => {
    setMenu(null);
    setTab(next);
    void setSetting(SIDEBAR_TAB_KEY, next);
  };

  const commitWidth = (value: number) => {
    const next = clampSidebarWidth(value);
    widthRef.current = next;
    setWidth(next);
    void setSetting(SIDEBAR_WIDTH_KEY, next);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeStart.current = { x: event.clientX, width: widthRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    const next = clampSidebarWidth(
      resizeStart.current.width + event.clientX - resizeStart.current.x,
    );
    widthRef.current = next;
    setWidth(next);
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void setSetting(SIDEBAR_WIDTH_KEY, widthRef.current);
  };

  // 方向键按 8px 调宽，按住 Shift 一次 32px；Home 回到默认宽度。
  const keyResize = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = widthRef.current - step;
    else if (event.key === "ArrowRight") next = widthRef.current + step;
    else if (event.key === "Home") next = SIDEBAR_WIDTH.default;
    if (next === null) return;
    event.preventDefault();
    commitWidth(next);
  };

  const openMenu = (event: MouseEvent, entry: Entry | null) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };

  // 文件树按文件管理器的习惯支持方向键：上下移动、左右折叠展开、
  // Home / End 跳到首尾。行本身是按钮，Enter 由浏览器转成点击。
  const handleTreeKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const row = (event.target as Element | null)?.closest<HTMLElement>(
      ".tree-row",
    );
    if (!row) return;

    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(".tree-row"),
    );
    const index = rows.indexOf(row);
    if (index < 0) return;

    const focusRow = (next: HTMLElement | undefined) => next?.focus();
    const expanded = row.getAttribute("aria-expanded");

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(rows[index + 1]);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(rows[index - 1]);
        break;
      case "Home":
        event.preventDefault();
        focusRow(rows[0]);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows[rows.length - 1]);
        break;
      case "ArrowRight":
        // 已展开就进到第一个子项，折叠的则就地展开。
        if (expanded === "false") {
          event.preventDefault();
          row.click();
        } else if (expanded === "true") {
          event.preventDefault();
          focusRow(rows[index + 1]);
        }
        break;
      case "ArrowLeft": {
        if (expanded === "true") {
          event.preventDefault();
          row.click();
          break;
        }
        // 折叠状态或普通文件：回到同层的父文件夹。
        const depth = Number(row.dataset.depth ?? "0");
        if (depth <= 0) break;
        for (let i = index - 1; i >= 0; i -= 1) {
          if (Number(rows[i].dataset.depth) === depth - 1) {
            event.preventDefault();
            rows[i].focus();
            break;
          }
        }
        break;
      }
      default:
        break;
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshTree();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <aside
      className="sidebar"
      style={{ width }}
      aria-label="工作区文件与大纲"
    >
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        aria-valuemin={SIDEBAR_WIDTH.min}
        aria-valuemax={SIDEBAR_WIDTH.max}
        aria-valuenow={width}
        // 分隔条可以 Tab 聚焦、用方向键调宽，和分栏分隔条一致。
        tabIndex={0}
        title="拖动或左右方向键调整侧栏宽度，双击 / Home 恢复默认"
        onKeyDown={keyResize}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => commitWidth(SIDEBAR_WIDTH.default)}
      />
      <div className="sidebar-header">
        <div className="sidebar-tabs" role="tablist" aria-label="侧栏内容">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            className={`sidebar-tab${tab === "files" ? " active" : ""}`}
            onClick={() => selectTab("files")}
          >
            文件
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "outline"}
            className={`sidebar-tab${tab === "outline" ? " active" : ""}`}
            onClick={() => selectTab("outline")}
          >
            大纲
            {headingCount > 0 ? (
              <span className="sidebar-count">{headingCount}</span>
            ) : null}
          </button>
        </div>

        {tab === "files" ? (
          <div className="sidebar-actions">
            <button
              type="button"
              className="sidebar-action"
              title="新建 Markdown"
              aria-label="新建 Markdown"
              onClick={() => {
                void createMarkdownFile("");
              }}
            >
              <NewFileIcon />
            </button>
            <button
              type="button"
              className="sidebar-action"
              title="新建文件夹"
              aria-label="新建文件夹"
              onClick={() => {
                void createFolderIn("");
              }}
            >
              <NewFolderIcon />
            </button>
            <button
              type="button"
              className="sidebar-action"
              title="刷新文件树"
              aria-label="刷新文件树"
              disabled={refreshing}
              onClick={() => {
                void handleRefresh();
              }}
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              className="sidebar-action"
              title="全部折叠（保留当前笔记所在目录）"
              aria-label="全部折叠"
              onClick={() => {
                void collapseAllKeepingActive().then(() => {
                  // 展开目录后把当前笔记滚回可见范围，省得自己找。
                  requestAnimationFrame(() => {
                    document
                      .querySelector(".tree-row.active")
                      ?.scrollIntoView({ block: "nearest" });
                  });
                });
              }}
            >
              <CollapseIcon />
            </button>
          </div>
        ) : null}
      </div>

      {tab === "files" ? (
        <div
          className="tree"
          onKeyDown={handleTreeKeys}
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
            <div className="tree-hint tree-hint-empty">
              <p>这个文件夹里还没有 Markdown 文件</p>
              <button
                type="button"
                className="tree-hint-action"
                onClick={() => void createMarkdownFile("")}
              >
                新建第一篇
              </button>
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
