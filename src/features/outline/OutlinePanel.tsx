import { useEffect, useMemo, useRef } from "react";

import { jumpToEditorPosition } from "../editor/editor-bridge";
import { scrollPreviewToHeading } from "../preview/preview-scroll";
import { useDocumentStore } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";

export function OutlinePanel() {
  const headings = useOutlineStore((state) => state.headings);
  const scrollIndex = useOutlineStore((state) => state.scrollIndex);
  const cursorLine = useDocumentStore((state) => state.cursor.line);
  const docPath = useDocumentStore((state) => state.path);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const listRef = useRef<HTMLDivElement>(null);

  const cursorIndex = useMemo(() => {
    let active = -1;
    for (let index = 0; index < headings.length; index += 1) {
      if (headings[index].line <= cursorLine) active = index;
      else break;
    }
    return active;
  }, [headings, cursorLine]);

  // 纯预览模式下以滚动位置为准；编辑 / 分栏模式仍跟随光标。
  const activeIndex =
    viewMode === "preview" && scrollIndex !== null ? scrollIndex : cursorIndex;

  // 长文档里让当前标题始终留在可见范围，但不抢夺滚动焦点。
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0) return;
    const item = list.querySelector<HTMLElement>(
      `[data-outline-index="${activeIndex}"]`,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!docPath) {
    return (
      <div className="outline-empty">
        <p>打开一篇 Markdown，标题会出现在这里。</p>
      </div>
    );
  }

  if (headings.length === 0) {
    return (
      <div className="outline-empty">
        <p>这篇文章还没有标题。</p>
        <p className="outline-hint">用 # 或工具栏的段落样式添加标题。</p>
      </div>
    );
  }

  const jump = (index: number) => {
    const heading = headings[index];
    if (!heading) return;
    if (viewMode === "preview") {
      // 预览里也同步编辑器光标，切回编辑时能接着改；不抢焦点。
      jumpToEditorPosition(heading.from, false);
      scrollPreviewToHeading(index);
      return;
    }
    jumpToEditorPosition(heading.from);
    if (viewMode === "split") {
      scrollPreviewToHeading(index);
    }
  };

  return (
    <div
      className="outline-list"
      ref={listRef}
      role="tree"
      aria-label="文档大纲"
    >
      {headings.map((heading, index) => (
        <button
          key={heading.id}
          type="button"
          role="treeitem"
          className={`outline-item${index === activeIndex ? " active" : ""}`}
          data-outline-index={index}
          style={{ paddingLeft: 10 + (heading.level - 1) * 13 }}
          title={heading.text}
          onClick={() => jump(index)}
        >
          {heading.text}
        </button>
      ))}
    </div>
  );
}
