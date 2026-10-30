import { useDocumentStore } from "../../stores/document";
import type { PreviewRequest, PreviewResponse, PreviewResult } from "./preview-protocol";

const DEBOUNCE_MS = 200;
// 超长文档整篇解析更贵：停手后多等一会儿再刷新，输入时少跑几遍。
const LARGE_DOC_CHARS = 120_000;
const LARGE_DOC_DEBOUNCE_MS = 600;
const MAX_PREVIEW_BYTES = 1_000_000;

/** 待渲染的 Markdown：打字时先存一个取文本的函数，去抖后再真正取出全文。 */
type PreviewSource = string | (() => string);

let worker: Worker | null = null;
let latestId = 0;
/** 最近一次真正发给 Worker 的文本，回来时用它作为缓存键。 */
let posted: { id: number; markdown: string; docKey: string } | null = null;
let timer: number | null = null;
let pending: PreviewSource | null = null;
let pendingLength = 0;
let listener: ((result: PreviewResult) => void) | null = null;
let lastResult: PreviewResult = { html: "" };

/**
 * 按「文档 + 全文」缓存渲染结果：切回刚看过的笔记时不再让 Worker 整篇解析。
 * 每篇笔记只留最近一次的结果——输入时的中间版本只对撤销有用，却会把别的
 * 笔记挤出缓存；命中前再核对全文，外部修改、撤销、重新读盘后内容不同必然
 * 重新解析。Worker 输出的 HTML 只由 Markdown 决定（主题走 CSS 变量），同一
 * 文本可安全复用。只缓存成功结果，并按「文本 + HTML + 图表」总量限制。
 */
interface CacheEntry {
  markdown: string;
  result: PreviewResult;
  weight: number;
}

const resultCache = new Map<string, CacheEntry>();
const RESULT_CACHE_ENTRIES = 6;
const RESULT_CACHE_WEIGHT = 12_000_000;

function documentCacheKey(): string {
  return useDocumentStore.getState().path ?? "";
}

/** 缓存条目的内存量级：全文 + HTML + Mermaid SVG。 */
function resultWeight(markdown: string, result: PreviewResult): number {
  let weight = markdown.length + result.html.length;
  if (result.mermaid) {
    for (const svg of Object.values(result.mermaid)) weight += svg.length;
  }
  return weight;
}

function cacheResult(
  docKey: string,
  markdown: string,
  result: PreviewResult,
): void {
  if (!result.html || result.error) return;
  // 同一篇笔记只保留最新结果，旧版本不占条目也不占容量。
  resultCache.delete(docKey);
  resultCache.set(docKey, {
    markdown,
    result,
    weight: resultWeight(markdown, result),
  });
  let weight = 0;
  for (const value of resultCache.values()) weight += value.weight;
  while (
    resultCache.size > RESULT_CACHE_ENTRIES ||
    weight > RESULT_CACHE_WEIGHT
  ) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    const value = resultCache.get(oldest);
    resultCache.delete(oldest);
    weight -= value?.weight ?? 0;
  }
}

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
      if (!data.error && posted?.id === data.id) {
        cacheResult(posted.docKey, posted.markdown, lastResult);
      }
      posted = null;
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
      posted = null;
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

  const source = pending;
  const length = pendingLength;
  pendingLength = 0;
  pending = null;

  // 超过上限的文档不解析；先看长度，连整篇文本都不用取出来。
  if (length > MAX_PREVIEW_BYTES) {
    lastResult = {
      html: "",
      error: "文档超过 1 MB，实时预览已暂停。",
    };
    listener?.(lastResult);
    return;
  }

  const markdown = typeof source === "string" ? source : source();

  if (markdown.length > MAX_PREVIEW_BYTES) {
    lastResult = {
      html: "",
      error: "文档超过 1 MB，实时预览已暂停。",
    };
    listener?.(lastResult);
    return;
  }

  // 同一篇笔记的同一份文本之前渲染过：直接复用，不再让 Worker 解析整篇。
  const docKey = documentCacheKey();
  const cached = resultCache.get(docKey);
  if (cached && cached.markdown === markdown) {
    // Map 按插入顺序迭代；命中后移到末尾，淘汰时才真正按「最久未用」踢人，
    // 否则在两篇大笔记来回切、中间点开别的几篇时，刚看过的反而先被淘汰。
    resultCache.delete(docKey);
    resultCache.set(docKey, cached);
    // 作废仍在路上的旧请求，避免较晚返回的结果盖掉缓存。
    latestId += 1;
    posted = null;
    lastResult = cached.result;
    listener?.(lastResult);
    return;
  }

  const current = ensureWorker();
  if (!current) return;

  const id = ++latestId;
  posted = { id, markdown, docKey };
  const request: PreviewRequest = { id, markdown };
  current.postMessage(request);
}

/**
 * 请求刷新预览。`source` 可以是文本，也可以是「到去抖结束再取文本」的函数：
 * 长文档每敲一个字就 `doc.toString()` 复制整篇，改用函数后一次输入只取一次。
 * 传函数时请同时给出 `length`，用于判断是否走大文档的较长去抖。
 */
export function requestPreview(
  source: PreviewSource,
  immediate = false,
  length = typeof source === "string" ? source.length : 0,
): void {
  pending = source;
  pendingLength = length;
  if (timer !== null) window.clearTimeout(timer);
  if (immediate) {
    flush();
  } else {
    const delay = length > LARGE_DOC_CHARS ? LARGE_DOC_DEBOUNCE_MS : DEBOUNCE_MS;
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
  pendingLength = 0;
  latestId += 1;
  posted = null;
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
