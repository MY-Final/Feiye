import { useEffect, useState, type CSSProperties } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { DialogHost } from "../components/Dialog";
import { ToastHost } from "../components/Toast";
import { EditorPane } from "../features/editor/EditorPane";
import { flushAutoSave } from "../features/editor/autosave";
import {
  getEditorView,
  openEditorSearch,
  refreshEditorLayout,
} from "../features/editor/editor-bridge";
import {
  guardUnsaved,
  reloadActiveDocument,
  saveActiveDocument,
} from "../features/editor/save";
import { PreviewPane } from "../features/preview/PreviewPane";
import { CommandPalette } from "../features/commands/CommandPalette";
import { HistoryDialog } from "../features/history/HistoryDialog";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { WorkspaceSidebar } from "../features/workspace/WorkspaceSidebar";
import {
  changeViewMode,
  chooseWorkspace,
  createMarkdownFile,
  forwardDocumentPath,
  newDocumentNearActive,
  openFile,
  openNextDocument,
  openPreviousDocument,
  previousDocumentPath,
  renameActiveDocument,
  restoreLastWorkspace,
  saveDocumentAs,
} from "../features/workspace/workspace-actions";
import { APP_NAME, APP_TAGLINE } from "../lib/app-info";
import { baseName, parentRel } from "../lib/paths";
import { getSetting, isAppError, readFile, setSetting, unwatchWorkspace, watchWorkspace } from "../lib/tauri";
import { isViewMode } from "../lib/view-modes";
import { useDocumentStore, type ViewMode } from "../stores/document";
import {
  flushPreferences,
  FONT_FAMILY_STACKS,
  PREFERENCE_LIMITS,
  useSettingsStore,
} from "../stores/settings";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";
import {
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
  SplitHandle,
} from "./SplitHandle";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { Toolbar, copyActiveAsHtml } from "./Toolbar";
import "./App.css";

let bootstrapped = false;

/** Ctrl+E 切到阅读时记下当前的编辑态，再按一次还原回去。 */
let lastEditingMode: ViewMode = "source";

/** 回到窗口时刷新文件树的最小间隔，避免反复 Alt-Tab 时频繁读盘。 */
const TREE_REFRESH_INTERVAL = 2000;
let lastTreeRefresh = 0;

/** 「最近打开」和文件树用同一套显示规则：按偏好隐去 Markdown 扩展名。 */
function noteLabel(name: string, hideExt: boolean): string {
  return hideExt ? name.replace(/\.(md|markdown|mdx)$/i, "") : name;
}

function dialogOpen(): boolean {
  const ui = useUiStore.getState();
  return Boolean(
    ui.confirm ||
      ui.prompt ||
      ui.settingsOpen ||
      ui.paletteOpen ||
      ui.historyOpen,
  );
}

export default function App() {
  const root = useWorkspaceStore((state) => state.root);
  const workspaceName = useWorkspaceStore((state) => state.name);
  const recent = useWorkspaceStore((state) => state.recent);
  const docPath = useDocumentStore((state) => state.path);
  const docName = useDocumentStore((state) => state.name);
  const dirty = useDocumentStore((state) => state.dirty);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const sidebarVisible = useUiStore((state) => state.sidebarVisible);
  const zenMode = useUiStore((state) => state.zenMode);
  const preferences = useSettingsStore((state) => state.preferences);
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);

  // 启动时恢复上次的视图模式和工作区（StrictMode 下只执行一次）。
  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;

    void (async () => {
      const [savedMode, savedRatio, savedSidebar] = await Promise.all([
        getSetting<unknown>("viewMode"),
        getSetting<unknown>("splitRatio"),
        getSetting<unknown>("sidebarVisible"),
      ]);
      // 上次收起了侧栏，这次启动也保持收起（直接写 state，避免回写设置）。
      if (typeof savedSidebar === "boolean") {
        useUiStore.setState({ sidebarVisible: savedSidebar });
      }
      const preferences = useSettingsStore.getState().preferences;
      const preferredView =
        preferences.defaultView === "last"
          ? savedMode
          : preferences.defaultView;
      if (isViewMode(preferredView)) {
        useDocumentStore.getState().setViewMode(preferredView);
      }
      if (typeof savedRatio === "number") {
        setSplitRatio(clampSplitRatio(savedRatio));
      }
      await restoreLastWorkspace();
    })();
  }, []);

  // Windows 下关掉 Tauri 的原生拖放拦截后，文件由 WebView 自己分发：
  // 编辑区和预览区会拦下来插入图片，其它位置也统一挡住，别让 WebView
  // 把拖进来的文件当成页面导航打开。
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Boolean(event.dataTransfer?.types.includes("Files"));
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // 关闭窗口前拦截未保存的修改。
  useEffect(() => {
    const window_ = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void window_
      .onCloseRequested(async (event) => {
        await flushPreferences();
        if (!useDocumentStore.getState().dirty) return;
        event.preventDefault();
        // 先给自动保存一次落盘机会；冲突或 I/O 失败时才询问。
        if (await flushAutoSave()) {
          await window_.destroy();
          return;
        }
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

      const ui = useUiStore.getState();
      const mod = event.ctrlKey || event.metaKey;

      // 设置面板优先处理 Ctrl+, 与 Esc，避免被 dialogOpen 提前拦截。
      if (mod && (event.key === "," || event.code === "Comma")) {
        if (ui.confirm || ui.prompt) return;
        event.preventDefault();
        ui.toggleSettings();
        return;
      }

      if (
        event.key === "Escape" &&
        ui.settingsOpen &&
        !ui.confirm &&
        !ui.prompt
      ) {
        event.preventDefault();
        ui.closeSettings();
        return;
      }

      // 命令面板：Ctrl+Shift+P 打开 / 关闭；面板内自己处理方向键与回车。
      if (mod && event.shiftKey && event.key.toLowerCase() === "p") {
        if (ui.confirm || ui.prompt) return;
        event.preventDefault();
        if (ui.paletteOpen) ui.closePalette();
        else ui.openPalette();
        return;
      }

      // 文档历史：Ctrl+Alt+H，随手回看并恢复某个保存过的版本。
      if (mod && event.altKey && event.key.toLowerCase() === "h") {
        if (ui.confirm || ui.prompt) return;
        if (!useDocumentStore.getState().path) {
          useUiStore.getState().toast("先打开一篇笔记再查看历史");
          return;
        }
        event.preventDefault();
        if (ui.historyOpen) ui.closeHistory();
        else ui.openHistory();
        return;
      }

      if (dialogOpen()) return;

      // 查找面板等输入框里，组合键交给输入框自己处理（全选、粘贴、再次查找）；
      // 只保留"保存"这个希望随时生效的动作。
      const target = event.target;
      if (
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement) &&
        !(mod && event.key.toLowerCase() === "s")
      ) {
        return;
      }

      if (event.key === "F2") {
        // 正文是可编辑区域，光标在里面时也要响应，才和工具栏的 F2 提示一致。
        // 重命名输入框等对话框场景已由上面的 dialogOpen 拦截。
        event.preventDefault();
        void renameActiveDocument();
        return;
      }

      // Alt + ← 与工具栏「返回」是同一动作：沿链接读下去后可以退回上一篇。
      if (event.altKey && !mod && event.key === "ArrowLeft") {
        // 拦掉 WebView 自带的「后退」，否则会整页退出应用界面。
        event.preventDefault();
        if (previousDocumentPath()) void openPreviousDocument();
        return;
      }

      // Alt + → 前进：退回之后想再回到刚离开的那篇，与 Alt+← 对称。
      if (event.altKey && !mod && event.key === "ArrowRight") {
        event.preventDefault();
        if (forwardDocumentPath()) void openNextDocument();
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) return;

      switch (event.key.toLowerCase()) {
        case "f":
          // 带 Shift 是专注模式：写作时眼前只剩正文，不再先去找查找框。
          if (event.shiftKey) {
            // 专注是"专心写这一篇"，没有打开笔记时说明一句，别让人以为按键失灵。
            if (!useDocumentStore.getState().path) {
              useUiStore.getState().toast("先打开一篇笔记再进入专注模式");
              break;
            }
            event.preventDefault();
            useUiStore.getState().toggleZenMode();
            break;
          }
          // 预览模式下编辑器被 CSS 隐藏，CodeMirror 的查找面板收不到焦点，
          // Ctrl+F 会毫无反应；先切到分栏，再打开查找面板。
          if (!useDocumentStore.getState().path) {
            useUiStore.getState().toast("先打开一篇笔记再查找");
            break;
          }
          event.preventDefault();
          if (useDocumentStore.getState().viewMode === "preview") {
            useUiStore.getState().toast("已切到分栏，方便查看搜索结果", "info");
            void changeViewMode("split").then(openEditorSearch);
          } else {
            openEditorSearch();
          }
          break;
        case "n":
          event.preventDefault();
          if (useWorkspaceStore.getState().root) {
            void newDocumentNearActive();
          } else {
            useUiStore.getState().toast("先打开一个工作区再新建笔记");
          }
          break;
        case "s":
          event.preventDefault();
          // 一篇都没打开时保存不会发生任何事，说清楚，别让人以为键位坏了。
          if (!useDocumentStore.getState().path) {
            useUiStore.getState().toast("先打开一篇笔记再保存");
            break;
          }
          if (event.shiftKey) {
            void saveDocumentAs();
          } else {
            void saveActiveDocument();
          }
          break;
        case "o":
          event.preventDefault();
          void chooseWorkspace();
          break;
        case "e": {
          // Ctrl+Shift+E 与工具栏「复制 HTML」同一动作：导出 HTML 的第一步。
          // 用 E 而不是 Ctrl+Shift+C，后者在 WebView2 / Edge 里是「检查元素」。
          if (event.shiftKey) {
            event.preventDefault();
            if (!useDocumentStore.getState().path) {
              useUiStore.getState().toast("先打开一篇笔记再复制 HTML");
              break;
            }
            void copyActiveAsHtml();
            break;
          }
          // 阅读 / 编辑快速切换；分栏状态会被记住，切回来还原。
          if (!useDocumentStore.getState().path) {
            useUiStore.getState().toast("先打开一篇笔记再切换视图");
            break;
          }
          event.preventDefault();
          const current = useDocumentStore.getState().viewMode;
          if (current === "preview") {
            void changeViewMode(lastEditingMode);
          } else {
            lastEditingMode = current;
            void changeViewMode("preview");
          }
          break;
        }
        case "b": {
          // 编辑器内 Ctrl+B 是加粗，已由 keymap preventDefault。
          event.preventDefault();
          if (!useWorkspaceStore.getState().root) break;
          const {
            zenMode,
            toggleZenMode,
            toggleSidebar,
            sidebarVisible,
            setSidebarVisible,
          } = useUiStore.getState();
          if (zenMode) {
            // 专注模式里侧栏本来就收起，再按开关侧栏显得没反应：
            // 这里直接退出专注，并把侧栏打开，符合按键的字面意思。
            toggleZenMode();
            if (!sidebarVisible) setSidebarVisible(true);
            break;
          }
          toggleSidebar();
          break;
        }
        // 正文太小 / 太大时不用开设置，直接按键调字号。
        case "=":
        case "+":
        case "-": {
          event.preventDefault();
          const { preferences, update } = useSettingsStore.getState();
          const { min, max, step } = PREFERENCE_LIMITS.fontSize;
          const delta = event.key === "-" ? -step : step;
          const next = Math.min(max, Math.max(min, preferences.fontSize + delta));
          if (next !== preferences.fontSize) update({ fontSize: next });
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 窗口重新获得焦点时，若磁盘文件被其他程序改过，提示重新加载。
  useEffect(() => {
    let checking = false;
    let lastSeen: number | null = null;
    // 同一个路径只提醒一次，避免每次切回窗口都弹框。
    let missingPrompted: string | null = null;

    const checkExternalChange = async () => {
      if (checking) return;
      const doc = useDocumentStore.getState();
      if (!doc.path || doc.dirty || doc.saving || doc.saveBlocked) return;

      checking = true;
      try {
        const file = await readFile(doc.path);
        const current = useDocumentStore.getState();
        if (current.path !== doc.path || current.dirty) return;
        if (file.modifiedMs === current.savedModifiedMs) return;
        if (lastSeen === file.modifiedMs) return;
        lastSeen = file.modifiedMs;

        const choice = await useUiStore.getState().ask({
          title: "文件已被其他程序修改",
          message: "磁盘上的内容与编辑器不一致。重新加载会显示最新内容。",
          buttons: [
            { label: "重新加载", value: "reload", tone: "primary" },
            { label: "稍后", value: "later" },
          ],
        });
        if (choice === "reload") await reloadActiveDocument();
      } catch (error) {
        // 文件在应用外被移动或删除：编辑器里的内容还在，但状态栏还写着「已保存」，
        // 不提醒的话容易以为磁盘上仍有这篇笔记，关掉应用就真丢了。
        if (
          isAppError(error) &&
          error.code === "not-found" &&
          missingPrompted !== doc.path
        ) {
          missingPrompted = doc.path;
          const latest = useDocumentStore.getState();
          if (latest.path !== doc.path) return;
          const choice = await useUiStore.getState().ask({
            title: "文件已不在磁盘上",
            message: `「${latest.name ?? doc.path}」可能已被移动或删除。编辑器里的内容仍然保留，可以另存一份。`,
            buttons: [
              { label: "另存为…", value: "save-as", tone: "primary" },
              { label: "保留", value: "keep" },
            ],
          });
          if (choice === "save-as") await saveDocumentAs();
        }
        // 其余读取失败（权限、占用）保持现状，下次聚焦再试。
      } finally {
        checking = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void checkExternalChange();

      // 从外部回到窗口时顺带刷新文件树，外面新建 / 改名的笔记能直接出现。
      const now = Date.now();
      const workspace = useWorkspaceStore.getState();
      if (workspace.root && now - lastTreeRefresh >= TREE_REFRESH_INTERVAL) {
        lastTreeRefresh = now;
        void workspace.refreshTree();
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    // 目录监听：外部增删改不必等到窗口重新聚焦才可见。
    // 事件可能一阵一阵地来（保存会触发多条），这里去抖后统一刷新。
    let unlisten: UnlistenFn | null = null;
    let watchTimer: number | null = null;
    let watchingRoot: string | null = null;
    let disposed = false;

    const scheduleExternalCheck = () => {
      if (watchTimer !== null) window.clearTimeout(watchTimer);
      watchTimer = window.setTimeout(() => {
        watchTimer = null;
        void useWorkspaceStore.getState().refreshTree();
        void checkExternalChange();
      }, 350);
    };

    const attachWatch = async (root: string | null) => {
      if (disposed || root === watchingRoot) return;
      watchingRoot = root;
      unlisten?.();
      unlisten = null;
      if (!root) {
        void unwatchWorkspace().catch(() => {});
        return;
      }
      try {
        // 先挂监听再开始 watch，避免启动瞬间的变化被漏掉。
        unlisten = await listen("workspace-changed", scheduleExternalCheck);
        await watchWorkspace(root);
      } catch {
        // 监听不可用时保留「重新聚焦时刷新」的兜底。
      }
    };

    void attachWatch(useWorkspaceStore.getState().root);
    const unsubscribeRoot = useWorkspaceStore.subscribe((state, previous) => {
      if (state.root !== previous.root) void attachWatch(state.root);
    });

    return () => {
      disposed = true;
      unsubscribeRoot();
      unlisten?.();
      if (watchTimer !== null) window.clearTimeout(watchTimer);
      void unwatchWorkspace().catch(() => {});
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // 专注模式里把当前笔记删掉 / 关掉后没有正文可看，自动退出并提示。
  useEffect(() => {
    if (zenMode && !docPath) {
      useUiStore.getState().toggleZenMode();
    }
  }, [zenMode, docPath]);

  // 从工具栏按钮进入专注模式时焦点还在那个按钮上，按钮随后被收起，
  // 焦点掉到页面本身，敲键盘没反应；这里把焦点交回正文。
  useEffect(() => {
    if (!zenMode) return;
    const frame = requestAnimationFrame(() => {
      if (useDocumentStore.getState().viewMode !== "preview") {
        getEditorView()?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [zenMode]);

  // 系统任务栏 / Alt-Tab 里也显示当前笔记名，未保存时带圆点；
  // 还没选笔记时显示库名，开着几个库也能分清是哪一个。
  useEffect(() => {
    const title = docName
      ? `${dirty ? "• " : ""}${noteLabel(docName, preferences.hideFileExtensions)} — ${APP_NAME}`
      : workspaceName
        ? `${workspaceName} — ${APP_NAME}`
        : APP_NAME;
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {
        // 非 Tauri 环境或权限缺失时保留默认标题。
      });
  }, [docName, dirty, workspaceName, preferences.hideFileExtensions]);

  // 字号、行高、行宽或行号变化后，让 CodeMirror 重新测量排版指标。
  useEffect(() => {
    const frame = requestAnimationFrame(() => refreshEditorLayout());
    return () => cancelAnimationFrame(frame);
  }, [
    preferences.fontFamily,
    preferences.fontSize,
    preferences.lineHeight,
    preferences.editorWidth,
    preferences.lineNumbers,
  ]);

  const hasWorkspace = Boolean(root);

  return (
    <div className="app">
      <TitleBar />
      {/* 专注模式把工具栏和侧栏都收起来，退出后按原来的偏好还原。 */}
      {zenMode ? null : <Toolbar />}

      <div className="app-body">
        {hasWorkspace && sidebarVisible && !zenMode ? <WorkspaceSidebar /> : null}

        <main
          className={`workspace-main mode-${viewMode}${preferences.lineNumbers ? "" : " hide-line-numbers"}`}
          style={
            {
              "--split-ratio": splitRatio,
              "--editor-font-size": `${preferences.fontSize}px`,
              "--editor-line-height": String(preferences.lineHeight),
              "--editor-measure": `min(${preferences.editorWidth}px, 100% - 80px)`,
              "--font-body": FONT_FAMILY_STACKS[preferences.fontFamily],
              "--font-editor": FONT_FAMILY_STACKS[preferences.fontFamily],
            } as CSSProperties
          }
        >
          {hasWorkspace ? (
            <>
              <section className="editor-pane">
                <EditorPane />
              </section>
              {viewMode === "split" ? (
                <SplitHandle
                  ratio={splitRatio}
                  onChange={setSplitRatio}
                  onCommit={(next) => void setSetting("splitRatio", next)}
                />
              ) : null}
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
                    {recent.length > 0 ? (
                      <>
                        <div className="recent-heading">
                          <p>最近打开</p>
                          <button
                            type="button"
                            className="recent-clear"
                            onClick={() => {
                              const store = useWorkspaceStore.getState();
                              const root = store.root;
                              const previous = store.clearRecent();
                              if (previous.length === 0) return;
                              useUiStore.getState().toast(
                                `已清空最近打开（${previous.length} 篇） · 点击撤销`,
                                "info",
                                () => {
                                  // 撤销窗口内换了库就不往回塞，免得把旧路径写进新库。
                                  const current = useWorkspaceStore.getState();
                                  if (current.root !== root) return;
                                  current.restoreRecent(previous);
                                  useUiStore.getState().toast("已恢复最近打开");
                                },
                                "点击撤销清空",
                              );
                            }}
                          >
                            清空
                          </button>
                        </div>
                        {recent.map((relPath) => (
                          <div key={relPath} className="recent-row">
                            <button
                              type="button"
                              className="btn ghost recent-file"
                              title={relPath}
                              onClick={() =>
                                void openFile({
                                  relPath,
                                  name: baseName(relPath),
                                  isDir: false,
                                })
                              }
                            >
                              <span className="recent-name">
                                {noteLabel(
                                  baseName(relPath),
                                  preferences.hideFileExtensions,
                                )}
                              </span>
                              {parentRel(relPath) ? (
                                <span className="recent-dir">
                                  {parentRel(relPath)}
                                </span>
                              ) : null}
                            </button>
                            <button
                              type="button"
                              className="recent-remove"
                              title="从「最近打开」移除"
                              aria-label={`从「最近打开」移除 ${baseName(relPath)}`}
                              onClick={() =>
                                useWorkspaceStore
                                  .getState()
                                  .updateRecent(relPath, null)
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </>
                    ) : null}
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

      <StatusBar />

      <SettingsDialog />
      <HistoryDialog />
      <CommandPalette />
      <DialogHost />
      <ToastHost />
    </div>
  );
}
