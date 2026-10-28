import { useEffect } from "react";

export interface MenuAction {
  label: string;
  danger?: boolean;
  onSelect(): void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose(): void;
}

export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
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

  const width = 184;
  const height = actions.length * 32 + 10;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));

  return (
    <div
      className="context-menu"
      style={{ left, top, width }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={`context-menu-item ${action.danger ? "danger" : ""}`}
          onClick={() => {
            onClose();
            action.onSelect();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
