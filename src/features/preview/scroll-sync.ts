import {
  getEditorScrollMetrics,
  isEditorScrollRestoring,
  setEditorScrollTop,
} from "../editor/editor-bridge";
import type { OutlineHeading } from "../editor/outline";
import { useOutlineStore } from "../../stores/outline";
import {
  previewHeadingElements,
  previewHeadingTop,
} from "./preview-scroll";

interface Anchor {
  editor: number;
  preview: number;
}

function maxScroll(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function buildAnchors(
  pane: HTMLElement,
  body: HTMLElement,
  headings: OutlineHeading[],
): Anchor[] | null {
  if (headings.length === 0) return null;

  const previewHeadings = previewHeadingElements(body);
  if (previewHeadings.length !== headings.length) return null;

  const metrics = getEditorScrollMetrics(headings.map((heading) => heading.from));
  if (!metrics) return null;

  const points: Anchor[] = [{ editor: 0, preview: 0 }];

  headings.forEach((_, index) => {
    const editor = metrics.headingTops[index];
    const preview = previewHeadingTop(pane, previewHeadings[index]);
    const last = points[points.length - 1];
    if (editor > last.editor && preview > last.preview) {
      points.push({ editor, preview });
    }
  });

  const editorMax = maxScroll(
    pane.ownerDocument.querySelector<HTMLElement>(".cm-scroller") ?? pane,
  );
  const previewMax = maxScroll(pane);
  const last = points[points.length - 1];
  if (editorMax > last.editor && previewMax > last.preview) {
    points.push({ editor: editorMax, preview: previewMax });
  }

  return points.length > 1 ? points : null;
}

function mapValue(
  points: Anchor[],
  value: number,
  from: keyof Anchor,
  to: keyof Anchor,
): number {
  if (value <= points[0][from]) return points[0][to];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const span = current[from] - previous[from];
    if (span <= 0) continue;
    if (value <= current[from]) {
      const progress = (value - previous[from]) / span;
      return previous[to] + progress * (current[to] - previous[to]);
    }
  }
  return points[points.length - 1][to];
}

function ratioTarget(
  value: number,
  sourceMax: number,
  targetMax: number,
): number {
  if (sourceMax <= 0 || targetMax <= 0) return 0;
  return (Math.min(value, sourceMax) / sourceMax) * targetMax;
}

/** 程序化写入后这段窗口内的 scroll 事件不当作「用户滚动」反推另一侧。 */
const APPLIED_SCROLL_GRACE_MS = 120;

/**
 * 这次 scroll 事件是否只是我们自己刚写入的位置。
 * 位置与写入值一致是正常的回声；写入后被布局钳制（图片未加载、
 * 内容变短、滚动锚定修正）导致位置对不上，也在宽限窗口内继续忽略，
 * 否则会用锚点映射反推另一侧，往返映射不精确会把编辑器推走。
 */
export function shouldIgnoreProgrammaticScroll(
  applied: number | null,
  appliedAt: number,
  current: number,
  now: number,
): boolean {
  if (applied === null) return false;
  if (Math.abs(current - applied) <= 1) return true;
  return now - appliedAt < APPLIED_SCROLL_GRACE_MS;
}

/**
 * 分栏模式的标题锚点滚动同步。
 * 先按标题建立映射，标题数量不一致时退回整篇比例映射。
 */
export function attachSplitScrollSync(
  pane: HTMLElement,
  body: HTMLElement,
): () => void {
  const editor = pane.ownerDocument.querySelector<HTMLElement>(".cm-scroller");
  if (!editor) return () => {};

  let frame: number | null = null;
  let source: "editor" | "preview" | null = null;
  let appliedEditor: number | null = null;
  let appliedEditorAt = 0;
  let appliedPreview: number | null = null;
  let appliedPreviewAt = 0;
  /** 恢复阅读位置期间收到过同步请求：恢复结束后以编辑器为准补对齐一次。 */
  let restorePending = false;

  // 锚点只在标题或布局变化时重建。滚动帧里标题几何不变，逐帧量几千个
  // 标题的 getBoundingClientRect / lineBlockAt 是长文档掉帧的主因。
  let cachedAnchors: Anchor[] | null = null;
  let cachedHeadings: OutlineHeading[] | null = null;
  const anchorsFor = (): Anchor[] | null => {
    const headings = useOutlineStore.getState().headings;
    if (headings === cachedHeadings) return cachedAnchors;
    cachedHeadings = headings;
    cachedAnchors = buildAnchors(pane, body, headings);
    return cachedAnchors;
  };
  const invalidateAnchors = () => {
    cachedHeadings = null;
  };

  const editorMax = () => maxScroll(editor);
  const previewMax = () => maxScroll(pane);

  const pushPreview = (top: number) => {
    const target = Math.max(0, Math.min(top, previewMax()));
    if (Math.abs(pane.scrollTop - target) < 0.5) return;
    appliedPreview = target;
    appliedPreviewAt = performance.now();
    pane.scrollTop = target;
  };

  const pushEditor = (top: number) => {
    const target = Math.max(0, Math.min(top, editorMax()));
    if (Math.abs(editor.scrollTop - target) < 0.5) return;
    appliedEditor = target;
    appliedEditorAt = performance.now();
    setEditorScrollTop(target);
  };

  const syncEditorToPreview = () => {
    const anchors = anchorsFor();
    if (anchors) {
      pushPreview(
        mapValue(anchors, editor.scrollTop, "editor", "preview"),
      );
      return;
    }
    pushPreview(ratioTarget(editor.scrollTop, editorMax(), previewMax()));
  };

  const syncPreviewToEditor = () => {
    const anchors = anchorsFor();
    if (anchors) {
      pushEditor(
        mapValue(anchors, pane.scrollTop, "preview", "editor"),
      );
      return;
    }
    pushEditor(ratioTarget(pane.scrollTop, previewMax(), editorMax()));
  };

  const run = () => {
    frame = null;
    if (isEditorScrollRestoring()) {
      // 阅读位置还在恢复：期间写入的滚动位置不反推另一侧，等它落定。
      restorePending = true;
      frame = window.requestAnimationFrame(run);
      return;
    }
    if (restorePending) {
      restorePending = false;
      syncEditorToPreview();
      return;
    }
    const current = source;
    source = null;
    if (!current) return;
    if (current === "editor") syncEditorToPreview();
    else syncPreviewToEditor();
  };

  const schedule = (next: "editor" | "preview") => {
    if (window.innerWidth <= 880) return;
    if (isEditorScrollRestoring()) {
      restorePending = true;
      if (frame === null) frame = window.requestAnimationFrame(run);
      return;
    }
    source = next;
    if (frame === null) frame = window.requestAnimationFrame(run);
  };

  const onEditorScroll = () => {
    if (appliedEditor !== null) {
      const expected = appliedEditor;
      const ignored = shouldIgnoreProgrammaticScroll(
        expected,
        appliedEditorAt,
        editor.scrollTop,
        performance.now(),
      );
      // 位置已对上或还在宽限窗口内：这是程序化滚动，不算用户操作。
      if (ignored) {
        if (Math.abs(editor.scrollTop - expected) <= 1) appliedEditor = null;
        return;
      }
      appliedEditor = null;
    }
    schedule("editor");
  };

  const onPreviewScroll = () => {
    if (appliedPreview !== null) {
      const expected = appliedPreview;
      const ignored = shouldIgnoreProgrammaticScroll(
        expected,
        appliedPreviewAt,
        pane.scrollTop,
        performance.now(),
      );
      if (ignored) {
        if (Math.abs(pane.scrollTop - expected) <= 1) appliedPreview = null;
        return;
      }
      appliedPreview = null;
    }
    schedule("preview");
  };

  const onLayoutChange = () => {
    invalidateAnchors();
    schedule("editor");
  };

  editor.addEventListener("scroll", onEditorScroll, { passive: true });
  pane.addEventListener("scroll", onPreviewScroll, { passive: true });
  body.addEventListener("load", onLayoutChange, true);
  window.addEventListener("resize", onLayoutChange);

  const observer = new ResizeObserver(onLayoutChange);
  observer.observe(body);
  observer.observe(pane);

  // 进入分栏或预览重新渲染后，以编辑器为基准对齐一次。
  // 窄窗口下分栏会上下堆叠，两个滚动区各自独立。
  window.requestAnimationFrame(() => {
    if (window.innerWidth > 880) syncEditorToPreview();
  });

  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    editor.removeEventListener("scroll", onEditorScroll);
    pane.removeEventListener("scroll", onPreviewScroll);
    body.removeEventListener("load", onLayoutChange, true);
    window.removeEventListener("resize", onLayoutChange);
    observer.disconnect();
  };
}
