import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { create } from "zustand";

import { trapTab } from "../../components/Dialog";
import { getEditorView } from "../editor/editor-bridge";
import { openFile } from "../workspace/workspace-actions";
import { baseName, parentRel } from "../../lib/paths";
import { listMarkdownFiles, type Entry } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useWorkspaceStore } from "../../stores/workspace";
import { QUICK_OPEN_EVENT } from "./commands";
import "./commands.css";

const useQuickOpenStore = create<{ open: boolean }>(() => ({ open: false }));

export const openQuickOpen = () => useQuickOpenStore.setState({ open: true });
export const closeQuickOpen = () => useQuickOpenStore.setState({ open: false });
/** 全局快捷键守卫与弹层互斥要问「快速打开是否开着」，不订阅组件。 */
export const isQuickOpenOpen = () => useQuickOpenStore.getState().open;

/**
 * 快速打开的匹配规则：查询按字符顺序出现在目标里即可（子序列），
 * 大小写不敏感，首尾空白忽略。空查询匹配全部。
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = target.toLowerCase();
  let from = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return false;
    from = index + 1;
  }
  return true;
}

/** 一次最多列出多少条结果；库再大也不把浮层撑成整页。 */
const MAX_RESULTS = 200;

export function QuickOpen() {
  const open = useQuickOpenStore((state) => state.open);
  const root = useWorkspaceStore((state) => state.root);
  const recent = useWorkspaceStore((state) => state.recent);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<Entry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // 命令注册表与浮层分处两个模块，命令执行时发事件打开，避免循环引用。
  useEffect(() => {
    const onOpen = () => openQuickOpen();
    window.addEventListener(QUICK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(QUICK_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      restoreFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setQuery("");
      setStatus("idle");
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const previous = restoreFocus.current;
    if (previous?.isConnected) previous.focus();
    else document.querySelector<HTMLElement>(".cm-content")?.focus();
  }, [open]);

  // 每次打开都重读一次文件清单：在应用外新建 / 改名的笔记也能立刻搜到。
  useEffect(() => {
    if (!open || !root) return;
    let cancelled = false;
    setStatus("loading");
    listMarkdownFiles()
      .then((entries) => {
        if (cancelled) return;
        setFiles(entries);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, root]);

  // 最近打开的笔记排前面，其余按相对路径；过滤只做子序列匹配。
  const visible = useMemo(() => {
    const rank = new Map(recent.map((path, position) => [path, position]));
    return files
      .filter((file) => fuzzyMatch(query, file.relPath))
      .sort((a, b) => {
        const left = rank.get(a.relPath) ?? Number.MAX_SAFE_INTEGER;
        const right = rank.get(b.relPath) ?? Number.MAX_SAFE_INTEGER;
        if (left !== right) return left - right;
        return a.relPath.localeCompare(b.relPath);
      })
      .slice(0, MAX_RESULTS);
  }, [files, query, recent]);

  useEffect(() => {
    setIndex(0);
  }, [query, open]);

  // 方向键把高亮项移出可视区时，让它跟着滚进视野。
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(".palette-item.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [index, visible, open]);

  if (!open) return null;

  const activeId = visible[index] ? `quick-open-opt-${index}` : null;

  const close = () => closeQuickOpen();

  const choose = (file: Entry) => {
    close();
    void openFile(file).then(() => {
      // 已经打开的那篇不会走「打开文件」的聚焦分支，这里补一次。
      if (useDocumentStore.getState().path === file.relPath) {
        if (useDocumentStore.getState().viewMode !== "preview") {
          getEditorView()?.focus();
        }
      }
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((current) => (current + 1) % Math.max(visible.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex(
        (current) =>
          (current - 1 + Math.max(visible.length, 1)) %
          Math.max(visible.length, 1),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const file = visible[index];
      if (file) choose(file);
    }
  };

  return (
    <div
      className="modal-backdrop palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="快速打开笔记"
        onKeyDown={trapTab}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          value={query}
          placeholder="输入文件名或路径片段，↑↓ 选择，回车打开"
          aria-label="按文件名搜索笔记"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible.length > 0}
          aria-controls="quick-open-list"
          aria-activedescendant={activeId ?? undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul
          id="quick-open-list"
          ref={listRef}
          className="palette-list"
          role="listbox"
          aria-label="笔记列表"
        >
          {visible.map((file, position) => (
            <li key={file.relPath}>
              <button
                id={`quick-open-opt-${position}`}
                type="button"
                role="option"
                aria-selected={position === index}
                className={`palette-item${position === index ? " is-active" : ""}`}
                onMouseEnter={() => setIndex(position)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(file)}
              >
                <span className="palette-item-text">
                  <span className="palette-item-title">{baseName(file.relPath)}</span>
                  {parentRel(file.relPath) ? (
                    <span className="palette-item-hint">
                      {parentRel(file.relPath)}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
          {status === "loading" ? (
            <li className="palette-empty">正在读取文件…</li>
          ) : status === "error" ? (
            <li className="palette-empty">读取文件失败，请稍后重试</li>
          ) : visible.length === 0 ? (
            <li className="palette-empty">
              {root ? "没有匹配的笔记" : "先打开一个工作区"}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
