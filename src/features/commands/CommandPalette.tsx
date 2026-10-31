import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { trapTab } from "../../components/Dialog";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import {
  APP_COMMANDS,
  readCommandContext,
  type AppCommand,
  type CommandGroup,
} from "./commands";
import "./commands.css";

/** 与标题栏菜单（AppMenu.tsx）的 GROUPS 保持同样的分组与顺序。 */
const GROUP_LABELS: Record<CommandGroup, string> = {
  file: "文件",
  edit: "编辑",
  paragraph: "段落",
  format: "格式",
  nav: "导航",
  view: "视图",
  find: "查找",
  app: "应用",
};

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

  const commands = useMemo<AppCommand[]>(() => {
    const context = readCommandContext();
    return APP_COMMANDS.filter(
      (command) =>
        command.palette !== false && command.enabled(context),
    );
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

  const run = (command: AppCommand) => {
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
            <Fragment key={command.id}>
              {position === 0 || filtered[position - 1].group !== command.group ? (
                <li className="palette-group" role="presentation" aria-hidden="true">
                  {GROUP_LABELS[command.group]}
                </li>
              ) : null}
              <li>
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
            </Fragment>
          ))}
          {filtered.length === 0 ? (
            <li className="palette-empty">没有匹配的命令</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
