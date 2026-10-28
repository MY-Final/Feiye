import type { EditorView } from "@codemirror/view";
import { WidgetType } from "@codemirror/view";
import katex from "katex";

import type { ResolvedImage } from "../../../lib/images";
import { buildTableDom, type TableModel } from "./table";

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly image: ResolvedImage | null,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.src === this.src &&
      other.alt === this.alt &&
      other.image?.url === this.image?.url
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-wysiwyg-image";

    if (!this.image) {
      wrapper.classList.add("broken");
      wrapper.textContent = this.alt || `图片：${this.src}`;
      return wrapper;
    }

    const img = document.createElement("img");
    img.src = this.image.url;
    img.alt = this.alt;
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("error", () => {
      wrapper.classList.add("broken");
      img.remove();
      const fallback = document.createElement("span");
      fallback.className = "cm-wysiwyg-image-fallback";
      fallback.textContent = this.alt || `图片无法显示：${this.src}`;
      wrapper.appendChild(fallback);
      view.requestMeasure();
    });

    wrapper.appendChild(img);
    return wrapper;
  }
}

export class TaskWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly checked: boolean,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof TaskWidget &&
      other.from === this.from &&
      other.to === this.to &&
      other.checked === this.checked
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-wysiwyg-task";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为完成");

    input.addEventListener("mousedown", (event) => event.stopPropagation());
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      const { doc } = view.state;
      if (this.from >= doc.length || this.to > doc.length) return;
      const marker = doc.sliceString(this.from, this.to);
      if (!/^\[[ xX]\]$/.test(marker)) return;
      const next = input.checked ? "[x]" : "[ ]";
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: next },
        userEvent: "input.format",
      });
      view.focus();
    });

    return input;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class BulletWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof BulletWidget;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-wysiwyg-bullet";
    span.textContent = "•";
    return span;
  }
}

export class RuleWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof RuleWidget;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-wysiwyg-hr";
    wrapper.appendChild(document.createElement("hr"));
    return wrapper;
  }
}

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof MathWidget &&
      other.tex === this.tex &&
      other.display === this.display
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.display ? "div" : "span");
    element.className = this.display
      ? "cm-wysiwyg-math cm-wysiwyg-math-block"
      : "cm-wysiwyg-math cm-wysiwyg-math-inline";

    try {
      element.innerHTML = katex.renderToString(this.tex, {
        displayMode: this.display,
        throwOnError: false,
        strict: "ignore",
      });
    } catch {
      element.textContent = this.display ? `$$${this.tex}$$` : `$${this.tex}$`;
    }

    return element;
  }

  get estimatedHeight(): number {
    return this.display ? 56 : 20;
  }
}

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: TableModel,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof TableWidget && other.source === this.source;
  }

  toDOM(): HTMLElement {
    return buildTableDom(this.model);
  }

  get estimatedHeight(): number {
    return 18 + (this.model.rows.length + 1) * 31;
  }
}
