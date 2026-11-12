import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";

import { trapTab } from "../../components/Dialog";
import {
  APP_COMMANDS,
  SHORTCUT_SHEET_EVENT,
  type CommandGroup,
} from "../commands/commands";
import "../commands/commands.css";

const useSheetStore = create<{ open: boolean }>(() => ({ open: false }));

export const openShortcutSheet = () => useSheetStore.setState({ open: true });
export const closeShortcutSheet = () => useSheetStore.setState({ open: false });
/** 全局快捷键守卫与弹层互斥要问「速查是否开着」，不订阅组件。 */
export const isShortcutSheetOpen = () => useSheetStore.getState().open;

const GROUP_ORDER = ["文件", "编辑", "视图", "标签与分屏"] as const;
type SheetGroup = (typeof GROUP_ORDER)[number];

/** 命令注册表的细分分组并进四个大组，与设置页的分法保持好认。 */
const GROUP_OF: Record<CommandGroup, SheetGroup> = {
  file: "文件",
  edit: "编辑",
  paragraph: "编辑",
  format: "编辑",
  nav: "视图",
  view: "视图",
  find: "视图",
  app: "视图",
};

interface SheetRow {
  title: string;
  keys: string;
  group: SheetGroup;
  /** 来源：命令注册表自动生成，或只存在于编辑区的静态补充。 */
  source: string;
}

const COMMAND_ROWS: SheetRow[] = APP_COMMANDS.filter(
  (command) => command.shortcut,
).map((command) => ({
  title: command.menuLabel ?? command.title,
  keys: command.shortcut as string,
  group: GROUP_OF[command.group],
  source: "命令",
}));

/** 编辑区 / 标签里生效、但注册表没有对应命令的按键，只补这一小张表。 */
const EDITOR_ROWS: SheetRow[] = [
  { title: "增加 / 减少缩进", keys: "Tab / Shift+Tab", group: "编辑", source: "编辑区" },
  { title: "跳到代码块的语言标记", keys: "Ctrl+Shift+L", group: "编辑", source: "编辑区" },
  { title: "退出代码块", keys: "Ctrl+Enter", group: "编辑", source: "编辑区" },
  { title: "切换到下一个 / 上一个标签", keys: "Ctrl+Tab / Ctrl+Shift+Tab", group: "标签与分屏", source: "全局" },
  { title: "关闭当前标签", keys: "Ctrl+W", group: "标签与分屏", source: "全局" },
];

const ALL_ROWS = [...COMMAND_ROWS, ...EDITOR_ROWS];

export function ShortcutSheet() {
  const open = useSheetStore((state) => state.open);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // 命令注册表与浮层分处两个模块，命令执行时发事件打开，避免循环引用。
  useEffect(() => {
    const onOpen = () => openShortcutSheet();
    window.addEventListener(SHORTCUT_SHEET_EVENT, onOpen);
    return () => window.removeEventListener(SHORTCUT_SHEET_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      restoreFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setQuery("");
      const frame = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const previous = restoreFocus.current;
    if (previous?.isConnected) previous.focus();
    else document.querySelector<HTMLElement>(".cm-content")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeShortcutSheet();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? ALL_ROWS.filter((row) =>
          `${row.title} ${row.keys} ${row.source}`.toLowerCase().includes(needle),
        )
      : ALL_ROWS;
    return GROUP_ORDER.map((group) => ({
      group,
      rows: rows.filter((row) => row.group === group),
    })).filter((entry) => entry.rows.length > 0);
  }, [query]);

  if (!open) return null;

  const close = () => closeShortcutSheet();

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
        aria-label="快捷键速查"
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <input
          ref={searchRef}
          className="palette-input"
          type="text"
          value={query}
          placeholder="按动作或按键过滤，Esc 关闭"
          aria-label="搜索快捷键"
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="palette-list" aria-label="快捷键列表">
          {groups.map(({ group, rows }) => (
            <Fragment key={group}>
              <li className="palette-group" role="presentation" aria-hidden="true">
                {group}
              </li>
              {rows.map((row) => (
                <li key={`${group}-${row.keys}-${row.title}`}>
                  <div className="palette-item">
                    <span className="palette-item-text">
                      <span className="palette-item-title">{row.title}</span>
                      <span className="palette-item-hint">{row.source}</span>
                    </span>
                    <kbd className="palette-item-key">{row.keys}</kbd>
                  </div>
                </li>
              ))}
            </Fragment>
          ))}
          {groups.length === 0 ? (
            <li className="palette-empty">没有匹配的快捷键</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
