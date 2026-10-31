import { useRef, useState, type MouseEvent } from "react";

import { ContextMenu } from "../components/Menu";
import { TabBar } from "../features/tabs/TabBar";
import {
  chooseWorkspace,
  forgetWorkspace,
  listRecentWorkspaces,
  newDocumentNearActive,
  openWorkspaceAt,
  rememberWorkspace,
} from "../features/workspace/workspace-actions";
import { useWindowControls } from "../features/window/use-window-controls";
import { AppMenu } from "./AppMenu";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";

/** 工作区根目录是本机绝对路径，两种分隔符都要认。 */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** 同名文件夹分布在不同位置时，用上一级目录帮用户分辨。 */
function parentName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h7M2.5 12h11" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6h8" />
    </svg>
  );
}

function MaximizeIcon({ restored }: { restored: boolean }) {
  return restored ? (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2.5h5.5V8M2.5 4H8v5.5H2.5z" />
    </svg>
  ) : (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 2.5h7v7h-7z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

export function TitleBar() {
  const workspaceName = useWorkspaceStore((state) => state.name);
  const root = useWorkspaceStore((state) => state.root);
  const docName = useDocumentStore((state) => state.name);
  const dirty = useDocumentStore((state) => state.dirty);
  const sidebarVisible = useUiStore((state) => state.sidebarVisible);
  const zenMode = useUiStore((state) => state.zenMode);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const controls = useWindowControls();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentMenu, setRecentMenu] = useState<{
    x: number;
    y: number;
    paths: string[];
  } | null>(null);

  // 没有历史时按原来的行为直接弹文件夹对话框，不让人多点一次。
  const openRecentMenu = async (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const paths = await listRecentWorkspaces();
    if (paths.length === 0) {
      void chooseWorkspace();
      return;
    }
    setRecentMenu({ x: rect.left, y: rect.bottom + 4, paths });
  };

  // 只想清掉菜单里的一条记录，不必先切过去；只改设置里的路径列表。
  const removeRecent = async (path: string) => {
    await forgetWorkspace(path);
    const remaining = recentMenu?.paths.filter((item) => item !== path) ?? [];
    setRecentMenu(
      remaining.length > 0 && recentMenu
        ? { ...recentMenu, paths: remaining }
        : null,
    );
    useUiStore.getState().toast(
      `已从最近工作区移除：${folderName(path)} · 点击撤销`,
      "info",
      // 误点 × 时不用真的切过去再切回来，点提示即可放回列表。
      () => {
        void rememberWorkspace(path).then(() => {
          useUiStore
            .getState()
            .toast(`已恢复最近工作区：${folderName(path)}`);
        });
      },
      "点击撤销移除",
    );
  };

  return (
    <header
      className="titlebar"
      data-tauri-drag-region="deep"
      // 自绘标题栏没有系统默认行为，双击空白处最大化 / 还原是大家的肌肉记忆。
      onDoubleClick={(event) => {
        // 标签、菜单与窗口控制都在标题栏里，双击它们不应把窗口最大化。
        const interactive = (event.target as HTMLElement).closest(
          "button, .tab-bar, .app-menu, .window-controls",
        );
        if (interactive) return;
        void controls.toggleMaximize();
      }}
    >
      <div className="titlebar-left">
        <button
          type="button"
          className="icon-btn"
          title={
            zenMode
              ? "退出专注模式并显示侧栏"
              : sidebarVisible
                ? "收起侧栏 (Ctrl+B)"
                : "展开侧栏 (Ctrl+B)"
          }
          disabled={!root}
          onClick={() => {
            // 专注模式里侧栏是被整体收起的，单纯切换可见性看不出变化；
            // 和 Ctrl+B 一样，先退出专注再把侧栏打开。
            const ui = useUiStore.getState();
            if (ui.zenMode) {
              ui.toggleZenMode();
              if (!ui.sidebarVisible) ui.setSidebarVisible(true);
              return;
            }
            toggleSidebar();
          }}
        >
          <SidebarIcon />
        </button>

        <span className="brand-seal" aria-hidden="true">
          扉
        </span>

        {workspaceName ? (
          <>
            {/* 印章已经是应用标识，库名紧跟其后即可；不再用「扉页 / 库名」
                的斜杠写法，避免看起来像一条不存在的目录层级。 */}
            <button
              type="button"
              className="workspace-switch"
              title={`${root ?? workspaceName} · 切换最近工作区`}
              aria-label={`当前工作区：${workspaceName}，切换最近工作区`}
              aria-haspopup="menu"
              aria-expanded={Boolean(recentMenu)}
              onClick={(event) => void openRecentMenu(event)}
            >
              <span className="workspace-name">{workspaceName}</span>
              <ChevronIcon />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="icon-btn"
            title="最近工作区"
            aria-label="最近工作区"
            aria-haspopup="menu"
            aria-expanded={Boolean(recentMenu)}
            onClick={(event) => void openRecentMenu(event)}
          >
            <ChevronIcon />
          </button>
        )}

        {/* 应用菜单放在左侧库名之后：它是全局菜单，不再贴着窗口控制。 */}
        <button
          ref={menuButtonRef}
          type="button"
          className={`icon-btn app-menu-trigger${menuOpen ? " is-open" : ""}`}
          title="应用菜单"
          aria-label="应用菜单"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
      </div>

      <div className="titlebar-tabs">
        {zenMode ? (
          docName ? (
            <span className="doc-title" title={docName}>
              {docName}
              {dirty ? <span className="dirty-dot" title="未保存" /> : null}
            </span>
          ) : null
        ) : (
          <>
            <TabBar />
            {root ? (
              <button
                type="button"
                className="tab-new"
                title="新建笔记 (Ctrl+N)"
                aria-label="新建笔记"
                data-tauri-drag-region="false"
                onClick={() => void newDocumentNearActive()}
              >
                +
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="titlebar-right" data-tauri-drag-region="false">
        <div
          className="window-controls"
          data-tauri-drag-region="false"
          hidden={!controls.available}
        >
          <button
            type="button"
            className="window-control"
            title="最小化"
            aria-label="最小化"
            onClick={() => void controls.minimize()}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            className="window-control"
            title={controls.maximized ? "还原" : "最大化"}
            aria-label={controls.maximized ? "还原" : "最大化"}
            onClick={() => void controls.toggleMaximize()}
          >
            <MaximizeIcon restored={controls.maximized} />
          </button>
          <button
            type="button"
            className="window-control close"
            title="关闭"
            aria-label="关闭"
            onClick={() => void controls.requestClose()}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <AppMenu
          anchor={menuButtonRef.current}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}

      {recentMenu ? (
        <ContextMenu
          x={recentMenu.x}
          y={recentMenu.y}
          onClose={() => setRecentMenu(null)}
          actions={recentMenu.paths.map((path) => {
            // 两个都叫「笔记」的库只显示文件夹名分不清，重名时补上上一级目录。
            const name = folderName(path);
            const duplicated =
              recentMenu.paths.filter((item) => folderName(item) === name)
                .length > 1;
            const parent = parentName(path);
            return {
              label: `切换到 ${name}${duplicated && parent ? `（${parent}）` : ""}`,
              title: path,
              onSelect: () => void openWorkspaceAt(path, true),
              onRemove: () => void removeRecent(path),
              removeTitle: "从最近工作区移除",
            };
          })}
        />
      ) : null}
    </header>
  );
}
