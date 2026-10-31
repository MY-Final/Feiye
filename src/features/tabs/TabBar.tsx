import { useEffect, useRef } from "react";

import { useDocumentStore } from "../../stores/document";
import { useSettingsStore } from "../../stores/settings";
import { useTabsStore } from "../../stores/tabs";
import { closeDocumentTab, openFile } from "../workspace/workspace-actions";
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

  if (tabs.length === 0) return null;

  const labelOf = (name: string) =>
    hideExtensions ? name.replace(/\.(md|markdown|mdx)$/i, "") : name;

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
      {tabs.map((tab) => {
        const isActive = tab.path === active;
        const label = labelOf(tab.name);
        return (
          <div
            key={tab.path}
            ref={isActive ? activeTabRef : null}
            className={`doc-tab${isActive ? " is-active" : ""}`}
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
              {isActive && dirty ? (
                <span className="doc-tab-dirty" aria-label="有未保存的修改">
                  •
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="doc-tab-close"
              aria-label={`关闭 ${label}`}
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
    </div>
  );
}
