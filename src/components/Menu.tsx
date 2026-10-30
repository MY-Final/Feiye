import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export interface MenuAction {
  label: string;
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

  // 打开后焦点进到第一项，键盘用户可以直接上下选；关闭时还回去。
  // 单独空依赖，避免父组件重渲染时反复抢焦点。
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    menuRef.current
      ?.querySelector<HTMLButtonElement>(".context-menu-item")
      ?.focus();
    return () => {
      previousFocus.current?.focus?.();
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
