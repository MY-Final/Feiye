import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "katex/dist/katex.min.css";

import "./preview.css";
import type { PreviewResult } from "./preview-protocol";
import { setPreviewListener } from "./preview-controller";

export function PreviewPane() {
  const [result, setResult] = useState<PreviewResult>({ html: "" });
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPreviewListener(setResult);
    return () => setPreviewListener(null);
  }, []);

  // 外部链接交给系统浏览器；相对链接暂不跳转，避免 WebView 离开应用。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        void openUrl(href).catch(() => {
          // 权限或系统调用失败时保持页面不动。
        });
      } else if (!href.startsWith("#")) {
        event.preventDefault();
      }
    };

    body.addEventListener("click", onClick);
    return () => body.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="preview-pane">
      {result.error ? (
        <div className="preview-error" role="alert">
          预览失败：{result.error}
        </div>
      ) : null}
      <article
        className="markdown-body"
        ref={bodyRef}
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    </div>
  );
}
