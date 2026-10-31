import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export interface MenuAction {
  label: string;
  /** 悬停提示，用来补充 label 放不下的完整信息（例如完整路径）。 */
  title?: string;
  danger?: boolean;
  onSelect(): void;
  /** 行尾的次要动作（例如从最近列表移除）；不传则与普通菜单项一致。 */
  onRemove?(): void;
  removeTitle?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose(): void;
}

export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  // Tab 主动把焦点送到触发元素之后时，不必再让卸载逻辑抢回触发元素。
  const skipRestore = useRef(false);

  // 打开后焦点进到第一项，键盘用户可以直接上下选；关闭时还回去。
  // 单独空依赖，避免父组件重渲染时反复抢焦点。
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    menuRef.current
      ?.querySelector<HTMLButtonElement>(".context-menu-item")
      ?.focus();
    return () => {
      if (!skipRestore.current) previousFocus.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // 菜单挂在 body 末尾，按 Tab 若交给浏览器默认行为，焦点会绕回窗口最左边，
    // 跳过触发菜单的那个标签 / 按钮之后的控件。这里关闭菜单，并从触发元素
    // 继续按顺序走一格（Shift+Tab 反向），让键盘焦点不脱节。
    if (event.key === "Tab") {
      event.preventDefault();
      const trigger = previousFocus.current;
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]',
        ),
      ).filter(
        (el) =>
          el.tabIndex >= 0 &&
          el.getClientRects().length > 0 &&
          !el.closest(".context-menu"),
      );
      const index = trigger ? focusables.indexOf(trigger) : -1;
      const delta = event.shiftKey ? -1 : 1;
      const target =
        focusables.length > 0
          ? focusables[
              index < 0
                ? delta > 0
                  ? 0
                  : focusables.length - 1
                : (index + delta + focusables.length) % focusables.length
            ]
          : null;
      skipRestore.current = true;
      onClose();
      target?.focus();
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".context-menu-item",
      ),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  const width = 184;
  const height = actions.length * 32 + 10;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));

  return (
    <div
      className="context-menu"
      ref={menuRef}
      role="menu"
      style={{ left, top, width }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {actions.map((action) => (
        <div className="context-menu-row" key={action.label}>
          <button
            type="button"
            role="menuitem"
            title={action.title}
            className={`context-menu-item ${action.danger ? "danger" : ""}`}
            onClick={() => {
              onClose();
              action.onSelect();
            }}
          >
            {action.label}
          </button>
          {action.onRemove ? (
            <button
              type="button"
              className="context-menu-remove"
              title={action.removeTitle ?? "移除"}
              aria-label={action.removeTitle ?? "移除"}
              onClick={() => action.onRemove?.()}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
