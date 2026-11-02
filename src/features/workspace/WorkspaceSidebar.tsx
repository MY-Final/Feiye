import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { ContextMenu, type MenuAction } from "../../components/Menu";
import { copyText } from "../../lib/clipboard";
import { OutlinePanel } from "../outline/OutlinePanel";
import { MoveDialog } from "./MoveDialog";
import { SearchPanel } from "./SearchPanel";
import { isWithin, parentRel } from "../../lib/paths";
import { getSetting, setSetting, type Entry } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import {
  collapseAllKeepingActive,
  copyEntryLink,
  createFolderIn,
  createMarkdownFile,
  deleteEntry,
  moveEntry,
  openFile,
  renameEntry,
  revealEntry,
} from "./workspace-actions";

interface MenuState {
  x: number;
  y: number;
  entry: Entry | null;
}

/** 正在拖的文件 / 文件夹：dragstart 记下来，drop 时直接用，省得从 dataTransfer 猜。 */
let draggedEntry: Entry | null = null;

/** 拖到这一行时能不能放下：不能拖回原目录，也不能把文件夹拖进它自己里面。 */
function canDropInto(dragged: Entry, target: Entry): boolean {
  if (!target.isDir) return false;
  if (dragged.relPath === target.relPath) return false;
  if (parentRel(dragged.relPath) === target.relPath) return false;
  if (dragged.isDir && isWithin(target.relPath, dragged.relPath)) return false;
  return true;
}

function buildMenuActions(
  entry: Entry | null,
  onMove: (entry: Entry) => void,
): MenuAction[] {
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
      // 外面改过文件时，右键就地刷新，不用再去右上角找按钮。
      label: "刷新文件树",
      onSelect: () => {
        void useWorkspaceStore.getState().refreshTree();
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
      // 键盘也能移动：不依赖拖拽，选一个目标文件夹即可。
      label: "移动到…",
      onSelect: () => {
        onMove(entry);
      },
    });
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
  dropTarget: string | null;
  onDropTarget(path: string | null): void;
  onMenuAt(x: number, y: number, entry: Entry): void;
  /** 整棵树只留一个 Tab 停靠点，其余行靠方向键移动。 */
  stopPath: string | null;
  onFocusEntry(path: string): void;
}

function TreeNode({
  entry,
  depth,
  dropTarget,
  onDropTarget,
  onMenuAt,
  stopPath,
  onFocusEntry,
}: TreeNodeProps) {
  const expanded = useWorkspaceStore((state) =>
    Boolean(state.expanded[entry.relPath]),
  );
  const children = useWorkspaceStore((state) => state.children[entry.relPath]);
  const loading = useWorkspaceStore((state) =>
    Boolean(state.loading[entry.relPath]),
  );
  const active = useDocumentStore((state) => state.path === entry.relPath);
  const failed = useWorkspaceStore((state) =>
    Boolean(state.failed[entry.relPath]),
  );
  const loadDir = useWorkspaceStore((state) => state.loadDir);
  const hideExt = useSettingsStore(
    (state) => state.preferences.hideFileExtensions,
  );
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
        className={`tree-row${active ? " active" : ""}${
          entry.isDir && dropTarget === entry.relPath ? " drop-target" : ""
        }`}
        style={{ paddingLeft: indent }}
        title={entry.name}
        draggable
        onDragStart={(event) => {
          draggedEntry = entry;
          event.dataTransfer.effectAllowed = "move";
          // 自定义类型只是兜底：同一应用内拖动优先用上面的变量。
          event.dataTransfer.setData("application/x-feiye-entry", entry.relPath);
        }}
        onDragEnd={() => {
          draggedEntry = null;
          onDropTarget(null);
        }}
        onDragOver={(event) => {
          const dragged = draggedEntry;
          if (!dragged || !canDropInto(dragged, entry)) return;
          // 只有 preventDefault 过的地方才允许放下。
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (dropTarget !== entry.relPath) onDropTarget(entry.relPath);
        }}
        onDragLeave={() => {
          if (dropTarget === entry.relPath) onDropTarget(null);
        }}
        onDrop={(event) => {
          const dragged = draggedEntry;
          onDropTarget(null);
          if (!dragged || !canDropInto(dragged, entry)) return;
          event.preventDefault();
          draggedEntry = null;
          void moveEntry(dragged, entry.relPath);
        }}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={active}
        data-depth={depth}
        data-path={entry.relPath}
        tabIndex={entry.relPath === stopPath ? 0 : -1}
        aria-expanded={entry.isDir ? expanded : undefined}
        onFocus={() => onFocusEntry(entry.relPath)}
        onClick={() => {
          if (entry.isDir) {
            void toggleDir(entry.relPath);
          } else {
            void openFile(entry);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenuAt(event.clientX, event.clientY, entry);
        }}
        // 和文件管理器一致：F2 / Delete 针对的是获得焦点这一行，
        // 而不是编辑器里打开的那篇；删除仍走确认框。
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            event.stopPropagation();
            // 改名后这一行会按新名字重新排序，按位置找不可靠，甚至因节点
            // 重建而把焦点掉回 body；等树刷新完按新路径把焦点交回去，
            // 接着按 F2 改的就是刚改过的那一篇。
            const row = event.currentTarget;
            const tree = row.closest(".tree");
            void renameEntry(entry).then((nextPath) => {
              if (!nextPath || !tree?.isConnected) return;
              // 改名后目录监听还可能再刷新一次树，行被短暂卸下再重建，
              // 刚交回的焦点会掉回 body。持续一小段时间按新路径补上焦点，
              // 直到树稳定；用户已把焦点移到别的行 / 控件就不再抢。
              const focusRenamed = (tries = 0) => {
                if (!tree.isConnected) return;
                const target = Array.from(
                  tree.querySelectorAll<HTMLElement>(".tree-row"),
                ).find((item) => item.dataset.path === nextPath);
                const active = document.activeElement as HTMLElement | null;
                if (target && active !== target) {
                  const lost =
                    !active ||
                    active === document.body ||
                    // 输入框关闭时若树恰好被外部刷新，焦点会落到正文而不是旧行；
                    // 这通常就发生在改名完成的同一瞬间，仍应把焦点交回新行。
                    // 只在刚开始补焦的几拍内认正文，之后用户自己点进编辑器就不抢。
                    (tries < 5 && active.classList.contains("cm-content")) ||
                    (active.classList.contains("tree-row") &&
                      active.dataset.path === entry.relPath);
                  // 焦点已移到别的行 / 控件时视为用户主动换位，不再补。
                  if (!lost) return;
                  target.focus();
                }
                if (tries < 25) {
                  window.setTimeout(() => focusRenamed(tries + 1), 60);
                }
              };
              focusRenamed();
            });
          } else if (event.key === "Delete") {
            event.preventDefault();
            event.stopPropagation();
            // 删完把焦点留在树里同一位置，接着整理下一篇，不用再点一下。
            const row = event.currentTarget;
            const tree = row.closest(".tree");
            const before = tree
              ? Array.from(tree.querySelectorAll<HTMLElement>(".tree-row"))
              : [];
            const index = before.indexOf(row);
            void deleteEntry(entry).then(() => {
              if (!tree?.isConnected) return;
              const rows = Array.from(
                tree.querySelectorAll<HTMLElement>(".tree-row"),
              );
              if (rows.length === 0) return;
              rows[Math.min(Math.max(index, 0), rows.length - 1)]?.focus();
            });
          } else if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            // 键盘也能叫出右键菜单，打开后可以直接用方向键选。
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onMenuAt(rect.left + 16, rect.bottom - 4, entry);
          }
        }}
      >
        <span className="tree-caret">
          {entry.isDir ? <ChevronIcon open={expanded} /> : null}
        </span>
        <span className={`tree-icon ${entry.isDir ? "folder" : "markdown"}`}>
          {entry.isDir ? <FolderIcon /> : <MarkdownIcon />}
        </span>
        <span className="tree-label">
          {entry.isDir || !hideExt
            ? entry.name
            : entry.name.replace(/\.(md|markdown|mdx)$/i, "")}
        </span>
      </button>

      {entry.isDir && expanded ? (
        <div
          className="tree-children"
          role="group"
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
              dropTarget={dropTarget}
              onDropTarget={onDropTarget}
              onMenuAt={onMenuAt}
              stopPath={stopPath}
              onFocusEntry={onFocusEntry}
            />
          ))}
          {children && children.length === 0 ? (
            <div className="tree-hint" style={{ paddingLeft: indent + 36 }}>
              空
            </div>
          ) : null}
          {failed && !children && !loading ? (
            // 读取失败时别留空白，给一个就地重试的入口。
            <div className="tree-hint" style={{ paddingLeft: indent + 36 }}>
              读取失败，
              <button
                type="button"
                className="tree-hint-action"
                onClick={() => void loadDir(entry.relPath)}
              >
                重试
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type SidebarTab = "files" | "outline" | "search";

const SIDEBAR_WIDTH_KEY = "sidebarWidth";
const SIDEBAR_TAB_KEY = "sidebarTab";
const SIDEBAR_WIDTH = { min: 180, max: 420, default: 240 } as const;

/** 每个库最近聚焦的文件树行。切库时侧栏会卸载，所以放在组件外。 */
const treeStopByRoot = new Map<string, string>();

function clampSidebarWidth(value: number): number {
  return Math.min(
    SIDEBAR_WIDTH.max,
    Math.max(SIDEBAR_WIDTH.min, Math.round(value)),
  );
}

export function WorkspaceSidebar() {
  const children = useWorkspaceStore((state) => state.children[""]);
  const rootLoading = useWorkspaceStore((state) => Boolean(state.loading[""]));
  const rootFailed = useWorkspaceStore((state) => Boolean(state.failed[""]));
  const refreshTree = useWorkspaceStore((state) => state.refreshTree);
  // 停靠点默认落在当前笔记上；行被折叠 / 删除后由下面的 effect 兜底。
  const root = useWorkspaceStore((state) => state.root);
  const activePath = useDocumentStore((state) => state.path);
  const childrenByPath = useWorkspaceStore((state) => state.children);
  const expandedByPath = useWorkspaceStore((state) => state.expanded);
  const headingCount = useOutlineStore((state) => state.headings.length);
  const searchRequest = useUiStore((state) => state.searchRequest);
  const [tab, setTab] = useState<SidebarTab>("files");
  // 侧栏三个标签只保留一个 Tab 停靠点，停在最后聚焦 / 当前打开的那个上；
  // 其余用 ←/→ / Home / End 到达，和菜单栏、大纲的做法一致。
  const [tabStop, setTabStop] = useState<SidebarTab | null>(null);
  const stopTab = tabStop ?? tab;
  // 方向键 / Home / End 切标签时焦点应留在标签上；只有点击或命令面板打开
  // 搜索才把光标送进输入框，否则读到「搜索」就按 ←/→ 改的是输入框光标。
  const [focusSearchOnOpen, setFocusSearchOnOpen] = useState(true);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 拖动时高亮当前可放下的目录，松手前就知道会落到哪。
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // 文件树只保留一个 Tab 停靠点：最近聚焦的那一行。每个库各记一份，
  // 切走再切回来仍停在离开前的那一行；没去过的库回落到当前笔记。
  const [treeStop, setTreeStop] = useState<string | null>(() =>
    root ? treeStopByRoot.get(root) ?? null : null,
  );
  const stopRoot = useRef(root);
  const treeRef = useRef<HTMLDivElement>(null);
  const focusEntry = (path: string) => {
    if (!root) return;
    treeStopByRoot.set(root, path);
    setTreeStop(path);
  };
  const stopPath = treeStop ?? activePath ?? children?.[0]?.relPath ?? null;
  const [moveTarget, setMoveTarget] = useState<Entry | null>(null);
  const [width, setWidth] = useState<number>(SIDEBAR_WIDTH.default);
  const widthRef = useRef<number>(SIDEBAR_WIDTH.default);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  // 记住上次看的标签：常看大纲的人重启后不用每次再点一下。
  useEffect(() => {
    void getSetting<unknown>(SIDEBAR_TAB_KEY).then((value) => {
      if (value === "files" || value === "outline" || value === "search") {
        setTab(value);
      }
    });
  }, []);

  // 命令面板 / 快捷键请求打开搜索时切到搜索标签，并把光标送进输入框。
  useEffect(() => {
    if (searchRequest === 0) return;
    // 搜索面板可能还没挂载，等 setTab 提交后再按 autoFocus 落焦点不可靠；
    // 同时标记停靠点，从输入框 Shift+Tab 回到的应是「搜索」标签。
    setFocusSearchOnOpen(true);
    setTabStop("search");
    setTab("search");
    void setSetting(SIDEBAR_TAB_KEY, "search");
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(".sidebar .search-input")
        ?.focus();
    });
  }, [searchRequest]);

  // 侧栏没卸载、直接换了库时，也要换成那一库记下的停靠点。
  useEffect(() => {
    if (stopRoot.current === root) return;
    stopRoot.current = root;
    setTreeStop(root ? treeStopByRoot.get(root) ?? null : null);
  }, [root]);

  // 停靠点所在的行被折叠 / 删除后，树里会一个可 Tab 的行都不剩，挪到第一行。
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const rows = Array.from(tree.querySelectorAll<HTMLElement>(".tree-row"));
    if (rows.length === 0) return;
    if (rows.some((row) => row.tabIndex === 0)) return;
    const first = rows[0].dataset.path;
    if (!first || !root) return;
    treeStopByRoot.set(root, first);
    setTreeStop(first);
  }, [stopPath, childrenByPath, expandedByPath, children, root]);

  useEffect(() => {
    void getSetting<number>(SIDEBAR_WIDTH_KEY).then((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const next = clampSidebarWidth(value);
      widthRef.current = next;
      setWidth(next);
    });
  }, []);

  const selectTab = (next: SidebarTab, focusSearch = true) => {
    setMenu(null);
    if (next === "search") setFocusSearchOnOpen(focusSearch);
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

  const openMenuAt = (x: number, y: number, entry: Entry | null) => {
    setMenu({ x, y, entry });
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
        <div
          className="sidebar-tabs"
          role="tablist"
          aria-label="侧栏内容"
          onKeyDown={(event) => {
            // 标签之间用左右方向键切换，Home / End 到首尾，和设置面板一致。
            const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
            if (!keys.includes(event.key)) return;
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']"),
            );
            const index = tabs.indexOf(document.activeElement as HTMLElement);
            if (index < 0) return;
            event.preventDefault();
            const delta = event.key === "ArrowRight" ? 1 : -1;
            const target =
              event.key === "Home"
                ? tabs[0]
                : event.key === "End"
                  ? tabs[tabs.length - 1]
                  : tabs[(index + delta + tabs.length) % tabs.length];
            target?.focus();
            const next = target?.dataset.sidebarTab as SidebarTab | undefined;
            if (next) selectTab(next, false);
            else target?.click();
          }}
        >
          <button
            type="button"
            role="tab"
            data-sidebar-tab="files"
            aria-selected={tab === "files"}
            tabIndex={stopTab === "files" ? 0 : -1}
            className={`sidebar-tab${tab === "files" ? " active" : ""}`}
            onFocus={() => setTabStop("files")}
            onClick={() => selectTab("files")}
          >
            文件
          </button>
          <button
            type="button"
            role="tab"
            data-sidebar-tab="outline"
            aria-selected={tab === "outline"}
            tabIndex={stopTab === "outline" ? 0 : -1}
            className={`sidebar-tab${tab === "outline" ? " active" : ""}`}
            onFocus={() => setTabStop("outline")}
            onClick={() => selectTab("outline")}
          >
            大纲
            {headingCount > 0 ? (
              <span className="sidebar-count">{headingCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            data-sidebar-tab="search"
            aria-selected={tab === "search"}
            tabIndex={stopTab === "search" ? 0 : -1}
            className={`sidebar-tab${tab === "search" ? " active" : ""}`}
            onFocus={() => setTabStop("search")}
            onClick={() => selectTab("search")}
          >
            搜索
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
          ref={treeRef}
          className="tree"
          role="tree"
          aria-label="工作区文件"
          onKeyDown={handleTreeKeys}
          onContextMenu={(event) => {
            // 只在空白区域弹出根目录菜单，行上的右键由 TreeNode 处理。
            const target = event.target as HTMLElement;
            if (!target.closest(".tree-row")) {
              event.preventDefault();
              openMenuAt(event.clientX, event.clientY, null);
            }
          }}
          onMouseDown={(event) => {
            // 点击空白区域关闭右键菜单。
            if (event.target === event.currentTarget && menu) setMenu(null);
          }}
          onDragOver={(event) => {
            // 树里的空白区域当作根目录：把文件拖出子目录时不用再找落点。
            if (!draggedEntry) return;
            const target = event.target as HTMLElement;
            if (target.closest(".tree-row")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDragLeave={(event) => {
            if (event.target === event.currentTarget) setDropTarget(null);
          }}
          onDrop={(event) => {
            if (!draggedEntry) return;
            const target = event.target as HTMLElement;
            if (target.closest(".tree-row")) return;
            event.preventDefault();
            const dragged = draggedEntry;
            draggedEntry = null;
            setDropTarget(null);
            if (parentRel(dragged.relPath) === "") return;
            void moveEntry(dragged, "");
          }}
        >
          {children?.map((entry) => (
            <TreeNode
              key={entry.relPath}
              entry={entry}
              depth={0}
              dropTarget={dropTarget}
              onDropTarget={setDropTarget}
              onMenuAt={openMenuAt}
              stopPath={stopPath}
              onFocusEntry={focusEntry}
            />
          ))}

          {!children && rootLoading ? (
            <div className="tree-hint">加载中…</div>
          ) : null}

          {!children && !rootLoading && rootFailed ? (
            <div className="tree-hint tree-hint-empty">
              <p>读取工作区目录失败</p>
              <button
                type="button"
                className="tree-hint-action"
                onClick={() => void handleRefresh()}
              >
                重试
              </button>
            </div>
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
      ) : tab === "outline" ? (
        <OutlinePanel />
      ) : (
        <SearchPanel autoFocus={focusSearchOnOpen} />
      )}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={buildMenuActions(menu.entry, (entry) => setMoveTarget(entry))}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {moveTarget ? (
        <MoveDialog
          entry={moveTarget}
          onClose={() => setMoveTarget(null)}
        />
      ) : null}
    </aside>
  );
}
