/**
 * Mermaid 体积不小，只有文档里真的出现图表时才加载。
 * 严格模式禁止图表里的脚本执行；渲染失败时保留源码并说明原因。
 */
type MermaidModule = typeof import("mermaid").default;

let loader: Promise<MermaidModule> | null = null;
let seq = 0;

function loadMermaid(): Promise<MermaidModule> {
  loader ??= import("mermaid").then((module) => module.default);
  return loader;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface MermaidTarget {
  element: HTMLElement;
  source: string;
}

export interface MermaidCancel {
  cancelled: boolean;
}

function fillError(figure: HTMLElement, source: string, message: string): void {
  figure.classList.add("is-error");
  const pre = document.createElement("pre");
  pre.className = "mermaid-source";
  pre.textContent = source;
  const note = document.createElement("figcaption");
  note.className = "mermaid-error";
  note.textContent = `图表渲染失败：${message}`;
  figure.replaceChildren(pre, note);
}

/** 把代码块（或已有图表）渲染成 SVG；主题变化时同一批目标会重画。 */
export async function renderMermaidBlocks(
  targets: MermaidTarget[],
  cancel: MermaidCancel,
): Promise<void> {
  if (!targets.length) return;

  let mermaid: MermaidModule;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    for (const { element, source } of targets) {
      if (cancel.cancelled || !element.isConnected) return;
      const figure = element.classList.contains("mermaid-figure")
        ? element
        : document.createElement("figure");
      figure.className = "mermaid-figure";
      fillError(figure, source, errorText(error));
      if (figure !== element) {
        (element.closest(".preview-code-block") ?? element).replaceWith(figure);
      }
    }
    return;
  }

  if (cancel.cancelled) return;
  const dark = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
  });

  for (const { element, source } of targets) {
    if (cancel.cancelled || !element.isConnected) return;
    const isFigure = element.classList.contains("mermaid-figure");
    const figure = isFigure ? element : document.createElement("figure");
    figure.className = "mermaid-figure";
    figure.dataset.source = source;
    try {
      const { svg } = await mermaid.render(`feiye-mermaid-${++seq}`, source);
      figure.classList.remove("is-error");
      figure.innerHTML = svg;
    } catch (error) {
      fillError(figure, source, errorText(error));
    }
    if (cancel.cancelled || !element.isConnected) return;
    if (!isFigure) {
      (element.closest(".preview-code-block") ?? element).replaceWith(figure);
    }
  }
}
