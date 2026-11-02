import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { trapTab } from "../../components/Dialog";
import { useDocumentStore } from "../../stores/document";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import {
  APP_COMMANDS,
  readCommandContext,
  rememberCommand,
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
  const recentIds = useSettingsStore(
    (state) => state.preferences.recentCommands,
  );
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
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

  // 空查询时把最近用过的命令提到最前，常用的动作不必每次再搜一遍；
  // 一旦开始输入就恢复按菜单分组的原始顺序。
  const recent = useMemo(() => {
    if (query.trim()) return [];
    const byId = new Map(commands.map((command) => [command.id, command]));
    return recentIds
      .map((id) => byId.get(id))
      .filter((command): command is AppCommand => Boolean(command))
      .slice(0, 5);
  }, [commands, query, recentIds]);

  const visible = useMemo(() => {
    if (query.trim()) return filtered;
    const seen = new Set(recent.map((command) => command.id));
    return [...recent, ...filtered.filter((command) => !seen.has(command.id))];
  }, [filtered, query, recent]);

  // 分组标题：最近使用单独一段，之后恢复原来的菜单分组顺序。
  const groupHeaders = useMemo(
    () =>
      visible.map((command, position) => {
        if (position < recent.length) {
          return position === 0 ? "最近使用" : null;
        }
        return position === recent.length ||
          visible[position - 1].group !== command.group
          ? GROUP_LABELS[command.group]
          : null;
      }),
    [visible, recent.length],
  );

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

  // 命令多到列表需要滚动时，焦点仍在输入框，方向键移出可视区的高亮项
  // 不会自己跟过来；把它滚进视野，否则只看得到输入框、看不到选中了哪条。
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(".palette-item.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [index, visible, open]);

  if (!open) return null;

  // 焦点始终留在输入框，用组合框语义把当前高亮项报给读屏；
  // 没有结果时移除引用，免得指向不存在的选项。
  const activeId = visible[index]?.id ?? null;

  const close = () => {
    closePalette();
    const previous = restoreFocus.current;
    if (previous?.isConnected) previous.focus();
  };

  const run = (command: AppCommand) => {
    close();
    rememberCommand(command);
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
      setIndex((current) => (current + 1) % Math.max(visible.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex(
        (current) =>
          (current - 1 + Math.max(visible.length, 1)) %
          Math.max(visible.length, 1),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = visible[index];
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
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible.length > 0}
          aria-controls="palette-list"
          aria-activedescendant={activeId ? `palette-opt-${activeId}` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul
          id="palette-list"
          ref={listRef}
          className="palette-list"
          role="listbox"
          aria-label="命令列表"
        >
          {visible.map((command, position) => (
            <Fragment key={command.id}>
              {groupHeaders[position] ? (
                <li className="palette-group" role="presentation" aria-hidden="true">
                  {groupHeaders[position]}
                </li>
              ) : null}
              <li>
                <button
                  id={`palette-opt-${command.id}`}
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
          {visible.length === 0 ? (
            <li className="palette-empty">没有匹配的命令</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
