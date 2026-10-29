import {
  getEditorScrollMetrics,
  setEditorScrollTop,
} from "../editor/editor-bridge";
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

function buildAnchors(pane: HTMLElement, body: HTMLElement): Anchor[] | null {
  const headings = useOutlineStore.getState().headings;
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
  let appliedPreview: number | null = null;

  const editorMax = () => maxScroll(editor);
  const previewMax = () => maxScroll(pane);

  const pushPreview = (top: number) => {
    const target = Math.max(0, Math.min(top, previewMax()));
    if (Math.abs(pane.scrollTop - target) < 0.5) return;
    appliedPreview = target;
    pane.scrollTop = target;
  };

  const pushEditor = (top: number) => {
    const target = Math.max(0, Math.min(top, editorMax()));
    if (Math.abs(editor.scrollTop - target) < 0.5) return;
    appliedEditor = target;
    setEditorScrollTop(target);
  };

  const syncEditorToPreview = () => {
    const anchors = buildAnchors(pane, body);
    if (anchors) {
      pushPreview(
        mapValue(anchors, editor.scrollTop, "editor", "preview"),
      );
      return;
    }
    pushPreview(ratioTarget(editor.scrollTop, editorMax(), previewMax()));
  };

  const syncPreviewToEditor = () => {
    const anchors = buildAnchors(pane, body);
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
    const current = source;
    source = null;
    if (!current) return;
    if (current === "editor") syncEditorToPreview();
    else syncPreviewToEditor();
  };

  const schedule = (next: "editor" | "preview") => {
    if (window.innerWidth <= 880) return;
    source = next;
    if (frame === null) frame = window.requestAnimationFrame(run);
  };

  const onEditorScroll = () => {
    if (appliedEditor !== null) {
      const expected = appliedEditor;
      appliedEditor = null;
      if (Math.abs(editor.scrollTop - expected) <= 1) return;
    }
    schedule("editor");
  };

  const onPreviewScroll = () => {
    if (appliedPreview !== null) {
      const expected = appliedPreview;
      appliedPreview = null;
      if (Math.abs(pane.scrollTop - expected) <= 1) return;
    }
    schedule("preview");
  };

  const onLayoutChange = () => schedule("editor");

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
