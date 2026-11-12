import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  describeError,
  nextSearchGeneration,
  replaceInFiles,
  searchWorkspace,
  type SearchHit,
} from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import { getEditorText, jumpToEditorPosition } from "../editor/editor-bridge";
import { reloadActiveDocument, saveActiveDocument } from "../editor/save";
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
export function SearchPanel({
  autoFocus = true,
  visible = true,
}: {
  autoFocus?: boolean;
  visible?: boolean;
}) {
  const root = useWorkspaceStore((state) => state.root);
  // 保存落盘与目录监听重读都会让结果变旧，需要按当前关键词重跑。
  const dirRevision = useWorkspaceStore((state) => state.dirRevision);
  const savedModifiedMs = useDocumentStore((state) => state.savedModifiedMs);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [failures, setFailures] = useState<
    { relPath: string; error: string }[]
  >([]);
  // 替换完成后自增，重跑当前关键词刷新结果。
  const [refreshTick, setRefreshTick] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceToggleRef = useRef<HTMLButtonElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // 重跑时按「同一篇 + 同一行」找回选中项；用 ref 读最新值，避免进依赖重新触发查询。
  const hitsRef = useRef(hits);
  const activeRef = useRef(active);
  const lastNeedleRef = useRef<string | null>(null);
  hitsRef.current = hits;
  activeRef.current = active;

  useEffect(() => {
    const needle = query.trim();
    // 关键词一变就推进代号：上一次全量扫描在下一个文件前退出，
    // 大库下不必等旧查询读完再开始新查询。
    const generation = nextSearchGeneration();
    generation.catch(() => {});
    if (!needle) {
      setHits([]);
      setSearched(false);
      setLoading(false);
      lastNeedleRef.current = null;
      return;
    }
    // 面板藏起来时不搜；切回可见会重进这里补一次。
    if (!visible) {
      setLoading(false);
      return;
    }
    // 关键词没变说明是保存 / 外部改动引起的保鲜重跑：沿用当前选中项。
    const rerun = needle === lastNeedleRef.current;
    const anchor = rerun ? hitsRef.current[activeRef.current] : undefined;
    setLoading(true);
    let cancelled = false;
    // 输入停顿 200ms 再搜，连着敲字不会把后端刷爆；刷新重跑慢一点（400ms），
    // 让一阵目录事件只落成一次查询。
    const timer = window.setTimeout(() => {
      lastNeedleRef.current = needle;
      generation
        .then((id) => searchWorkspace(needle, MAX_HITS, id))
        .then((result) => {
          // 已被新关键词取代：后端提前返回的空结果也一并丢弃，别清掉新结果。
          if (cancelled || result.cancelled) return;
          setHits(result.hits);
          if (anchor) {
            const index = result.hits.findIndex(
              (hit) => hit.relPath === anchor.relPath && hit.line === anchor.line,
            );
            setActive(index < 0 ? 0 : index);
          } else {
            setActive(0);
          }
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
    }, rerun ? 400 : 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, root, dirRevision, savedModifiedMs, visible, refreshTick]);

  // 组件卸载（侧栏销毁、整页重载）时也推进代号，不让没人要的扫描继续读盘。
  useEffect(() => {
    return () => {
      void nextSearchGeneration().catch(() => {});
    };
  }, []);

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

  const openReplace = () => {
    setReplaceOpen(true);
    // 用户刚点了「替换」，把光标交给替换词输入框，接着就能打字。
    window.requestAnimationFrame(() => replaceInputRef.current?.focus());
  };

  const closeReplace = () => {
    setReplaceOpen(false);
    replaceToggleRef.current?.focus();
  };

  const onReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeReplace();
  };

  const replaceAll = async () => {
    if (replacing || !needle || !hits.length) return;
    const paths = Array.from(new Set(hits.map((hit) => hit.relPath)));
    // 结果达到上限时只替换已列出的文件，实际处数可能更多。
    const truncated = hits.length >= MAX_HITS;
    const atLeast = truncated ? "至少 " : "";
    const deleteHint =
      replacement.length === 0 ? "（替换词为空：将删除匹配的文字）" : "";
    const choice = await useUiStore.getState().ask({
      title: "全部替换",
      message: `将修改${atLeast}${paths.length} 篇笔记中的${atLeast}${hits.length} 处${deleteHint}，写入后不可撤销。`,
      buttons: [
        { label: "取消", value: "cancel", tone: "default" },
        { label: "全部替换", value: "replace", tone: "danger" },
      ],
    });
    if (choice !== "replace") return;

    // 当前这篇有未保存修改：先尝试落盘；仍脏就跳过，避免批量写入与编辑器互相覆盖。
    const current = useDocumentStore.getState();
    let targets = paths;
    const skipped: { relPath: string; error: string }[] = [];
    if (current.path && paths.includes(current.path) && current.dirty) {
      await saveActiveDocument({ auto: true });
      if (useDocumentStore.getState().dirty) {
        targets = paths.filter((path) => path !== current.path);
        skipped.push({
          relPath: current.path,
          error: "当前笔记有未保存的修改，已跳过",
        });
      }
    }

    setReplacing(true);
    setFailures([]);
    try {
      const report = await replaceInFiles(targets, needle, replacement);
      const failed = [
        ...skipped,
        ...report.files
          .filter((file) => file.error)
          .map((file) => ({
            relPath: file.relPath,
            error: file.error ?? "",
          })),
      ];
      setFailures(failed);
      useUiStore
        .getState()
        .toast(
          `已修改 ${report.changedFiles} 篇 / ${report.totalReplaced} 处${
            failed.length ? `，${failed.length} 篇失败` : ""
          }`,
          failed.length ? "error" : "success",
        );

      // 当前这篇被改过：从磁盘重新装载，别让编辑器拿着旧正文在下一次保存时盖掉替换。
      const doc = useDocumentStore.getState();
      const changedOpen = doc.path
        ? report.files.some(
            (file) => file.relPath === doc.path && file.replaced > 0,
          )
        : false;
      if (changedOpen && !doc.dirty) {
        await reloadActiveDocument();
        // 重新装载会把焦点交给正文；用户本来在面板里操作，把焦点还回来。
        if (document.activeElement?.classList.contains("cm-content")) {
          replaceToggleRef.current?.focus();
        }
      }

      // 推进代号让仍在路上的旧查询作废，再重跑当前关键词刷新行号。
      void nextSearchGeneration().catch(() => {});
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      useUiStore
        .getState()
        .toast(`替换失败：${describeError(error)}`, "error");
    } finally {
      setReplacing(false);
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

  // 面板切走时保持挂载，autoFocus 只在首次挂载生效；从其它标签切回搜索、
  // 且这次是从点击 / 命令面板进入时，仍把光标送回输入框。
  useEffect(() => {
    if (!visible || !autoFocus) return;
    if (document.activeElement !== inputRef.current) inputRef.current?.focus();
  }, [visible, autoFocus]);

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
    <div className="search-panel" hidden={!visible}>
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        value={query}
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
        onChange={(event) => {
          setQuery(event.target.value);
          // 换了关键词，上一批替换失败项已不对应当前结果。
          setFailures([]);
        }}
        onKeyDown={onKeyDown}
      />

      <div className="search-replace">
        <button
          ref={replaceToggleRef}
          type="button"
          className="search-replace-toggle"
          aria-expanded={replaceOpen}
          aria-controls="workspace-search-replace"
          onClick={() => (replaceOpen ? closeReplace() : openReplace())}
        >
          替换
        </button>
        {replaceOpen ? (
          <>
            <input
              ref={replaceInputRef}
              id="workspace-search-replace"
              className="search-input search-replace-input"
              type="text"
              value={replacement}
              placeholder="替换为…（留空即删除）"
              aria-label="替换为"
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={onReplaceKeyDown}
            />
            <button
              type="button"
              className="search-replace-run"
              disabled={replacing || !needle || !hits.length}
              onClick={() => void replaceAll()}
            >
              {replacing ? "替换中…" : "全部替换"}
            </button>
          </>
        ) : null}
      </div>

      {failures.length ? (
        <div className="search-replace-failures" role="alert">
          <div>{failures.length} 篇未能替换：</div>
          <ul>
            {failures.slice(0, 5).map((failure) => (
              <li key={failure.relPath}>
                {failure.relPath}：{failure.error}
              </li>
            ))}
          </ul>
          {failures.length > 5 ? (
            <div>另有 {failures.length - 5} 篇失败</div>
          ) : null}
        </div>
      ) : null}

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
