import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ContextMenu, type MenuAction } from "../../components/Menu";
import { useDocumentStore } from "../../stores/document";
import { useSettingsStore } from "../../stores/settings";
import { useTabsStore } from "../../stores/tabs";
import {
  closeDocumentTab,
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

  if (tabs.length === 0) return null;

  const labelOf = (name: string) =>
    hideExtensions ? name.replace(/\.(md|markdown|mdx)$/i, "") : name;

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
  // 最右侧标签不出现「关闭右侧标签」。
  const menuIndex = menu ? tabs.findIndex((tab) => tab.path === menu.path) : -1;
  const menuActions: MenuAction[] = menu
    ? [
        {
          label: "关闭标签",
          onSelect: () => void closeDocumentTab(menu.path),
        },
        ...(tabs.length > 1
          ? [
              {
                label: "关闭其它标签",
                onSelect: () => void closeOtherDocumentTabs(menu.path),
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
      ]
    : [];

  return (
    <div
      ref={barRef}
      className="tab-bar"
      role="tablist"
      aria-label="打开的笔记"
      // 标题栏整体是拖动区，标签条自己处理点击与横向滚动。
      data-tauri-drag-region="false"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']"),
        );
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        if (index < 0) return;
        event.preventDefault();
        const next =
          buttons[
            (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
              buttons.length
          ];
        next?.click();
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
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
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
              aria-label={`关闭 ${label}${dirSuffix ? `（${dirSuffix}）` : ""}`}
              title="关闭标签（Ctrl+W）"
              onClick={(event) => {
                event.stopPropagation();
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
