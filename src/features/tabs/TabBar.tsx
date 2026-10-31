import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ContextMenu, type MenuAction } from "../../components/Menu";
import { useDocumentStore } from "../../stores/document";
import { useSettingsStore } from "../../stores/settings";
import { useTabsStore } from "../../stores/tabs";
import {
  closeDocumentTab,
  closeDocumentTabsToLeft,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  openFile,
} from "../workspace/workspace-actions";
import "./tabs.css";

/**
 * 打开的笔记标签栏：点击切换、× 关闭；当前文档未保存时标题后带一个点。
 * 当前文档仍由 document store 决定，这里只是入口与指示。
 */
export function TabBar() {
  const tabs = useTabsStore((state) => state.tabs);
  const active = useDocumentStore((state) => state.path);
  const dirty = useDocumentStore((state) => state.dirty);
  const hideExtensions = useSettingsStore(
    (state) => state.preferences.hideFileExtensions,
  );
  const activeTabRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(
    null,
  );
  // 标签放不下时，被截断的一侧渐隐，提示「这边还有标签」；
  // 滚到端头就没有可看的了，渐隐随之消失，不新增按钮或滚动条。
  const [fade, setFade] = useState({ left: false, right: false });

  // 标签多到放不下时，用快捷键切到屏幕外的标签要把它们滚进来。
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [active]);

  // 标签条宽度变化（窗口缩放、侧栏开合、侧栏拖动）后标签可能被推出视野，
  // 当前标签要跟着收进来。依赖 hasTabs：标签从零开回来时重新挂观察器，
  // 否则挂载时没有标签条，观察器会一直缺席。
  const hasTabs = tabs.length > 0;
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !hasTabs || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      activeTabRef.current?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [hasTabs]);

  // 标签放不下时滚动条被隐藏，纵向滚轮不会横向翻动这一条；
  // 把纵向滚轮换成横向滚动，鼠标用户不用只靠 Ctrl+Tab 找被截掉的标签。
  // 触控板横向滑动（deltaX 更大）保持原生手感。
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !hasTabs) return;
    const onWheel = (event: WheelEvent) => {
      if (bar.scrollWidth <= bar.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      const delta =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * bar.clientWidth
            : event.deltaY;
      bar.scrollLeft += delta;
    };
    bar.addEventListener("wheel", onWheel, { passive: false });
    return () => bar.removeEventListener("wheel", onWheel);
  }, [hasTabs]);

  // 记录标签条两端是否还有被截掉的内容：滚动、开合侧栏、缩放窗口、
  // 增删标签都会改变它。留 1px 余量，避免小数宽度抖动。
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !hasTabs) return;
    const update = () => {
      const left = bar.scrollLeft > 1;
      const right = bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 1;
      setFade((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    update();
    bar.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(bar);
    return () => {
      bar.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [hasTabs, tabs]);

  if (tabs.length === 0) return null;

  const labelOf = (name: string) =>
    hideExtensions ? name.replace(/\.(md|markdown|mdx)$/i, "") : name;

  // 整条标签栏只占一个 Tab 停靠点：方向键已经能逐篇切换并打开，
  // 每个标签的主按钮和 × 若都留在 Tab 序里，开七八篇就要连按十几次
  // 才能穿过标签条。停靠点跟当前标签走（方向键切换后焦点与当前一致），
  // 它的 × 也留一个停靠点；其它标签的 × 可用方向键切过去或 Shift+F10 菜单关。
  const stopPath =
    active && tabs.some((tab) => tab.path === active) ? active : tabs[0]?.path;

  // 关掉非当前标签时，先把焦点交给后面（末尾则前面）那枚标签。
  // 被点的 × 会随标签一起从 DOM 里消失，焦点若还停在上面就掉回 body，
  // 键盘用户得从窗口开头重新 Tab 回来。先移走焦点，后续 Tab 才接得上。
  const focusSurvivingTab = (index: number) => {
    const items = barRef.current?.querySelectorAll<HTMLElement>(
      ".doc-tab [role='tab']",
    );
    if (!items || items.length === 0) return;
    (items[index + 1] ?? items[index - 1] ?? items[0])?.focus();
  };

  // 同名笔记（如两个目录下的 README.md）在标签上只显示文件名时分不清，
  // 悬停看完整路径又太慢。只在重名时补一段所在目录：从最近的一级开始
  // 往外找，取到第一个足以区分的后缀，不重名的标签保持原样。
  const labels = tabs.map((tab) => labelOf(tab.name));
  const labelCounts = new Map<string, number>();
  for (const label of labels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const dirSuffixes = new Map<string, string>();
  tabs.forEach((tab, index) => {
    const label = labels[index];
    if ((labelCounts.get(label) ?? 0) < 2) return;
    const parents = tab.path.split("/").slice(0, -1);
    if (parents.length === 0) {
      // 根目录没有上级名可显示；若同名的另一篇也在根目录（只是扩展名不同），
      // 退回带扩展名的文件名才分得开。
      const rootClash = tabs.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          labels[otherIndex] === label &&
          other.path.split("/").length === 1,
      );
      dirSuffixes.set(tab.path, rootClash ? tab.name : "根目录");
      return;
    }
    for (let depth = 1; depth <= parents.length; depth++) {
      const candidate = parents.slice(-depth).join("/");
      const clash = tabs.some((other, otherIndex) => {
        if (otherIndex === index || labels[otherIndex] !== label) return false;
        const otherParents = other.path.split("/").slice(0, -1);
        return otherParents.slice(-depth).join("/") === candidate;
      });
      if (!clash) {
        dirSuffixes.set(tab.path, candidate);
        return;
      }
    }
    // 同目录同显示名只可能来自不同扩展名，退回带扩展名的文件名。
    dirSuffixes.set(tab.path, tab.name);
  });

  // 右键菜单：一次关掉一串标签，不用逐个切过去按 Ctrl+W。
  // 只列出有意义的项——只剩一个标签时不出现「关闭其它标签」，
  // 最左 / 最右标签不出现「关闭左侧 / 右侧标签」。
  const menuIndex = menu ? tabs.findIndex((tab) => tab.path === menu.path) : -1;
  const menuActions: MenuAction[] = menu
    ? [
        {
          label: "关闭标签",
          onSelect: () => {
            // 菜单关闭时会先把焦点还给触发它的标签；那枚标签马上要被移除，
            // 等下一帧再落到相邻标签上（关当前标签则交给编辑器）。
            const keepsFocus = menu.path === active;
            void closeDocumentTab(menu.path).then(() => {
              if (keepsFocus) return;
              requestAnimationFrame(() => focusSurvivingTab(menuIndex));
            });
          },
        },
        ...(menuIndex > 0
          ? [
              {
                label: "关闭左侧标签",
                onSelect: () => void closeDocumentTabsToLeft(menu.path),
              },
            ]
          : []),
        ...(menuIndex >= 0 && menuIndex < tabs.length - 1
          ? [
              {
                label: "关闭右侧标签",
                onSelect: () => void closeDocumentTabsToRight(menu.path),
              },
            ]
          : []),
        ...(tabs.length > 1
          ? [
              {
                label: "关闭其它标签",
                onSelect: () => void closeOtherDocumentTabs(menu.path),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div
      ref={barRef}
      className={`tab-bar${fade.left ? " is-fade-left" : ""}${fade.right ? " is-fade-right" : ""}`}
      role="tablist"
      aria-label="打开的笔记"
      // 标题栏整体是拖动区，标签条自己处理点击与横向滚动。
      data-tauri-drag-region="false"
      onKeyDown={(event) => {
        // 和侧栏的标签页一样：←/→ 逐篇切换，Home / End 直接到首尾。
        // 切换后把焦点交给目标标签，下一次按键才从新位置继续走；
        // 否则焦点留在原处或落进编辑器，方向键会卡在同一个位置。
        if (
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight" &&
          event.key !== "Home" &&
          event.key !== "End"
        ) {
          return;
        }
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']"),
        );
        const focused = document.activeElement as HTMLElement | null;
        // 焦点也可能停在当前标签的 × 上（它是标签条里第二个停靠点），
        // 方向键按它所在的那个标签继续走，不要求先 Shift+Tab 回主按钮。
        const owner =
          buttons.indexOf(focused as HTMLElement) < 0 &&
          focused?.classList.contains("doc-tab-close")
            ? focused.closest(".doc-tab")?.querySelector<HTMLElement>("[role='tab']")
            : null;
        const index = owner ? buttons.indexOf(owner) : buttons.indexOf(focused as HTMLElement);
        if (index < 0) return;
        event.preventDefault();
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                buttons.length;
        const next = buttons[nextIndex];
        const tab = tabs[nextIndex];
        next?.focus();
        if (tab) {
          // 打开新文档时编辑器会接管焦点；在标签条里用方向键导航时，
          // 打开完成后把焦点还给刚移到的标签，下一次按键才能继续往前走。
          void openFile({
            name: tab.name,
            relPath: tab.path,
            isDir: false,
          }).then((result) => {
            if (result === "opened" && next?.isConnected) next.focus();
          });
        }
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.path === active;
        const label = labels[index];
        const dirSuffix = dirSuffixes.get(tab.path);
        return (
          <div
            key={tab.path}
            ref={isActive ? activeTabRef : null}
            className={`doc-tab${isActive ? " is-active" : ""}`}
            // 浏览器与多数编辑器里，鼠标中键点标签就是关闭它；这里照做，
            // 不用先切过去再按 Ctrl+W，也不必瞄准很小的 ×。
            // 中键按下的默认行为是启动页面自动滚动，滚动浮层会吞掉随后的
            // auxclick（表现为中键偶尔关不掉标签），在 mousedown 提前拦掉。
            onMouseDown={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
            }}
            // 关闭仍走 closeDocumentTab，未保存时照常弹保存提示。
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              void closeDocumentTab(tab.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({
                x: event.clientX,
                y: event.clientY,
                path: tab.path,
              });
            }}
            // 键盘也能叫出同一份标签菜单：文件树早就支持 Shift+F10，
            // 标签不该只能靠鼠标右键。打开后可以直接用方向键选。
            onKeyDown={(event) => {
              if (
                event.key !== "ContextMenu" &&
                !(event.shiftKey && event.key === "F10")
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({
                x: rect.left + 16,
                y: rect.bottom - 4,
                path: tab.path,
              });
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={tab.path === stopPath ? 0 : -1}
              className="doc-tab-main"
              title={tab.path}
              onClick={() => {
                // 即使看起来已是当前标签也要走一次 openFile：它会把仍在
                // 慢读的其它笔记作废，点回当前这篇就该留在原地。
                void openFile({
                  name: tab.name,
                  relPath: tab.path,
                  isDir: false,
                });
              }}
            >
              <span className="doc-tab-label">{label}</span>
              {dirSuffix ? (
                <span className="doc-tab-dir" aria-hidden="true">
                  · {dirSuffix}
                </span>
              ) : null}
              {isActive && dirty ? (
                <span className="doc-tab-dirty" aria-label="有未保存的修改">
                  •
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="doc-tab-close"
              tabIndex={tab.path === stopPath ? 0 : -1}
              aria-label={`关闭 ${label}${dirSuffix ? `（${dirSuffix}）` : ""}`}
              title="关闭标签（Ctrl+W）"
              onClick={(event) => {
                event.stopPropagation();
                // 关当前标签会切到相邻一篇并由编辑器接管焦点，这里不抢；
                // 只给「关掉别的标签」补上落点。
                if (!isActive) focusSurvivingTab(index);
                void closeDocumentTab(tab.path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      {/* 菜单挂到 body：标签条有横向滚动，菜单不该跟着滚或被裁掉。 */}
      {menu
        ? createPortal(
            <ContextMenu
              x={menu.x}
              y={menu.y}
              actions={menuActions}
              onClose={() => setMenu(null)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
