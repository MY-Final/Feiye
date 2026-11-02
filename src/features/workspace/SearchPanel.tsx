import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { searchWorkspace, type SearchHit } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useWorkspaceStore } from "../../stores/workspace";
import { getEditorText, jumpToEditorPosition } from "../editor/editor-bridge";
import { changeViewMode, openFile } from "./workspace-actions";
import "./search.css";

const MAX_HITS = 200;

/** 行号转成编辑器里的字符偏移。 */
function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset;
}

/**
 * 命中位置：光标落在命中词上而不是行首。
 * 长句里的匹配常在中后段，停在行首还得再横向找一遍。
 */
function hitOffset(text: string, line: number, query: string): number {
  const start = lineOffset(text, line);
  const end = text.indexOf("\n", start);
  const lineText = text.slice(start, end < 0 ? text.length : end);
  const needle = query.trim().toLowerCase();
  if (!needle) return start;
  const index = lineText.toLowerCase().indexOf(needle);
  return index < 0 ? start : start + index;
}

/**
 * 命中行很长时结果只显示两行，从行首截取会把命中词挤到裁掉的部分里，
 * 用户看不出这一条为什么命中。命中位置靠后时从它前面一小段开始显示。
 */
function contextAround(text: string, query: string, before = 16): string {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle);
  if (index <= before) return text;
  return `…${text.slice(index - before)}`;
}

/** 把每处命中包成 <mark>，大小写不敏感。 */
function highlight(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let index = lower.indexOf(needle);
  while (index >= 0) {
    if (index > from) parts.push(text.slice(from, index));
    parts.push(
      <mark key={`${index}-${from}`}>
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    from = index + needle.length;
    index = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/**
 * 工作区全文搜索：边输边搜，结果显示文件、行号与命中行；
 * 点击直接打开笔记并跳到那一行。
 */
export function SearchPanel({ autoFocus = true }: { autoFocus?: boolean }) {
  const root = useWorkspaceStore((state) => state.root);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setHits([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    // 输入停顿 200ms 再搜，连着敲字不会把后端刷爆。
    const timer = window.setTimeout(() => {
      searchWorkspace(needle, MAX_HITS)
        .then((result) => {
          if (cancelled) return;
          setHits(result);
          setActive(0);
          setSearched(true);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setSearched(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, root]);

  const openHit = async (hit: SearchHit) => {
    // 新关键词的结果还没回来时，列表里仍是上一次查询的命中，
    // 此时点它 / 按回车会打开别的笔记，等本次搜索结束再响应。
    if (loading) return;
    const name = hit.relPath.split("/").pop() ?? hit.relPath;
    if (useDocumentStore.getState().path !== hit.relPath) {
      const result = await openFile({
        name,
        relPath: hit.relPath,
        isDir: false,
      });
      // 文件已在应用外被删除 / 改名：摘掉这篇的所有命中，别让列表反复报同一个错。
      if (result === "failed") {
        setHits((current) =>
          current.filter((h) => h.relPath !== hit.relPath),
        );
        setActive(0);
        return;
      }
    }
    // 未保存提示被取消、或读盘失败时文档没换成目标，别乱跳。
    if (useDocumentStore.getState().path !== hit.relPath) return;
    if (useDocumentStore.getState().viewMode === "preview") {
      await changeViewMode("split");
    }
    const text = getEditorText();
    if (text === null) return;
    jumpToEditorPosition(hitOffset(text, hit.line, query));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 去抖 / 查询期间列表仍是上一次查询的结果，方向键与回车先不响应，
    // 否则回车会打开上一个关键词的第一条。
    if (loading || !hits.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % hits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active];
      if (hit) void openHit(hit);
    }
  };

  // 键盘在输入框里上下选结果时，焦点始终留在输入框，列表不会自己滚动；
  // 选中项一旦走出可视区就看不见了。把它滚进视野（与大纲一致）。
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list
      .querySelector<HTMLElement>(".search-result.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, hits]);

  const needle = query.trim();
  // 读屏播报：查询期间保持安静，结果落地后只念一次条数 / 无结果，
  // 否则每敲一个字都会先念「搜索中」再念条数。
  const statusText = loading
    ? ""
    : searched
      ? hits.length === 0
        ? "没有匹配的内容"
        : hits.length >= MAX_HITS
          ? `找到 ${MAX_HITS}+ 条结果，仅显示前 ${MAX_HITS} 条`
          : `找到 ${hits.length} 条结果`
      : "";

  return (
    <div className="search-panel">
      <input
        className="search-input"
        type="search"
        value={query}
        autoFocus={autoFocus}
        placeholder="搜索全部笔记…"
        aria-label="在工作区中搜索"
        // 焦点留在输入框，用 ↑↓ 换选中项；把当前项告诉读屏，
        // 否则读屏只会重复输入框，听不出选中了哪一条。
        aria-controls={
          !loading && needle && hits.length
            ? "workspace-search-results"
            : undefined
        }
        aria-activedescendant={
          !loading && needle && hits.length
            ? `workspace-search-hit-${active}`
            : undefined
        }
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />

      {/* 常驻播报区：与视觉状态分开，避免「搜索中」随每次敲字刷屏。 */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusText}
      </div>

      {loading ? (
        <div className="search-status" aria-hidden="true">
          搜索中…
        </div>
      ) : searched ? (
        <div className="search-status" aria-hidden="true">
          {hits.length === 0
            ? "没有匹配的内容"
            : `${hits.length}${hits.length >= MAX_HITS ? "+" : ""} 条结果`}
        </div>
      ) : null}

      {needle && hits.length ? (
        <ul
          id="workspace-search-results"
          className="search-results"
          ref={listRef}
          role="listbox"
          aria-label="搜索结果"
        >
          {hits.map((hit, position) => (
            // 选项沿用按钮的点击行为；li 只是布局容器，不进读屏的列表结构。
            <li key={`${hit.relPath}:${hit.line}`} role="presentation">
              <button
                type="button"
                id={`workspace-search-hit-${position}`}
                role="option"
                aria-selected={position === active}
                className={`search-result${position === active ? " is-active" : ""}`}
                title={`${hit.relPath} 第 ${hit.line} 行`}
                onMouseEnter={() => setActive(position)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void openHit(hit)}
              >
                <span className="search-result-path">
                  {hit.relPath}
                  <span className="search-result-line">:{hit.line}</span>
                </span>
                <span className="search-result-text">
                  {highlight(contextAround(hit.text, needle), needle)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
