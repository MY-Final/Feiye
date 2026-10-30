import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { jumpToEditorPosition } from "../editor/editor-bridge";
import { scrollPreviewToHeading } from "../preview/preview-scroll";
import { useDocumentStore } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";

/**
 * 大纲条目单独 memo：光标换行时只重渲染新旧两个高亮项，
 * 长文档（数千标题）不再每次按 Enter 都重建整张列表。
 */
const OutlineRow = memo(function OutlineRow({
  text,
  level,
  index,
  active,
  onJump,
}: {
  text: string;
  level: number;
  index: number;
  active: boolean;
  onJump: (index: number) => void;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={level}
      aria-selected={active}
      className={`outline-item${active ? " active" : ""}`}
      data-outline-index={index}
      style={{ paddingLeft: 10 + (level - 1) * 13 }}
      title={text}
      onClick={() => onJump(index)}
    >
      {text}
    </button>
  );
});

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

  // 跳转读取最新的标题与视图模式，但回调本身保持同一引用：
  // 改行导致标题位置整体位移时，条目不再被迫全部重渲染。
  const latest = useRef({ headings, viewMode });
  latest.current = { headings, viewMode };
  const jump = useCallback((index: number) => {
    const heading = latest.current.headings[index];
    if (!heading) return;
    const mode = latest.current.viewMode;
    if (mode === "preview") {
      // 预览里也同步编辑器光标，切回编辑时能接着改；不抢焦点。
      jumpToEditorPosition(heading.from, false);
      scrollPreviewToHeading(index);
      return;
    }
    jumpToEditorPosition(heading.from);
    if (mode === "split") {
      scrollPreviewToHeading(index);
    }
  }, []);

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

  // 和文件树一致的键盘习惯：↑↓ 换行、Home / End 到首尾；
  // 跳转沿用按钮原生的 Enter / 空格点击。
  const handleKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const item = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-outline-index]",
    );
    if (!item) return;

    const index = Number(item.dataset.outlineIndex);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index + 1;
    else if (event.key === "ArrowUp") next = index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = headings.length - 1;
    if (next === null) return;

    // 越界时也不让页面自己滚动，焦点留在最后一项。
    event.preventDefault();
    listRef.current
      ?.querySelector<HTMLElement>(`[data-outline-index="${next}"]`)
      ?.focus();
  };

  return (
    <div
      className="outline-list"
      ref={listRef}
      role="tree"
      aria-label="文档大纲"
      onKeyDown={handleKeys}
    >
      {headings.map((heading, index) => (
        <OutlineRow
          // 按位置复用 DOM：在标题上方插入文字会让所有 from 位移，
          // 用 from 生成的 id 做 key 会整体卸载重建几千个按钮。
          key={index}
          text={heading.text}
          level={heading.level}
          index={index}
          active={index === activeIndex}
          onJump={jump}
        />
      ))}
    </div>
  );
}
