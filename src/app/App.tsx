import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { DialogHost } from "../components/Dialog";
import { ToastHost } from "../components/Toast";
import { EditorPane } from "../features/editor/EditorPane";
import { guardUnsaved, saveActiveDocument } from "../features/editor/save";
import { PreviewPane } from "../features/preview/PreviewPane";
import { WorkspaceSidebar } from "../features/workspace/WorkspaceSidebar";
import {
  chooseWorkspace,
  createMarkdownFile,
  newDocumentNearActive,
  renameActiveDocument,
  restoreLastWorkspace,
} from "../features/workspace/workspace-actions";
import { APP_NAME, APP_TAGLINE } from "../lib/app-info";
import { getSetting } from "../lib/tauri";
import { isViewMode } from "../lib/view-modes";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";
import { TitleBar } from "./TitleBar";
import { Toolbar } from "./Toolbar";
import "./App.css";

let bootstrapped = false;

function dialogOpen(): boolean {
  const ui = useUiStore.getState();
  return Boolean(ui.confirm || ui.prompt);
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

export default function App() {
  const root = useWorkspaceStore((state) => state.root);
  const docPath = useDocumentStore((state) => state.path);
  const dirty = useDocumentStore((state) => state.dirty);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const cursor = useDocumentStore((state) => state.cursor);
  const sidebarVisible = useUiStore((state) => state.sidebarVisible);

  // 启动时恢复上次的视图模式和工作区（StrictMode 下只执行一次）。
  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;

    void (async () => {
      const savedMode = await getSetting<unknown>("viewMode");
      if (isViewMode(savedMode)) {
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

    void window_
      .onCloseRequested(async (event) => {
        if (!useDocumentStore.getState().dirty) return;
        event.preventDefault();
        if (await guardUnsaved()) {
          await window_.destroy();
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 应用级快捷键。编辑器内的格式快捷键由 CodeMirror keymap 先行处理。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (dialogOpen()) return;

      if (event.key === "F2") {
        if (isTextEntry(event.target)) return;
        event.preventDefault();
        void renameActiveDocument();
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) return;

      switch (event.key.toLowerCase()) {
        case "n":
          event.preventDefault();
          if (useWorkspaceStore.getState().root) {
            void newDocumentNearActive();
          }
          break;
        case "s":
          event.preventDefault();
          void saveActiveDocument();
          break;
        case "o":
          event.preventDefault();
          void chooseWorkspace();
          break;
        case "b":
          // 编辑器内 Ctrl+B 是加粗，已由 keymap preventDefault。
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
      <TitleBar />
      <Toolbar />

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
              <div className="welcome-inner">
                <div className="mark" aria-hidden="true">
                  扉
                </div>
                <h1>{APP_NAME}</h1>
                <p className="welcome-tagline">{APP_TAGLINE}</p>
                <span className="welcome-rule" aria-hidden="true" />
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void chooseWorkspace()}
                >
                  打开文件夹
                </button>
                <p className="welcome-hint">
                  本地 Markdown · 不建立数据库 · 文件始终属于你
                </p>
              </div>
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
