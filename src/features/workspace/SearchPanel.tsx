import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { searchWorkspace, type SearchHit } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useWorkspaceStore } from "../../stores/workspace";
import { getEditorText, jumpToEditorPosition } from "../editor/editor-bridge";
import { changeViewMode, openFile } from "./workspace-actions";
import "./search.css";

const MAX_HITS = 200;

/** 行号转成编辑器里的字符偏移：点结果后光标落在命中那一行的行首。 */
function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset;
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
export function SearchPanel() {
  const root = useWorkspaceStore((state) => state.root);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);

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
    jumpToEditorPosition(lineOffset(text, hit.line));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
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

  const needle = query.trim();

  return (
    <div className="search-panel">
      <input
        className="search-input"
        type="search"
        value={query}
        autoFocus
        placeholder="搜索全部笔记…"
        aria-label="在工作区中搜索"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />

      {loading ? (
        <div className="search-status">搜索中…</div>
      ) : searched ? (
        <div className="search-status">
          {hits.length === 0
            ? "没有匹配的内容"
            : `${hits.length}${hits.length >= MAX_HITS ? "+" : ""} 条结果`}
        </div>
      ) : null}

      {needle && hits.length ? (
        <ul className="search-results" aria-label="搜索结果">
          {hits.map((hit, position) => (
            <li key={`${hit.relPath}:${hit.line}`}>
              <button
                type="button"
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
                  {highlight(hit.text, needle)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
