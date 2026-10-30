import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { trapTab } from "../../components/Dialog";
import { copyText } from "../../lib/clipboard";
import {
  resolveMarkdownImageSrc,
  rewritePreviewImages,
} from "../../lib/images";
import { isExternalHref } from "../../lib/links";
import { baseName, resolveRelLink } from "../../lib/paths";
import { useDocumentStore } from "../../stores/document";
import { useOutlineStore } from "../../stores/outline";
import { useWorkspaceStore } from "../../stores/workspace";
import { getEditorText, toggleTaskMarkerAt } from "../editor/editor-bridge";
import { insertImageFiles } from "../editor/image-insert";
import { openFile } from "../workspace/workspace-actions";
import "./preview.css";
import type { PreviewResult } from "./preview-protocol";
import { requestPreview, setPreviewListener } from "./preview-controller";
import {
  normalizeAnchor,
  previewActiveHeadingIndex,
  previewHeadingElements,
  scrollPreviewToHeading,
} from "./preview-scroll";

/** 按 `#` 后面的片段在预览标题里定位，找不到返回 -1。 */
function findHeadingByAnchor(body: HTMLElement, fragment: string): number {
  const target = normalizeAnchor(fragment);
  if (!target) return -1;
  return previewHeadingElements(body).findIndex(
    (heading) => normalizeAnchor(heading.textContent ?? "") === target,
  );
}

import { attachSplitScrollSync } from "./scroll-sync";
import { wrapImageCaptions } from "./figures";
import { renderMermaidBlocks, type MermaidTarget } from "./mermaid";
import { useSettingsStore } from "../../stores/settings";

/**
 * 按顶层块替换预览：相同的前缀与后缀原样留在 DOM 里，只换中间变化的那几段。
 * 代码高亮、已画好的图表和未变段落都不重建，长文档里输入一个字也不会整篇重排。
 * 返回这次渲染各顶层块的 HTML，供下一次比对。
 */
function patchPreviewBlocks(
  body: HTMLElement,
  html: string,
  previous: string[],
): string[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const fresh = Array.from(template.content.children);
  const signatures = fresh.map((node) => node.outerHTML);

  let start = 0;
  while (
    start < previous.length &&
    start < signatures.length &&
    previous[start] === signatures[start]
  ) {
    start += 1;
  }
  let tail = 0;
  while (
    tail < previous.length - start &&
    tail < signatures.length - start &&
    previous[previous.length - 1 - tail] ===
      signatures[signatures.length - 1 - tail]
  ) {
    tail += 1;
  }

  const staleEnd = previous.length - tail;
  const freshEnd = signatures.length - tail;
  if (start < staleEnd || start < freshEnd) {
    const before = body.children[staleEnd] ?? null;
    for (let index = start; index < staleEnd; index += 1) {
      body.children[start]?.remove();
    }
    const fragment = document.createDocumentFragment();
    for (let index = start; index < freshEnd; index += 1) {
      fragment.append(fresh[index].cloneNode(true));
    }
    body.insertBefore(fragment, before);
  }
  return signatures;
}

/** 会话内记住每篇笔记在纯预览里的阅读位置，切走再切回能接着读。 */
const PREVIEW_SCROLL_LIMIT = 100;
const previewScrollPositions = new Map<string, number>();

function rememberPreviewScroll(path: string, top: number): void {
  if (top <= 0) {
    previewScrollPositions.delete(path);
    return;
  }
  // 重新插入，让最近读过的文档留在淘汰顺序的末尾。
  previewScrollPositions.delete(path);
  previewScrollPositions.set(path, top);
  if (previewScrollPositions.size > PREVIEW_SCROLL_LIMIT) {
    const oldest = previewScrollPositions.keys().next().value;
    if (oldest !== undefined) previewScrollPositions.delete(oldest);
  }
}

interface PanePreviewResult extends PreviewResult {
  /** 这份 HTML 属于哪篇笔记：预览 Worker 异步返回，不能直接按当前路径判断。 */
  path: string | null;
}

export function PreviewPane() {
  const [result, setResult] = useState<PanePreviewResult>({
    html: "",
    path: null,
  });
  // 放大查看时带上同篇文档的全部图片，方向键可以一张张翻。
  const [lightbox, setLightbox] = useState<{
    images: { src: string; alt: string }[];
    index: number;
  } | null>(null);
  // 截图里的字常常很小，浮层里用滚轮放大看细节。
  const [zoom, setZoom] = useState(1);
  // 放大后图片会超出屏幕，按住拖动才能看到边角。
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // 小图放大后仍不足一屏，没有可拖的余量；提示与光标要跟着收敛。
  const [canPan, setCanPan] = useState(false);
  const [dragging, setDragging] = useState(false);
  const panStart = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  // 拖完那一次不算点击，别让浮层跟着关掉。
  const panMoved = useRef(false);
  // 放大时单击关闭要稍等，给双击复位留出时间，别让第一下就关掉浮层。
  const closeTimer = useRef<number | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const root = useWorkspaceStore((state) => state.root);
  const docPath = useDocumentStore((state) => state.path);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const cursorLine = useDocumentStore((state) => state.cursor.line);
  const themeMode = useSettingsStore((state) => state.preferences.theme);

  // 本地图片走工作区作用域的 feiyeimg 协议；远程图片保持原样。
  const html = useMemo(
    () => rewritePreviewImages(result.html, root, docPath ?? ""),
    [result.html, root, docPath],
  );

  // 增量上屏：同一篇笔记内只替换变动的块；换文档时整篇重来，免得沿用旧节点。
  const rawBlocks = useRef<string[]>([]);
  const patchedPath = useRef<string | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (patchedPath.current !== docPath) {
      patchedPath.current = docPath;
      body.innerHTML = html;
      // innerHTML 生成的就是未经后处理的原样块，正好作为下次比对的基准。
      rawBlocks.current = Array.from(body.children).map(
        (node) => node.outerHTML,
      );
      return;
    }
    rawBlocks.current = patchPreviewBlocks(body, html, rawBlocks.current);
  }, [html, docPath]);

  useEffect(() => {
    setPreviewListener((next) =>
      setResult({
        ...next,
        // Worker 只回 HTML，落结果时记下当前文档；过期结果会被控制器丢弃。
        path: useDocumentStore.getState().path,
      }),
    );
    return () => setPreviewListener(null);
  }, []);

  /** 打开浮层时收集当前文档里的图片，翻页就在这份列表里走。 */
  const openLightbox = (src: string, alt: string) => {
    const body = bodyRef.current;
    const images = body
      ? Array.from(body.querySelectorAll<HTMLImageElement>("img")).map(
          (image) => ({ src: image.currentSrc || image.src, alt: image.alt }),
        )
      : [];
    setZoom(1);
    setPan({ x: 0, y: 0 });
    const found = images.findIndex((image) => image.src === src);
    // 链接指向的图片可能没在正文里出现，单独补一张即可。
    setLightbox(
      found >= 0
        ? { images, index: found }
        : { images: [...images, { src, alt }], index: images.length },
    );
  };

  const stepLightbox = (delta: number) => {
    setLightbox((current) => {
      if (!current || current.images.length < 2) return current;
      const total = current.images.length;
      return {
        ...current,
        index: (current.index + delta + total) % total,
      };
    });
  };

  // 外部链接交给系统浏览器；笔记间的相对链接在应用内打开。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      // 预览里的任务复选框：翻转源文档中对应的 [ ] / [x]。
      if (target instanceof HTMLInputElement && target.type === "checkbox") {
        const boxes = Array.from(
          body.querySelectorAll<HTMLInputElement>(
            "li > input[type='checkbox']",
          ),
        );
        const index = boxes.indexOf(target);
        if (index < 0) return;
        event.preventDefault();
        toggleTaskMarkerAt(index, boxes.length);
        return;
      }

      // 点图片放大查看，方便看清截图里的细节；包在链接里的图片交给下面的链接分支。
      if (target instanceof HTMLImageElement && !target.closest("a")) {
        const src = target.currentSrc || target.src;
        if (src) {
          event.preventDefault();
          openLightbox(src, target.alt);
        }
        return;
      }

      const anchor = target?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      if (isExternalHref(href)) {
        event.preventDefault();
        void openUrl(href).catch(() => {
          // 权限或系统调用失败时保持页面不动。
        });
        return;
      }

      if (!href) return;

      // 文档内锚点：预览标题用的是内部 id，这里按标题文字找回目标标题。
      if (href.startsWith("#")) {
        const index = findHeadingByAnchor(body, href.slice(1));
        if (index < 0) return;
        event.preventDefault();
        scrollPreviewToHeading(index);
        return;
      }

      // 指向其他笔记的相对链接：解析成工作区路径后直接打开。
      event.preventDefault();
      const current = useDocumentStore.getState().path;
      const relPath = current ? resolveRelLink(href, current) : null;

      // 链到图片（如 `[截图](assets/a.png)`）时用放大浮层打开，别做无效点击。
      if (relPath && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(relPath)) {
        const root = useWorkspaceStore.getState().root;
        const image = resolveMarkdownImageSrc(root, "", relPath);
        if (image) openLightbox(image.url, baseName(relPath));
        return;
      }

      if (relPath && /\.(md|markdown|mdx)$/i.test(relPath)) {
        const hash = href.indexOf("#");
        const fragment = hash >= 0 ? href.slice(hash + 1) : undefined;
        // 带文件名的自链接（如 `本文.md#小节`）不重新打开，直接滚动。
        if (current === relPath) {
          if (fragment) {
            const index = findHeadingByAnchor(body, fragment);
            if (index >= 0) scrollPreviewToHeading(index);
          }
          return;
        }
        // 链接带 `#标题` 时，打开后继续定位到那一节。
        void openFile(
          { relPath, name: baseName(relPath), isDir: false },
          false,
          fragment,
        );
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

  // 放大查看时按 Esc 关闭、左右方向键翻页；切换文档时也一并关掉，
  // 避免停留在上一张图上。
  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightbox(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (lightbox.images.length < 2) return;
      event.preventDefault();
      stepLightbox(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox?.images.length]);

  useEffect(() => {
    setLightbox(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [docPath]);

  // 翻到另一张图、或缩回 100% 时回到居中，免得新图从上一张的偏移位置开始。
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [lightbox?.index]);

  // 放大后拖动最多让图片边缘贴住可视区边缘，不让整张图被拖出屏幕。
  // 某个方向放大后仍小于可视区时，该方向锁在居中。
  const panLimits = () => {
    const image = imageRef.current;
    const box = lightboxRef.current;
    if (!image || !box) return { x: 0, y: 0 };
    const style = getComputedStyle(box);
    const availW =
      box.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const availH =
      box.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom);
    return {
      x: Math.max(0, (image.offsetWidth * zoom - availW) / 2),
      y: Math.max(0, (image.offsetHeight * zoom - availH) / 2),
    };
  };

  const clampPan = (x: number, y: number) => {
    const limit = panLimits();
    return {
      x: Math.min(limit.x, Math.max(-limit.x, x)),
      y: Math.min(limit.y, Math.max(-limit.y, y)),
    };
  };

  // 图片加载完成、窗口大小变化都会改变可拖余量：
  // 小图放大后仍不足一屏时不该给抓手光标，也不该提示「拖动平移」。
  useEffect(() => {
    if (!lightbox) {
      setCanPan(false);
      return;
    }
    const update = () => {
      const limit = panLimits();
      setCanPan(limit.x > 0 || limit.y > 0);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    if (imageRef.current) observer.observe(imageRef.current);
    if (lightboxRef.current) observer.observe(lightboxRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox !== null, lightbox?.index, zoom]);

  useEffect(() => {
    setPan((current) =>
      zoom === 1 ? { x: 0, y: 0 } : clampPan(current.x, current.y),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // 浮层关掉后取消还没触发的延迟关闭，别让它关掉下一次打开的浮层。
  useEffect(() => {
    if (lightbox) return;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, [lightbox]);

  // 浮层打开时把焦点收进来，关闭后还回去：读屏和键盘都不会停在背后的正文上。
  useEffect(() => {
    if (!lightbox) return;
    const previous = document.activeElement;
    lightboxRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [lightbox !== null]);

  // 浮层是预览面板的子节点，滚轮会穿透到后面的正文：看图时把它挡住，
  // 关掉浮层后阅读位置才不会被悄悄挪走；挡住的同时拿滚轮调缩放。
  useEffect(() => {
    if (!lightbox) return;
    const pane = paneRef.current;
    if (!pane) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const step = event.deltaY < 0 ? 0.25 : -0.25;
      setZoom((current) => Math.min(4, Math.max(0.5, current + step)));
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, [lightbox]);

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

    // GFM 默认把任务复选框渲染成 disabled，这里放开以便在预览里直接勾选。
    body
      .querySelectorAll<HTMLInputElement>(
        "li > input[type='checkbox']",
      )
      .forEach((input) => {
        input.disabled = false;
        input.setAttribute("aria-label", "切换任务完成状态");
      });

    // 悬停时显示链接目标，点之前就知道会去哪；用户自己写了 title 的不覆盖。
    body.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      // 自己加过的提示在切换文档后要按新路径重算，用户写的则不动。
      if (anchor.title && anchor.dataset.linkHint !== "1") return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href) return;
      // 文档内锚点也告诉用户会跳到哪一节，别让人猜。
      if (href.startsWith("#")) {
        let fragment = href.slice(1);
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          // 片段里有非法转义时按原文提示。
        }
        if (fragment) anchor.title = `跳转到「${fragment}」`;
        anchor.dataset.linkHint = "1";
        return;
      }
      anchor.title = isExternalHref(href)
        ? href
        : (docPath && resolveRelLink(href, docPath)) || href;
      anchor.dataset.linkHint = "1";
    });
  }, [html, docPath]);

  // 离开预览后不再沿用上次的阅读位置：回到编辑时以光标为准。
  useEffect(() => {
    if (viewMode === "preview" || !docPath) return;
    previewScrollPositions.delete(docPath);
  }, [viewMode, docPath]);

  // 预览内容真正换成这篇笔记后，再恢复上次读到的地方；
  // 不能只看文档路径，否则 Worker 还没返回时会拿旧 HTML 去滚。
  useEffect(() => {
    if (viewMode !== "preview" || !docPath || result.path !== docPath) return;
    const saved = previewScrollPositions.get(docPath);
    const pane = paneRef.current;
    if (saved === undefined || !pane) return;
    const frame = requestAnimationFrame(() => {
      pane.scrollTop = saved;
    });
    return () => cancelAnimationFrame(frame);
  }, [viewMode, docPath, result.path]);

  // 切到预览时停止在光标所在标题，而不是回到文档开头；
  // 从别的笔记切回来时，优先回到上次的阅读位置。
  useEffect(() => {
    if (viewMode !== "preview" || result.path !== docPath) return;
    if (docPath && previewScrollPositions.has(docPath)) return;
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
  }, [viewMode, docPath, cursorLine, result.path]);

  // 纯预览模式下滚动阅读时，让左侧大纲跟着高亮当前章节；
  // 只更新大纲，不移动编辑器光标。
  useEffect(() => {
    if (viewMode !== "preview") {
      useOutlineStore.getState().setScrollIndex(null);
      return;
    }
    const pane = paneRef.current;
    const body = bodyRef.current;
    if (!pane || !body) return;

    let frame: number | null = null;
    const update = () => {
      frame = null;
      const index = previewActiveHeadingIndex(pane, body);
      useOutlineStore.getState().setScrollIndex(index < 0 ? null : index);
    };
    const schedule = () => {
      // 只有当前 HTML 真的属于这篇笔记时才记位置；切换文档的过渡帧里
      // 面板还显示着上一篇，别把旧滚动位置存到新文档名下。
      if (docPath && result.path === docPath) {
        rememberPreviewScroll(docPath, pane.scrollTop);
      }
      if (frame === null) frame = window.requestAnimationFrame(update);
    };

    pane.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => {
      pane.removeEventListener("scroll", schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [viewMode, html, docPath, result.path]);

  // 分栏模式：按标题锚点同步编辑区与预览区滚动。
  useEffect(() => {
    if (viewMode !== "split") return;
    const pane = paneRef.current;
    const body = bodyRef.current;
    if (!pane || !body) return;
    return attachSplitScrollSync(pane, body);
  }, [viewMode, html]);

  // 图片的 title 显示成图注；宽高 / 对齐来自 Markdown 的 {width=… align=…}。
  useEffect(() => {
    const body = bodyRef.current;
    if (body) wrapImageCaptions(body);
  }, [html]);

  // ```mermaid 代码块画成图：Worker 只给源码，这里按需懒加载 Mermaid。
  // 先打标记，避免下面给代码块补「复制」按钮时把图表源码也包一层。
  // 增量上屏后，未变的图表留在原位：只有主题变化时才整批重画。
  const mermaidTheme = useRef<string | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    const sources = result.mermaid;
    if (!body || !sources?.length) return;
    const themeChanged = mermaidTheme.current !== themeMode;
    mermaidTheme.current = themeMode;
    const wanted = new Set(sources.map((source) => source.trim()));
    const targets: MermaidTarget[] = [];
    for (const pre of body.querySelectorAll("pre")) {
      if (pre.closest("figure.mermaid-figure, .preview-code-block")) continue;
      const source = (pre.textContent ?? "").trim();
      if (!wanted.has(source)) continue;
      pre.dataset.mermaid = "pending";
      targets.push({ element: pre, source });
    }
    if (themeChanged) {
      for (const figure of body.querySelectorAll<HTMLElement>(
        "figure.mermaid-figure[data-source]",
      )) {
        targets.push({ element: figure, source: figure.dataset.source ?? "" });
      }
    }
    if (!targets.length) return;
    const cancel = { cancelled: false };
    void renderMermaidBlocks(targets, cancel);
    return () => {
      cancel.cancelled = true;
    };
  }, [html, result.mermaid, themeMode]);

  // 给预览里的每段代码挂一个复制按钮。HTML 由 Worker 生成，
  // 这里在每次渲染后补齐按钮，不改动 Markdown 管线。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    for (const pre of body.querySelectorAll("pre")) {
      if (pre.dataset.mermaid) continue;
      if (pre.parentElement?.classList.contains("preview-code-block")) {
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "preview-code-block";
      pre.replaceWith(wrapper);
      wrapper.append(pre);

      // 代码围栏写了语言时在左上角标出来，和 GitHub 的习惯一致；
      // Shiki 把语言写成 `language-*` 类，未知语言会回退成 `text`，这种不标。
      const language = /(?:^|\s)language-([\w+#.-]+)/.exec(
        pre.querySelector("code")?.className ?? "",
      )?.[1];
      if (language && language !== "text") {
        const tag = document.createElement("span");
        tag.className = "preview-code-lang";
        tag.textContent = language;
        wrapper.append(tag);
      }

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

  const lightboxImage = lightbox ? lightbox.images[lightbox.index] : null;
  // 单张图放大时也要报百分比：只看画面变大，分不清放到了几倍。
  const lightboxStatus = [
    lightbox && lightbox.images.length > 1
      ? `${lightbox.index + 1} / ${lightbox.images.length}`
      : "",
    zoom !== 1 ? `${Math.round(zoom * 100)}%` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="preview-pane"
      ref={paneRef}
      // 拖到这里和拖进编辑区效果一致：图片存进 assets 并写进当前笔记；
      // 其它文件也拦下来，免得 WebView 把它当导航打开。
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        insertImageFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {result.error ? (
        <div className="preview-error" role="alert">
          <span>预览失败：{result.error}</span>
          {/* 预览 Worker 崩溃或偶发渲染失败时，重试比重启应用省事。 */}
          <button
            type="button"
            className="preview-retry"
            onClick={() => requestPreview(getEditorText() ?? "", true)}
          >
            重试
          </button>
        </div>
      ) : null}
      <article className="markdown-body" ref={bodyRef} />
      {lightbox && lightboxImage ? (
        <div
          ref={lightboxRef}
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightboxImage.alt || "图片预览"}
          tabIndex={-1}
          onKeyDown={trapTab}
          onClick={() => {
            if (panMoved.current) {
              panMoved.current = false;
              return;
            }
            // 放大时留一点时间判断是不是双击复位，再决定关不关。
            if (zoom !== 1) {
              if (closeTimer.current !== null) {
                window.clearTimeout(closeTimer.current);
              }
              closeTimer.current = window.setTimeout(() => {
                closeTimer.current = null;
                setLightbox(null);
              }, 250);
              return;
            }
            setLightbox(null);
          }}
        >
          <img
            ref={imageRef}
            src={lightboxImage.src}
            alt={lightboxImage.alt}
            draggable={false}
            className={`${zoom > 1 && canPan ? "is-zoomed" : ""}${
              dragging ? " is-dragging" : ""
            }`}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
            onPointerDown={(event) => {
              if (zoom <= 1) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              panStart.current = {
                x: event.clientX,
                y: event.clientY,
                panX: pan.x,
                panY: pan.y,
              };
              panMoved.current = false;
              // 不足一屏时没有可拖的余量，但不把拖动当点击：松手别顺手关掉浮层。
              if (canPan) setDragging(true);
            }}
            onPointerMove={(event) => {
              const start = panStart.current;
              if (!start) return;
              const dx = event.clientX - start.x;
              const dy = event.clientY - start.y;
              if (Math.abs(dx) + Math.abs(dy) > 3) panMoved.current = true;
              if (canPan) setPan(clampPan(start.panX + dx, start.panY + dy));
            }}
            onPointerUp={(event) => {
              if (!panStart.current) return;
              panStart.current = null;
              setDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => {
              panStart.current = null;
              setDragging(false);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (closeTimer.current !== null) {
                window.clearTimeout(closeTimer.current);
                closeTimer.current = null;
              }
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          />
          {lightbox.images.length > 1 ? (
            <>
              <button
                type="button"
                className="image-lightbox-nav prev"
                aria-label="上一张图片"
                onClick={(event) => {
                  event.stopPropagation();
                  stepLightbox(-1);
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="image-lightbox-nav next"
                aria-label="下一张图片"
                onClick={(event) => {
                  event.stopPropagation();
                  stepLightbox(1);
                }}
              >
                ›
              </button>
            </>
          ) : null}
          <div className="image-lightbox-info">
            {/* 连续截屏时分不清是哪张，把替代文字当作说明贴在底部。 */}
            {lightboxImage.alt ? (
              <span className="image-lightbox-caption">
                {lightboxImage.alt}
              </span>
            ) : null}
            {lightboxStatus ? (
              <span className="image-lightbox-count">{lightboxStatus}</span>
            ) : null}
            {/* 放大以后操作提示也留着：不然只看到百分比，不知道怎么缩回去。 */}
            <span className="image-lightbox-hint">
              {zoom === 1
                ? "滚轮缩放 · Esc 关闭"
                : canPan
                  ? "拖动平移 · 双击复位 · 滚轮缩放 · Esc 关闭"
                  : "双击复位 · 滚轮缩放 · Esc 关闭"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
