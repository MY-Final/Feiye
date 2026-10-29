import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { copyText } from "../../lib/clipboard";
import { rewritePreviewImages } from "../../lib/images";
import { useDocumentStore } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";
import { useWorkspaceStore } from "../../stores/workspace";
import "./preview.css";
import type { PreviewResult } from "./preview-protocol";
import { setPreviewListener } from "./preview-controller";
import { scrollPreviewToHeading } from "./preview-scroll";
import { attachSplitScrollSync } from "./scroll-sync";

export function PreviewPane() {
  const [result, setResult] = useState<PreviewResult>({ html: "" });
  const paneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const root = useWorkspaceStore((state) => state.root);
  const docPath = useDocumentStore((state) => state.path);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const cursorLine = useDocumentStore((state) => state.cursor.line);

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

  // 给标题补上稳定锚点，供大纲跳转和滚动同步使用。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body
      .querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")
      .forEach((heading, index) => {
        heading.id = `preview-heading-${index}`;
        heading.dataset.headingIndex = String(index);
      });
  }, [html]);

  // 切到预览时停止在光标所在标题，而不是回到文档开头。
  useEffect(() => {
    if (viewMode !== "preview") return;
    const headings = useOutlineStore.getState().headings;
    if (headings.length === 0) return;

    let index = 0;
    for (let i = 0; i < headings.length; i += 1) {
      if (headings[i].line <= cursorLine) index = i;
      else break;
    }

    // 等一帧，让预览从 display:none 恢复布局后再量标题位置。
    const frame = requestAnimationFrame(() => {
      scrollPreviewToHeading(index);
    });
    return () => cancelAnimationFrame(frame);
  }, [viewMode, docPath, cursorLine]);

  // 分栏模式：按标题锚点同步编辑区与预览区滚动。
  useEffect(() => {
    if (viewMode !== "split") return;
    const pane = paneRef.current;
    const body = bodyRef.current;
    if (!pane || !body) return;
    return attachSplitScrollSync(pane, body);
  }, [viewMode, html]);

  // 给预览里的每段代码挂一个复制按钮。HTML 由 Worker 生成，
  // 这里在每次渲染后补齐按钮，不改动 Markdown 管线。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    for (const pre of body.querySelectorAll("pre")) {
      if (pre.parentElement?.classList.contains("preview-code-block")) {
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "preview-code-block";
      pre.replaceWith(wrapper);
      wrapper.append(pre);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "preview-code-copy";
      button.textContent = "复制";
      button.title = "复制代码";
      button.setAttribute("aria-label", "复制代码");
      let resetTimer: number | null = null;

      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", () => {
        if (resetTimer !== null) {
          window.clearTimeout(resetTimer);
          resetTimer = null;
        }
        const raw = pre.textContent ?? "";
        const text = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
        void copyText(text).then((copied) => {
          if (!button.isConnected) return;
          button.textContent = copied ? "已复制" : "复制失败";
          button.classList.toggle("is-copied", copied);
          button.setAttribute(
            "aria-label",
            copied ? "已复制代码" : "复制代码失败",
          );
          resetTimer = window.setTimeout(() => {
            button.textContent = "复制";
            button.classList.remove("is-copied");
            button.setAttribute("aria-label", "复制代码");
            resetTimer = null;
          }, 1500);
        });
      });

      wrapper.append(button);
    }
  }, [html]);

  return (
    <div className="preview-pane" ref={paneRef}>
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
