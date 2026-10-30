import type { PreviewRequest, PreviewResponse } from "../preview/preview-protocol";
import type { PreviewResult } from "../preview/preview-protocol";

/**
 * 分屏对照用的独立预览 Worker：与主预览互不抢占，
 * 主文档边写边刷新时，右侧对照不会跟着闪。
 */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (result: PreviewResult) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(
    new URL("../preview/markdown.worker.ts", import.meta.url),
    { type: "module" },
  );
  instance.onmessage = (event: MessageEvent<PreviewResponse>) => {
    const data = event.data;
    const resolve = pending.get(data.id);
    if (!resolve) return;
    pending.delete(data.id);
    resolve(
      data.error
        ? { html: "", error: data.error }
        : { html: data.html, mermaid: data.mermaid },
    );
  };
  instance.onerror = (event) => {
    // Worker 崩了就丢掉，下一次请求重建。
    instance.terminate();
    if (worker === instance) worker = null;
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve({ html: "", error: event.message || "预览 Worker 运行失败" });
    }
  };
  worker = instance;
  return instance;
}

export function renderSplitPreview(markdown: string): Promise<PreviewResult> {
  if (markdown.length > 1_000_000) {
    return Promise.resolve({
      html: "",
      error: "文档超过 1 MB，对照预览已暂停。",
    });
  }
  const current = ensureWorker();
  const id = ++seq;
  return new Promise<PreviewResult>((resolve) => {
    pending.set(id, resolve);
    const request: PreviewRequest = { id, markdown };
    current.postMessage(request);
  });
}
