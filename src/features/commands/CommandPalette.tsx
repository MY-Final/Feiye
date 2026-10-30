import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { copyActiveAsHtml, exportActiveAsHtml } from "../../app/Toolbar";
import { trapTab } from "../../components/Dialog";
import { openEditorSearch } from "../editor/editor-bridge";
import { saveActiveDocument } from "../editor/save";
import {
  changeViewMode,
  chooseWorkspace,
  newDocumentNearActive,
  openNextDocument,
  openPreviousDocument,
  renameActiveDocument,
  saveDocumentAs,
} from "../workspace/workspace-actions";
import {
  PREFERENCE_LIMITS,
  useSettingsStore,
} from "../../stores/settings";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import "./commands.css";

interface Command {
  id: string;
  title: string;
  hint?: string;
  shortcut?: string;
  keywords?: string;
  run(): void | Promise<void>;
}

/**
 * 命令面板：一个输入框搜出应用内的动作，键盘上下选、回车执行。
 * 动作仍调用工具栏 / 快捷键用的同一批函数，不另起一套逻辑。
 */
export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen);
  const closePalette = useUiStore((state) => state.closePalette);
  const docPath = useDocumentStore((state) => state.path);
  const root = useWorkspaceStore((state) => state.root);
  const historyLength = useWorkspaceStore((state) => state.history.length);
  const forwardLength = useWorkspaceStore((state) => state.forward.length);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const hasDoc = Boolean(docPath);
    const fontSize = () => useSettingsStore.getState().preferences.fontSize;
    const changeFontSize = (delta: number) => {
      const { min, max, step } = PREFERENCE_LIMITS.fontSize;
      const next = Math.min(max, Math.max(min, fontSize() + delta * step));
      if (next !== fontSize()) {
        useSettingsStore.getState().update({ fontSize: next });
      }
    };
    const list: Command[] = [
      {
        id: "new",
        title: "新建笔记",
        hint: "在当前笔记旁",
        shortcut: "Ctrl+N",
        keywords: "new note 新建",
        run: async () => {
          if (!useWorkspaceStore.getState().root) {
            useUiStore.getState().toast("先打开一个工作区再新建笔记");
            return;
          }
          await newDocumentNearActive();
        },
      },
      {
        id: "open-workspace",
        title: "打开文件夹…",
        shortcut: "Ctrl+O",
        keywords: "workspace folder 工作区 库",
        run: () => chooseWorkspace(),
      },
      {
        id: "save",
        title: "保存",
        shortcut: "Ctrl+S",
        keywords: "save 保存",
        run: () => saveActiveDocument(),
      },
      {
        id: "save-as",
        title: "另存为…",
        shortcut: "Ctrl+Shift+S",
        keywords: "save as 副本",
        run: () => saveDocumentAs(),
      },
      {
        id: "rename",
        title: "重命名当前笔记…",
        shortcut: "F2",
        keywords: "rename 改名",
        run: () => renameActiveDocument(),
      },
      {
        id: "copy-html",
        title: "复制 HTML",
        hint: "按预览排版，可直接粘进邮件",
        shortcut: "Ctrl+Shift+E",
        keywords: "copy html 剪贴板",
        run: () => copyActiveAsHtml(),
      },
      {
        id: "export-html",
        title: "导出 HTML…",
        hint: "写到当前笔记同目录",
        keywords: "export html 导出",
        run: () => exportActiveAsHtml(),
      },
      {
        id: "find",
        title: "查找与替换",
        shortcut: "Ctrl+F",
        keywords: "find search 搜索",
        run: async () => {
          if (useDocumentStore.getState().viewMode === "preview") {
            await changeViewMode("split");
          }
          openEditorSearch();
        },
      },
      {
        id: "view-source",
        title: "视图：源码",
        keywords: "view source 源码",
        run: () => changeViewMode("source"),
      },
      {
        id: "view-split",
        title: "视图：分栏",
        keywords: "view split 分栏",
        run: () => changeViewMode("split"),
      },
      {
        id: "view-preview",
        title: "视图：预览",
        keywords: "view preview 预览 阅读",
        run: () => changeViewMode("preview"),
      },
      {
        id: "view-live",
        title: "视图：所见即所得",
        keywords: "view live wysiwyg 所见",
        run: () => changeViewMode("wysiwyg"),
      },
      {
        id: "zen",
        title: "专注模式",
        shortcut: "Ctrl+Shift+F",
        keywords: "zen focus 专注",
        run: () => useUiStore.getState().toggleZenMode(),
      },
      {
        id: "sidebar",
        title: "显示 / 隐藏侧栏",
        shortcut: "Ctrl+B",
        keywords: "sidebar 侧栏",
        run: () => useUiStore.getState().toggleSidebar(),
      },
      {
        id: "settings",
        title: "偏好设置…",
        shortcut: "Ctrl+,",
        keywords: "settings preferences 设置",
        run: () => useUiStore.getState().openSettings(),
      },
      {
        id: "refresh-tree",
        title: "刷新文件树",
        keywords: "refresh 刷新",
        run: () => useWorkspaceStore.getState().refreshTree(),
      },
      {
        id: "font-larger",
        title: "放大正文字号",
        shortcut: "Ctrl+=",
        keywords: "zoom font 字号 放大",
        run: () => changeFontSize(1),
      },
      {
        id: "font-smaller",
        title: "缩小正文字号",
        shortcut: "Ctrl+-",
        keywords: "zoom font 字号 缩小",
        run: () => changeFontSize(-1),
      },
      {
        id: "back",
        title: "返回上一篇笔记",
        shortcut: "Alt+←",
        keywords: "back history 返回 后退",
        run: () => openPreviousDocument(),
      },
      {
        id: "forward",
        title: "前进到下一篇笔记",
        shortcut: "Alt+→",
        keywords: "forward history 前进",
        run: () => openNextDocument(),
      },
    ];

    return list.filter((command) => {
      if (["save", "save-as", "rename", "copy-html", "export-html", "find"].includes(command.id)) {
        return hasDoc;
      }
      if (["view-source", "view-split", "view-preview", "view-live", "zen"].includes(command.id)) {
        return hasDoc;
      }
      if (command.id === "back") return historyLength > 0;
      if (command.id === "forward") return forwardLength > 0;
      if (command.id === "refresh-tree") return Boolean(root);
      return true;
    });
  }, [docPath, root, historyLength, forwardLength]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.title} ${command.hint ?? ""} ${command.keywords ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [commands, query]);

  // 换一批结果时回到第一项，避免下标越界。
  useEffect(() => {
    setIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const close = () => {
    closePalette();
    const previous = restoreFocus.current;
    if (previous?.isConnected) previous.focus();
  };

  const run = (command: Command) => {
    close();
    void command.run();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((current) => (current + 1) % Math.max(filtered.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex(
        (current) =>
          (current - 1 + Math.max(filtered.length, 1)) %
          Math.max(filtered.length, 1),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[index];
      if (command) run(command);
    }
  };

  return (
    <div
      className="modal-backdrop palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onKeyDown={trapTab}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          value={query}
          placeholder="输入命令，↑↓ 选择，回车执行"
          aria-label="搜索命令"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" role="listbox" aria-label="命令列表">
          {filtered.map((command, position) => (
            <li key={command.id}>
              <button
                type="button"
                role="option"
                aria-selected={position === index}
                className={`palette-item${position === index ? " is-active" : ""}`}
                onMouseEnter={() => setIndex(position)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(command)}
              >
                <span className="palette-item-text">
                  <span className="palette-item-title">{command.title}</span>
                  {command.hint ? (
                    <span className="palette-item-hint">{command.hint}</span>
                  ) : null}
                </span>
                {command.shortcut ? (
                  <kbd className="palette-item-key">{command.shortcut}</kbd>
                ) : null}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="palette-empty">没有匹配的命令</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
