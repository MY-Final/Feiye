/** 标题文本与链接片段归一到同一形式，兼容中文标题和常见 slug 写法。 */
export function normalizeAnchor(value: string): string {
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {
    // 片段里有非法百分号转义时按原文比较。
  }
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** 预览区标题元素的纵坐标（相对滚动内容顶部）。 */
export function previewHeadingTop(
  pane: HTMLElement,
  heading: HTMLElement,
): number {
  const paneRect = pane.getBoundingClientRect();
  return heading.getBoundingClientRect().top - paneRect.top + pane.scrollTop;
}

export function previewHeadingElements(
  body: HTMLElement,
): HTMLElement[] {
  return Array.from(
    body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
}

/**
 * 预览区当前顶部对应的标题下标；还没滚到第一个标题时返回 -1。
 * 只读位置，不动滚动，供大纲高亮使用。
 *
 * 标题按文档顺序单调向下排列，用二分查找最后一个顶部不超过阈值的标题：
 * 滚到长文档末尾时不再每帧从头把几千个标题都量一遍。
 */
export function previewActiveHeadingIndex(
  pane: HTMLElement,
  headings: HTMLElement[],
): number {
  const count = headings.length;
  if (count === 0) return -1;
  const paneTop = pane.getBoundingClientRect().top;
  const threshold = pane.scrollTop + 12;
  let low = 0;
  let high = count - 1;
  let active = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const top =
      headings[mid].getBoundingClientRect().top - paneTop + pane.scrollTop;
    if (top <= threshold) {
      active = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return active;
}

/** 点击大纲时把预览滚动到对应标题。 */
export function scrollPreviewToHeading(index: number): boolean {
  const pane = document.querySelector<HTMLElement>(".preview-pane");
  const body = pane?.querySelector<HTMLElement>(".markdown-body");
  if (!pane || !body) return false;

  const heading = previewHeadingElements(body)[index];
  if (!heading) return false;

  const top = Math.max(0, previewHeadingTop(pane, heading) - 10);
  pane.scrollTo({ top, behavior: "smooth" });
  return true;
}
