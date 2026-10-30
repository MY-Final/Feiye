import { chooseWorkspace } from "../features/workspace/workspace-actions";
import { useWindowControls } from "../features/window/use-window-controls";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";

function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h7M2.5 12h11" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.2 1.4h5.6A1.5 1.5 0 0 1 14 5.9v5.6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="4.7" />
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.7v1.6M8 12.7v1.6M1.7 8h1.6M12.7 8h1.6M3.55 3.55l1.15 1.15M11.3 11.3l1.15 1.15M12.45 3.55l-1.15 1.15M4.7 11.3l-1.15 1.15" />
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
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const toggleSettings = useUiStore((state) => state.toggleSettings);
  const controls = useWindowControls();

  return (
    <header
      className="titlebar"
      data-tauri-drag-region="deep"
      // 自绘标题栏没有系统默认行为，双击空白处最大化 / 还原是大家的肌肉记忆。
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        void controls.toggleMaximize();
      }}
    >
      <div className="titlebar-left">
        <button
          type="button"
          className="icon-btn"
          title={sidebarVisible ? "收起侧栏 (Ctrl+B)" : "展开侧栏 (Ctrl+B)"}
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
        <span className="brand-name">扉页</span>

        {workspaceName ? (
          <>
            <span className="brand-divider" aria-hidden="true">
              /
            </span>
            <span className="workspace-name" title={root ?? undefined}>
              {workspaceName}
            </span>
          </>
        ) : null}

        <button
          type="button"
          className="icon-btn titlebar-folder"
          title="打开文件夹 (Ctrl+O)"
          onClick={() => void chooseWorkspace()}
        >
          <FolderIcon />
        </button>

        <button
          type="button"
          className="icon-btn"
          title="偏好设置 (Ctrl+,)"
          aria-label="偏好设置"
          onClick={toggleSettings}
        >
          <SettingsIcon />
        </button>
      </div>

      <div className="titlebar-center">
        {docName ? (
          <span className="doc-title" title={docName}>
            {docName}
            {dirty ? <span className="dirty-dot" title="未保存" /> : null}
          </span>
        ) : null}
      </div>

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
    </header>
  );
}
