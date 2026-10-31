import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useDocumentStore } from "../stores/document";
import { useEditorStore } from "../stores/editor";
import { useUiStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspace";
import {
  APP_COMMANDS,
  disabledReason,
  type AppCommand,
  type CommandContext,
  type CommandGroup,
} from "../features/commands/commands";
import "./AppMenu.css";

const GROUPS: { id: CommandGroup; label: string }[] = [
  { id: "file", label: "文件" },
  { id: "edit", label: "编辑" },
  { id: "paragraph", label: "段落" },
  { id: "format", label: "格式" },
  { id: "nav", label: "导航" },
  { id: "view", label: "视图" },
  { id: "find", label: "查找" },
  { id: "app", label: "应用" },
];

const MENU_WIDTH = 236;

interface AppMenuProps {
  /** 触发按钮，用来对齐菜单位置、把焦点还回去，并排除「点自己」的关闭。 */
  anchor: HTMLElement | null;
  onClose(): void;
  /** 只显示这些分组；缺省显示全部。 */
  groups?: CommandGroup[];
  /** 单个下拉里是否重复分组标题；菜单栏用分隔线即可。 */
  showGroupLabels?: boolean;
  /** 菜单栏左右键切换到相邻菜单。 */
  onSwitchMenu?(delta: -1 | 1): void;
  /** 无障碍名称，例如「文件菜单」。 */
  label?: string;
}

/**
 * 标题栏菜单面板：单个顶层菜单（文件 / 编辑 / 段落…）或完整的应用菜单。
 * 命令本身来自 commands.ts，与命令面板共用同一份定义。
 */
export function AppMenu({
  anchor,
  onClose,
  groups: onlyGroups,
  showGroupLabels = true,
  onSwitchMenu,
  label = "应用菜单",
}: AppMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // 父组件每次渲染都会换一个 onClose；监听器只在挂载时注册一次，
  // 用 ref 拿最新的回调，避免同一次按键里被卸载重装而漏掉。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 订阅这些状态，菜单开着时切换视图 / 侧栏能立刻反映到勾选与禁用。
  const docPath = useDocumentStore((state) => state.path);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const root = useWorkspaceStore((state) => state.root);
  const historyLength = useWorkspaceStore((state) => state.history.length);
  const forwardLength = useWorkspaceStore((state) => state.forward.length);
  const sidebarVisible = useUiStore((state) => state.sidebarVisible);
  const canUndo = useEditorStore((state) => state.format.canUndo);
  const canRedo = useEditorStore((state) => state.format.canRedo);
  const context: CommandContext = {
    hasDoc: Boolean(docPath),
    hasWorkspace: Boolean(root),
    canBack: Boolean(docPath) && historyLength > 0,
    canForward: Boolean(docPath) && forwardLength > 0,
    canUndo: Boolean(docPath) && canUndo,
    canRedo: Boolean(docPath) && canRedo,
    viewMode,
    sidebarVisible,
  };

  const groups = GROUPS.filter(
    (group) => !onlyGroups || onlyGroups.includes(group.id),
  )
    .map((group) => ({
      ...group,
      commands: APP_COMMANDS.filter(
        (command) => command.menu !== false && command.group === group.id,
      ),
    }))
    .filter((group) => group.commands.length > 0);

  const closeAndRestore = () => {
    onClose();
    anchor?.focus();
  };

  useEffect(() => {
    const menu = menuRef.current;
    menu
      ?.querySelector<HTMLButtonElement>(".app-menu-item:not(:disabled)")
      ?.focus();

    const close = () => closeRef.current();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menu?.contains(target) || anchor?.contains(target)) return;
      close();
    };
    // 窗口失焦、尺寸变化后菜单会与按钮脱开，直接收起。
    const onDismiss = () => close();
    // 菜单开着时按全局快捷键，动作照常执行，菜单不再叠在上面。
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey || event.altKey)) return;
      if (event.key === "Escape") return;
      close();
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onShortcut);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onShortcut);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
    };
  }, [anchor]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestore();
      return;
    }
    // Tab 不困在菜单里：关闭后让焦点按正常顺序继续走。
    if (event.key === "Tab") {
      onClose();
      return;
    }
    // 视图组是单选（源码 / 分栏 / 预览 / 所见即所得），←/→ 在组内四项间移动；
    // 只移焦点不立即切换，回车才生效，避免扫菜单时误改视图。
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const current = document.activeElement as HTMLButtonElement | null;
      if (current?.getAttribute("role") === "menuitemradio") {
        const radios = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '.app-menu-item[role="menuitemradio"]:not(:disabled)',
          ),
        );
        const index = radios.indexOf(current);
        if (index < 0 || radios.length < 2) return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        radios[(index + delta + radios.length) % radios.length]?.focus();
        return;
      }
      // 不在视图单选组里时，←/→ 交给菜单栏切换相邻的顶层菜单。
      if (onSwitchMenu) {
        event.preventDefault();
        event.stopPropagation();
        onSwitchMenu(event.key === "ArrowRight" ? 1 : -1);
      }
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".app-menu-item:not(:disabled)",
      ),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (event.key === "ArrowDown") {
      next = index < 0 ? 0 : (index + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      next = index <= 0 ? items.length - 1 : index - 1;
    } else if (event.key === "End") {
      next = items.length - 1;
    }
    event.preventDefault();
    items[next]?.focus();
  };

  const rect = anchor?.getBoundingClientRect();
  const top = rect ? Math.round(rect.bottom + 4) : 48;
  // 触发器在左半区时让菜单左对齐（避免整块跳到屏幕最左侧），
  // 在右半区时仍右对齐；两种都夹在窗口内。
  const preferredLeft = rect
    ? rect.left + rect.width / 2 < window.innerWidth / 2
      ? rect.left
      : rect.right - MENU_WIDTH
    : window.innerWidth - MENU_WIDTH;
  const left = Math.min(
    Math.max(8, Math.round(preferredLeft)),
    window.innerWidth - MENU_WIDTH - 8,
  );

  const choose = (command: AppCommand) => {
    onClose();
    void command.run();
  };

  return (
    <div
      ref={menuRef}
      className="app-menu"
      role="menu"
      aria-label={label}
      data-tauri-drag-region="false"
      style={{
        top,
        left,
        maxHeight: `calc(100vh - ${top + 8}px)`,
      }}
      onKeyDown={onKeyDown}
      // 菜单贴着标题栏，点击内部不能让拖拽区接管。
      onMouseDown={(event) => event.stopPropagation()}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.id} className="app-menu-group" role="group" aria-label={group.label}>
          {/* 完整菜单用分组标题；单个下拉里标题会和顶层菜单重复，改用细线。 */}
          {showGroupLabels ? (
            <div className="app-menu-heading" aria-hidden="true">
              {group.label}
            </div>
          ) : groupIndex > 0 ? (
            <div className="app-menu-sep" role="separator" />
          ) : null}
          {group.commands.map((command) => {
            const enabled = command.enabled(context);
            const checked = command.checked?.(context) ?? false;
            const isRadio = command.id.startsWith("view-");
            const isCheck = command.id === "sidebar";
            const label =
              isCheck
                ? checked
                  ? "隐藏侧栏"
                  : "显示侧栏"
                : (command.menuLabel ?? command.title);
            return (
              <button
                key={command.id}
                type="button"
                role={
                  isRadio
                    ? "menuitemradio"
                    : isCheck
                      ? "menuitemcheckbox"
                      : "menuitem"
                }
                aria-checked={isRadio || isCheck ? checked : undefined}
                className="app-menu-item"
                disabled={!enabled}
                title={
                  enabled
                    ? (command.hint ?? command.title)
                    : (disabledReason(command, context) ?? command.hint)
                }
                onClick={() => choose(command)}
              >
                <span className="app-menu-check" aria-hidden="true">
                  {checked ? "✓" : ""}
                </span>
                <span className="app-menu-label">{label}</span>
                {command.shortcut ? (
                  <kbd className="app-menu-key">{command.shortcut}</kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
