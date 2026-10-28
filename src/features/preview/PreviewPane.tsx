import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { rewritePreviewImages } from "../../lib/images";
import { useDocumentStore } from "../../stores/document";
import { useWorkspaceStore } from "../../stores/workspace";
import "./preview.css";
import type { PreviewResult } from "./preview-protocol";
import { setPreviewListener } from "./preview-controller";

export function PreviewPane() {
  const [result, setResult] = useState<PreviewResult>({ html: "" });
  const bodyRef = useRef<HTMLDivElement>(null);
  const root = useWorkspaceStore((state) => state.root);
  const docPath = useDocumentStore((state) => state.path);

  // 本地图片走工作区作用域的 feiyeimg 协议；远程图片保持原样。
  const html = useMemo(
    () => rewritePreviewImages(result.html, root, docPath ?? ""),
    [result.html, root, docPath],
  );

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

    const onImageError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      target.classList.add("preview-image-broken");
      if (!target.alt) target.alt = "图片无法加载";
    };

    body.addEventListener("click", onClick);
    body.addEventListener("error", onImageError, true);
    return () => {
      body.removeEventListener("click", onClick);
      body.removeEventListener("error", onImageError, true);
    };
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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
