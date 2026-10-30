/**
 * 图片的 title 当作图注：把 `<img title="…">` 包进 figure 并补 figcaption。
 * HTML 由 Worker 生成、每次预览重绘，这里只做一次性的 DOM 增强。
 */
export function wrapImageCaptions(body: HTMLElement): void {
  const images = Array.from(body.querySelectorAll<HTMLImageElement>("img[title]"));
  for (const img of images) {
    const title = img.getAttribute("title")?.trim();
    if (!title) continue;
    if (img.closest("figure.md-figure")) continue;

    const doc = body.ownerDocument;
    const figure = doc.createElement("figure");
    figure.className = "md-figure";
    for (const align of ["left", "center", "right"]) {
      if (img.classList.contains(`md-align-${align}`)) {
        figure.classList.add(`md-align-${align}`);
      }
    }
    img.removeAttribute("title");
    img.replaceWith(figure);
    figure.appendChild(img);

    const caption = doc.createElement("figcaption");
    caption.textContent = title;
    figure.appendChild(caption);
  }
}
