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

  // 标签多到放不下时，用快捷键切到屏幕外的标签要把它们滚进来。
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [active]);

  if (tabs.length === 0) return null;

  const labelOf = (name: string) =>
    hideExtensions ? name.replace(/\.(md|markdown|mdx)$/i, "") : name;

  return (
    <div
      className="tab-bar"
      role="tablist"
      aria-label="打开的笔记"
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
