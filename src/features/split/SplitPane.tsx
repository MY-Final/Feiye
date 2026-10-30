import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { rewritePreviewImages } from "../../lib/images";
import { baseName } from "../../lib/paths";
import { readFile } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useSettingsStore } from "../../stores/settings";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import { wrapImageCaptions } from "../preview/figures";
import { renderMermaidBlocks, type MermaidTarget } from "../preview/mermaid";
import "./split.css";
import { renderSplitPreview } from "./split-preview";

interface Rendered {
  path: string | null;
  html: string;
  mermaid?: string[];
  error?: string;
}

/**
 * 分屏对照：右侧并排显示另一篇已打开笔记的预览。
 * 左侧照常编辑当前笔记，右侧独立渲染，互不抢占预览 Worker。
 */
export function SplitPane() {
  const open = useUiStore((state) => state.splitOpen);
  const splitPath = useUiStore((state) => state.splitPath);
  const setSplitPath = useUiStore((state) => state.setSplitPath);
  const closeSplit = useUiStore((state) => state.closeSplitPreview);
  const tabs = useTabsStore((state) => state.tabs);
  const docPath = useDocumentStore((state) => state.path);
  const root = useWorkspaceStore((state) => state.root);
  const themeMode = useSettingsStore((state) => state.preferences.theme);
  const [rendered, setRendered] = useState<Rendered>({ path: null, html: "" });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const bodyRef = useRef<HTMLElement>(null);

  const available = tabs.filter((tab) => tab.path !== docPath);

  // 当前对照的那篇被切成了主文档、或标签被关掉，自动换一篇可对照的。
  useEffect(() => {
    if (!open) return;
    if (splitPath && available.some((tab) => tab.path === splitPath)) return;
    setSplitPath(available[0]?.path ?? null);
  }, [open, splitPath, available, setSplitPath]);

  // 磁盘上的对照文件被外部改过时，稍后重新读一遍。
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let timer: number | null = null;
    let unlisten: (() => void) | null = null;
    const reload = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setTick((value) => value + 1), 350);
    };
    void listen("workspace-changed", reload).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    window.addEventListener("focus", reload);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", reload);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !splitPath) {
      setRendered({ path: null, html: "" });
      return;
    }
    let cancelled = false;
    setLoading(true);
    readFile(splitPath)
      .then(async (file) => {
        const result = await renderSplitPreview(file.content);
        if (cancelled) return;
        setRendered({
          path: splitPath,
          html: result.error
            ? ""
            : rewritePreviewImages(result.html, root, splitPath),
          mermaid: result.mermaid,
          error: result.error,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setRendered({
            path: splitPath,
            html: "",
            error: error instanceof Error ? error.message : "读取失败",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, splitPath, root, tick]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) wrapImageCaptions(body);
  }, [rendered.html]);

  // 对照里的 Mermaid 图表也跟着主题重画。
  useEffect(() => {
    const body = bodyRef.current;
    const sources = rendered.mermaid;
    if (!body || !sources?.length) return;
    const wanted = new Set(sources.map((source) => source.trim()));
    const targets: MermaidTarget[] = [];
    for (const pre of body.querySelectorAll("pre")) {
      const source = (pre.textContent ?? "").trim();
      if (!wanted.has(source)) continue;
      pre.dataset.mermaid = "pending";
      targets.push({ element: pre, source });
    }
    for (const figure of body.querySelectorAll<HTMLElement>(
      "figure.mermaid-figure[data-source]",
    )) {
      targets.push({ element: figure, source: figure.dataset.source ?? "" });
    }
    if (!targets.length) return;
    const cancel = { cancelled: false };
    void renderMermaidBlocks(targets, cancel);
    return () => {
      cancel.cancelled = true;
    };
  }, [rendered.html, rendered.mermaid, themeMode]);

  if (!open) return null;

  const label = splitPath ? baseName(splitPath) : null;

  return (
    <aside className="split-pane" aria-label="对照预览">
      <div className="split-header">
        <span className="split-label">对照</span>
        <select
          className="split-select"
          aria-label="选择对照的笔记"
          value={splitPath ?? ""}
          disabled={available.length === 0}
          onChange={(event) => setSplitPath(event.target.value || null)}
        >
          {available.length === 0 ? (
            <option value="">没有其他打开的笔记</option>
          ) : (
            available.map((tab) => (
              <option key={tab.path} value={tab.path}>
                {tab.name}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className="split-close"
          aria-label="关闭对照"
          title="关闭分屏对照"
          onClick={closeSplit}
        >
          ×
        </button>
      </div>

      <div className="split-body preview-pane">
        {available.length === 0 && !splitPath ? (
          <div className="split-empty">
            <p>先打开另一篇笔记，再来对照。</p>
            <p className="split-hint">
              标签栏里有多篇笔记时，右侧可以挑一篇边写边看；左侧仍是当前编辑的笔记。
            </p>
          </div>
        ) : rendered.error ? (
          <div className="preview-error" role="alert">
            对照预览失败：{rendered.error}
          </div>
        ) : loading && !rendered.html ? (
          <div className="split-empty">正在渲染 {label}…</div>
        ) : (
          <article
            className="markdown-body"
            ref={bodyRef}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
            onClick={(event) => {
              // 对照区只读：链接不跳转，避免把主文档切走。
              if ((event.target as HTMLElement).closest("a")) {
                event.preventDefault();
              }
            }}
          />
        )}
      </div>
    </aside>
  );
}
