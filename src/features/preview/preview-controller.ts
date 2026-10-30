import type { PreviewRequest, PreviewResponse, PreviewResult } from "./preview-protocol";

const DEBOUNCE_MS = 200;
// 超长文档整篇解析更贵：停手后多等一会儿再刷新，输入时少跑几遍。
const LARGE_DOC_CHARS = 120_000;
const LARGE_DOC_DEBOUNCE_MS = 600;
const MAX_PREVIEW_BYTES = 1_000_000;

let worker: Worker | null = null;
let latestId = 0;
let timer: number | null = null;
let pending: string | null = null;
let listener: ((result: PreviewResult) => void) | null = null;
let lastResult: PreviewResult = { html: "" };

interface PendingExport {
  id: number;
  resolve(html: string): void;
  reject(error: Error): void;
}

// 导出请求与预览请求共用 Worker，但使用独立 id 区间，避免互相顶掉。
let pendingExport: PendingExport | null = null;
let exportSeq = 1_000_000_000;

function ensureWorker(): Worker | null {
  if (worker) return worker;

  try {
    worker = new Worker(new URL("./markdown.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<PreviewResponse>) => {
      const data = event.data;
      if (pendingExport?.id === data.id) {
        const { resolve, reject } = pendingExport;
        pendingExport = null;
        if (data.error) reject(new Error(data.error));
        else resolve(data.html);
        return;
      }
      // 丢弃过期结果。
      if (data.id !== latestId) return;
      lastResult = data.error
        ? { html: "", error: data.error }
        : { html: data.html, mermaid: data.mermaid };
      listener?.(lastResult);
    };
    worker.onerror = (event) => {
      // 崩溃的 Worker 不会再回消息，留着只会让预览一直空白；
      // 丢掉它，用户点「重试」时按需重建。
      worker?.terminate();
      worker = null;
      pendingExport?.reject(
        new Error(event.message || "预览 Worker 运行失败"),
      );
      pendingExport = null;
      lastResult = { html: "", error: event.message || "预览 Worker 运行失败" };
      listener?.(lastResult);
    };
  } catch (error) {
    lastResult = {
      html: "",
      error: error instanceof Error ? error.message : "预览 Worker 初始化失败",
    };
    listener?.(lastResult);
    return null;
  }

  return worker;
}

function flush(): void {
  timer = null;
  if (pending === null) return;

  const markdown = pending;
  pending = null;

  if (markdown.length > MAX_PREVIEW_BYTES) {
    lastResult = {
      html: "",
      error: "文档超过 1 MB，实时预览已暂停。",
    };
    listener?.(lastResult);
    return;
  }

  const current = ensureWorker();
  if (!current) return;

  const id = ++latestId;
  const request: PreviewRequest = { id, markdown };
  current.postMessage(request);
}

export function requestPreview(markdown: string, immediate = false): void {
  pending = markdown;
  if (timer !== null) window.clearTimeout(timer);
  if (immediate) {
    flush();
  } else {
    const delay =
      markdown.length > LARGE_DOC_CHARS ? LARGE_DOC_DEBOUNCE_MS : DEBOUNCE_MS;
    timer = window.setTimeout(flush, delay);
  }
}

export function setPreviewListener(
  next: ((result: PreviewResult) => void) | null,
): void {
  listener = next;
  if (next && lastResult.html) next(lastResult);
}

export function clearPreview(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  pending = null;
  latestId += 1;
  lastResult = { html: "" };
  listener?.(lastResult);
}

/**
 * 用预览同一套管线把 Markdown 渲染成 HTML 片段。
 * 不改变预览状态；导出请求与预览共用 Worker，因此不需要再建一个解析器。
 */
export function renderMarkdownToHtml(markdown: string): Promise<string> {
  if (markdown.length > MAX_PREVIEW_BYTES) {
    return Promise.reject(new Error("文档超过 1 MB，无法生成 HTML。"));
  }

  const current = ensureWorker();
  if (!current) {
    return Promise.reject(
      new Error(lastResult.error ?? "预览 Worker 初始化失败"),
    );
  }

  const id = ++exportSeq;
  return new Promise((resolve, reject) => {
    // 连点两次时以最后一次为准，前一次明确失败，避免永远悬挂。
    pendingExport?.reject(new Error("已开始新的 HTML 导出。"));
    pendingExport = { id, resolve, reject };
    current.postMessage({ id, markdown });
  });
}
