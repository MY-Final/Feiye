import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { CommandGroup } from "../features/commands/commands";
import { AppMenu } from "./AppMenu";
import "./MenuBar.css";

interface MenuDefinition {
  label: string;
  groups: CommandGroup[];
}

/** 顶层菜单只决定显示哪几组命令，具体动作仍全部来自 commands.ts。 */
const MENUS: MenuDefinition[] = [
  { label: "文件", groups: ["file"] },
  { label: "编辑", groups: ["edit", "find"] },
  { label: "段落", groups: ["paragraph"] },
  { label: "格式", groups: ["format"] },
  { label: "视图", groups: ["view", "nav"] },
  { label: "应用", groups: ["app"] },
];

/**
 * 标题栏里的文字菜单栏。点击顶层菜单展开对应分组，
 * 打开一个菜单后悬停 / ←→ 可以切到相邻菜单。
 */
export function MenuBar() {
  const [open, setOpen] = useState<{ index: number; anchor: HTMLButtonElement } | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const switchMenu = (delta: -1 | 1) => {
    if (!open) return;
    const next = (open.index + delta + MENUS.length) % MENUS.length;
    const anchor = buttons.current[next];
    if (anchor) setOpen({ index: next, anchor });
  };

  const onButtonKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen({ index, anchor: event.currentTarget });
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = (index + delta + MENUS.length) % MENUS.length;
      buttons.current[next]?.focus();
      const anchor = buttons.current[next];
      if (open && anchor) setOpen({ index: next, anchor });
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(null);
    }
  };

  return (
    <div className="menubar" role="menubar" aria-label="应用菜单">
      {MENUS.map((menu, index) => {
        const expanded = open?.index === index;
        return (
          <button
            key={menu.label}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="menuitem"
            className={`menubar-item${expanded ? " is-open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={expanded}
            onClick={() => {
              if (expanded) {
                setOpen(null);
                return;
              }
              const anchor = buttons.current[index];
              if (anchor) setOpen({ index, anchor });
            }}
            onMouseEnter={() => {
              if (!open || expanded) return;
              const anchor = buttons.current[index];
              if (anchor) setOpen({ index, anchor });
            }}
            onKeyDown={(event) => onButtonKeyDown(event, index)}
          >
            {menu.label}
          </button>
        );
      })}
      {open ? (
        <AppMenu
          key={open.index}
          anchor={open.anchor}
          onClose={() => setOpen(null)}
          groups={MENUS[open.index].groups}
          showGroupLabels={false}
          onSwitchMenu={switchMenu}
          label={`${MENUS[open.index].label}菜单`}
        />
      ) : null}
    </div>
  );
}
