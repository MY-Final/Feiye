import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { DialogHost } from "../components/Dialog";
import { ToastHost } from "../components/Toast";
import { EditorPane } from "../features/editor/EditorPane";
import { guardUnsaved, saveActiveDocument } from "../features/editor/save";
import { PreviewPane } from "../features/preview/PreviewPane";
import { WorkspaceSidebar } from "../features/workspace/WorkspaceSidebar";
import {
  changeViewMode,
  chooseWorkspace,
  createMarkdownFile,
  restoreLastWorkspace,
} from "../features/workspace/workspace-actions";
import { APP_NAME, APP_NAME_EN, APP_TAGLINE } from "../lib/app-info";
import { getSetting } from "../lib/tauri";
import { useDocumentStore, type ViewMode } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";
import "./App.css";

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "source", label: "源码" },
  { value: "split", label: "分栏" },
  { value: "preview", label: "预览" },
];

let bootstrapped = false;

export default function App() {
  const root = useWorkspaceStore((state) => state.root);
  const workspaceName = useWorkspaceStore((state) => state.name);
  const docPath = useDocumentStore((state) => state.path);
  const docName = useDocumentStore((state) => state.name);
  const dirty = useDocumentStore((state) => state.dirty);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const cursor = useDocumentStore((state) => state.cursor);
  const sidebarVisible = useUiStore((state) => state.sidebarVisible);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  // 启动时恢复上次的视图模式和工作区（StrictMode 下只执行一次）。
  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;

    void (async () => {
      const savedMode = await getSetting<ViewMode>("viewMode");
      if (
        savedMode === "source" ||
        savedMode === "split" ||
        savedMode === "preview"
      ) {
        useDocumentStore.getState().setViewMode(savedMode);
      }
      await restoreLastWorkspace();
    })();
  }, []);

  // 关闭窗口前拦截未保存的修改。
  useEffect(() => {
    const window_ = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void window_.onCloseRequested(async (event) => {
      if (!useDocumentStore.getState().dirty) return;
      event.preventDefault();
      if (await guardUnsaved()) {
        await window_.destroy();
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 全局快捷键：编辑器内由 CodeMirror keymap 处理 Mod-s。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey)) return;

      switch (event.key.toLowerCase()) {
        case "s":
          event.preventDefault();
          void saveActiveDocument();
          break;
        case "o":
          event.preventDefault();
          void chooseWorkspace();
          break;
        case "b":
          event.preventDefault();
          if (useWorkspaceStore.getState().root) {
            useUiStore.getState().toggleSidebar();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasWorkspace = Boolean(root);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-left">
          <button
            type="button"
            className="icon-btn"
            title="切换侧栏 (Ctrl+B)"
            disabled={!hasWorkspace}
            onClick={toggleSidebar}
          >
            ☰
          </button>
          <span className="brand">
            {APP_NAME}
            <span className="brand-en">{APP_NAME_EN}</span>
          </span>
          {workspaceName ? (
            <span className="workspace-name" title={root ?? undefined}>
              {workspaceName}
            </span>
          ) : null}
        </div>

        <div className="titlebar-center">
          {docName ? (
            <span className="doc-title">
              {docName}
              {dirty ? <span className="dirty-dot" title="未保存" /> : null}
            </span>
          ) : null}
        </div>

        <div className="titlebar-actions">
          {hasWorkspace ? (
            <div className="segmented" role="group" aria-label="视图模式">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  className={viewMode === mode.value ? "active" : ""}
                  onClick={() => void changeViewMode(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="btn ghost"
            disabled={!docPath}
            onClick={() => void saveActiveDocument()}
          >
            保存
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => void chooseWorkspace()}
          >
            打开文件夹
          </button>
        </div>
      </header>

      <div className="app-body">
        {hasWorkspace && sidebarVisible ? <WorkspaceSidebar /> : null}

        <main className={`workspace-main mode-${viewMode}`}>
          {hasWorkspace ? (
            <>
              <section className="editor-pane">
                <EditorPane />
              </section>
              <PreviewPane />
              {!docPath ? (
                <div className="pane-overlay">
                  <div className="empty-state">
                    <div className="mark" aria-hidden="true">
                      扉
                    </div>
                    <p>从左侧选择一篇 Markdown，或新建一篇。</p>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void createMarkdownFile("")}
                    >
                      新建文件
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="welcome">
              <div className="mark" aria-hidden="true">
                扉
              </div>
              <h1>{APP_TAGLINE}</h1>
              <p>打开一个文件夹，扉页只读写其中的 Markdown 文件。</p>
              <button
                type="button"
                className="btn primary"
                onClick={() => void chooseWorkspace()}
              >
                打开文件夹
              </button>
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span className="status-path">
          {docPath ?? (hasWorkspace ? "未选择文件" : "未打开工作区")}
        </span>
        <span className="status-meta">
          {docPath ? (
            <>
              <span>
                {cursor.line}:{cursor.column}
              </span>
              <span>UTF-8</span>
              <span className={dirty ? "status-dirty" : ""}>
                {dirty ? "未保存" : "已保存"}
              </span>
            </>
          ) : null}
        </span>
      </footer>

      <DialogHost />
      <ToastHost />
    </div>
  );
}
