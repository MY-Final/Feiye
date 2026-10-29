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
