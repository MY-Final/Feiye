import type { PreviewRequest, PreviewResponse, PreviewResult } from "./preview-protocol";

const DEBOUNCE_MS = 200;
const MAX_PREVIEW_BYTES = 1_000_000;

let worker: Worker | null = null;
let latestId = 0;
let timer: number | null = null;
let pending: string | null = null;
let listener: ((result: PreviewResult) => void) | null = null;
let lastResult: PreviewResult = { html: "" };

function ensureWorker(): Worker | null {
  if (worker) return worker;

  try {
    worker = new Worker(new URL("./markdown.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<PreviewResponse>) => {
      const data = event.data;
      // 丢弃过期结果。
      if (data.id !== latestId) return;
      lastResult = data.error
        ? { html: "", error: data.error }
        : { html: data.html };
      listener?.(lastResult);
    };
    worker.onerror = (event) => {
      // 崩溃的 Worker 不会再回消息，留着只会让预览一直空白；
      // 丢掉它，用户点「重试」时按需重建。
      worker?.terminate();
      worker = null;
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
    timer = window.setTimeout(flush, DEBOUNCE_MS);
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
