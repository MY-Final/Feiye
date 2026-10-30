import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import katex from "katex";

import { copyText } from "../../../lib/clipboard";
import type { ResolvedImage } from "../../../lib/images";
import { buildTableDom, type TableModel } from "./table";

let languageListId = 0;

const CODE_LANGUAGES: ReadonlyArray<readonly [value: string, label: string]> = [
  ["", "纯文本"],
  ["bash", "Bash"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["css", "CSS"],
  ["diff", "Diff"],
  ["dockerfile", "Dockerfile"],
  ["go", "Go"],
  ["html", "HTML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["jsx", "JSX"],
  ["kotlin", "Kotlin"],
  ["lua", "Lua"],
  ["markdown", "Markdown"],
  ["php", "PHP"],
  ["python", "Python"],
  ["ruby", "Ruby"],
  ["rust", "Rust"],
  ["shell", "Shell"],
  ["sql", "SQL"],
  ["swift", "Swift"],
  ["toml", "TOML"],
  ["tsx", "TSX"],
  ["typescript", "TypeScript"],
  ["xml", "XML"],
  ["yaml", "YAML"],
];

interface CodeLanguageOption {
  value: string;
  label: string;
  hint: string;
}

const footerCleanup = new WeakMap<HTMLElement, () => void>();

/** 常用语言在前，自定义语言其次，纯文本（清空）放在最后。 */
function codeLanguageOptions(current: string): CodeLanguageOption[] {
  const options: CodeLanguageOption[] = CODE_LANGUAGES.filter(
    ([value]) => value !== "",
  ).map(([value, label]) => ({ value, label, hint: value }));
  if (
    current &&
    !CODE_LANGUAGES.some(([value]) => value === current)
  ) {
    options.push({ value: current, label: current, hint: "自定义" });
  }
  options.push({ value: "", label: "纯文本", hint: "清除" });
  return options;
}

function filterCodeLanguages(
  options: CodeLanguageOption[],
  query: string,
): CodeLanguageOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;

  const scored: { option: CodeLanguageOption; index: number; score: number }[] =
    [];
  options.forEach((option, index) => {
    const value = option.value.toLowerCase();
    const label = option.label.toLowerCase();
    if (!value.includes(needle) && !label.includes(needle)) return;
    const score =
      value === needle || label === needle
        ? 0
        : value.startsWith(needle) || label.startsWith(needle)
          ? 1
          : 2;
    scored.push({ option, index, score });
  });

  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map((entry) => entry.option);
}

/** 顶替开头围栏的零高占位；隐藏围栏，又不让代码首行贴到卡片外。 */
export class CodeBlockTopWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof CodeBlockTopWidget;
  }

  toDOM(): HTMLElement {
    const top = document.createElement("div");
    top.className = "cm-wysiwyg-code-top";
    return top;
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 10;
  }
}

interface CurrentFence {
  fenceFrom: number;
  languageFrom: number;
  languageTo: number;
  language: string;
  codeFrom: number;
  codeTo: number;
}

/**
 * 按 DOM 位置找回当前围栏的真实范围。块装饰在普通输入后只做位置映射，
 * widget 上缓存的坐标可能已经过期，交互时以语法树为准。
 */
function currentFence(view: EditorView, dom: Node): CurrentFence | null {
  let pos: number;
  try {
    pos = view.posAtDOM(dom, 0);
  } catch {
    return null;
  }
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);
  let fence: SyntaxNode | null = null;
  for (const bias of [-1, 1] as const) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(pos, bias);
      node;
      node = node.parent
    ) {
      if (node.name === "FencedCode") {
        fence = node;
        break;
      }
    }
    if (fence) break;
  }
  if (!fence) return null;

  const marks = fence.getChildren("CodeMark");
  const opening = marks[0];
  if (!opening) return null;
  const info = fence.getChildren("CodeInfo")[0];
  const closing = marks.length > 1 ? marks[1] : null;
  const codeFrom = Math.min(doc.length, doc.lineAt(opening.from).to + 1);
  return {
    fenceFrom: fence.from,
    languageFrom: info ? info.from : opening.to,
    languageTo: info ? info.to : opening.to,
    language: info ? doc.sliceString(info.from, info.to).trim() : "",
    codeFrom,
    codeTo: closing
      ? Math.max(codeFrom, doc.lineAt(closing.from).from - 1)
      : doc.length,
  };
}

/**
 * 代码块底部的语言输入框。直接键入语言标识后回车应用；
 * 下方自绘建议列表，可用方向键选择，全程不需要鼠标。
 */
export class CodeBlockFooterWidget extends WidgetType {
  constructor(
    readonly fenceFrom: number,
    readonly from: number,
    readonly to: number,
    readonly language: string,
    readonly codeFrom: number,
    readonly codeTo: number,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CodeBlockFooterWidget &&
      other.fenceFrom === this.fenceFrom &&
      other.from === this.from &&
      other.to === this.to &&
      other.language === this.language &&
      other.codeFrom === this.codeFrom &&
      other.codeTo === this.codeTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const { fenceFrom, from, to, language, codeFrom, codeTo } = this;
    const shell = document.createElement("div");
    shell.className = "cm-wysiwyg-code-footer-shell";

    const footer = document.createElement("div");
    footer.className = "cm-wysiwyg-code-footer";
    footer.dataset.fenceFrom = String(fenceFrom);

    const label = document.createElement("span");
    label.className = "cm-wysiwyg-code-footer-label";
    label.textContent = "语言";

    const menuId = `feiye-code-languages-${++languageListId}`;
    const input = document.createElement("input");
    input.className = "cm-wysiwyg-code-lang-input";
    input.type = "text";
    input.value = language;
    input.placeholder = "输入语言，↓ 选择";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-label", "代码语言");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", menuId);
    input.title =
      "输入语言标识；↓ 选择建议，回车应用（Ctrl+Shift+L 聚焦）";
    input.dataset.fenceFrom = String(fenceFrom);

    const menu = document.createElement("div");
    menu.className = "cm-wysiwyg-code-lang-menu";
    menu.id = menuId;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "代码语言建议");

    let applying = false;
    let suppressBlurApply = false;
    let menuVisible = false;
    let options: CodeLanguageOption[] = [];
    let highlighted = -1;
    let removeWindowListeners: (() => void) | null = null;
    let copyTimer: number | null = null;

    function hideMenu(): void {
      if (!menuVisible) return;
      menuVisible = false;
      removeWindowListeners?.();
      removeWindowListeners = null;
      highlighted = -1;
      menu.remove();
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function positionMenu(): void {
      if (!menuVisible) return;
      const rect = input.getBoundingClientRect();
      const width = Math.max(rect.width, 220);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(
        8,
        Math.min(rect.right - width, window.innerWidth - width - 8),
      )}px`;
      const height = menu.offsetHeight;
      const below = rect.bottom + 4;
      const above = rect.top - height - 4;
      const top =
        below + height <= window.innerHeight - 8 || above < 8
          ? below
          : above;
      menu.style.top = `${Math.max(
        8,
        Math.min(top, window.innerHeight - height - 8),
      )}px`;
    }

    function syncHighlight(): void {
      for (let index = 0; index < menu.children.length; index++) {
        const child = menu.children[index] as HTMLElement;
        const active = index === highlighted;
        child.classList.toggle("is-active", active);
        child.setAttribute("aria-selected", String(active));
      }
      const active = menu.children[highlighted] as HTMLElement | undefined;
      if (active) {
        input.setAttribute("aria-activedescendant", active.id);
        const top = active.offsetTop;
        const bottom = top + active.offsetHeight;
        if (top < menu.scrollTop) {
          menu.scrollTop = top;
        } else if (bottom > menu.scrollTop + menu.clientHeight) {
          menu.scrollTop = bottom - menu.clientHeight;
        }
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function renderMenu(useQuery = true): void {
      options = filterCodeLanguages(
        codeLanguageOptions(language),
        useQuery ? input.value : "",
      );
      if (useQuery) {
        if (highlighted >= options.length) highlighted = options.length - 1;
      } else {
        // 首次打开时展示全部语言，并把当前语言置于高亮位置；
        // 纯文本没有语言，直接从列表顶部开始。
        highlighted = language
          ? options.findIndex((option) => option.value === language)
          : -1;
      }
      menu.replaceChildren();
      input.setAttribute("aria-expanded", "true");

      if (!options.length) {
        const empty = document.createElement("div");
        empty.className = "cm-wysiwyg-code-lang-empty";
        empty.textContent = "回车使用自定义语言";
        menu.append(empty);
        return;
      }

      options.forEach((option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "cm-wysiwyg-code-lang-option";
        item.id = `${menuId}-option-${index}`;
        item.tabIndex = -1;
        item.dataset.value = option.value;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");

        const name = document.createElement("span");
        name.className = "cm-wysiwyg-code-lang-option-label";
        name.textContent = option.label;

        const hint = document.createElement("span");
        hint.className = "cm-wysiwyg-code-lang-option-hint";
        hint.textContent = option.hint;

        item.append(name, hint);
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
        });
        item.addEventListener("click", () => {
          input.value = option.value;
          hideMenu();
          apply(true);
        });
        item.addEventListener("mousemove", () => {
          if (highlighted === index) return;
          highlighted = index;
          syncHighlight();
        });
        menu.append(item);
      });
      syncHighlight();
    }

    function showMenu(useQuery = false): void {
      if (menuVisible) return;
      menuVisible = true;
      highlighted = -1;
      document.body.append(menu);
      menu.style.visibility = "hidden";
      renderMenu(useQuery);
      positionMenu();
      menu.style.visibility = "";
      const reposition = () => positionMenu();
      window.addEventListener("scroll", reposition, true);
      window.addEventListener("resize", reposition);
      removeWindowListeners = () => {
        window.removeEventListener("scroll", reposition, true);
        window.removeEventListener("resize", reposition);
      };
    }

    function moveHighlight(delta: number): void {
      if (!menuVisible) showMenu(true);
      if (!options.length) return;
      if (highlighted < 0) {
        highlighted = delta > 0 ? 0 : options.length - 1;
      } else {
        highlighted =
          (highlighted + delta + options.length) % options.length;
      }
      syncHighlight();
    }

    function apply(refocus: boolean): void {
      if (applying) return;
      hideMenu();
      const next = input.value.trim();
      if (!view.dom.isConnected) return;
      // 装饰经过映射后缓存的坐标可能过期，按当前 DOM 位置取真实范围。
      const current = currentFence(view, shell);
      const languageFrom = current?.languageFrom ?? from;
      const languageTo = current?.languageTo ?? to;
      if (next === (current?.language ?? language)) {
        if (refocus) view.focus();
        return;
      }
      if (
        languageFrom > view.state.doc.length ||
        languageTo > view.state.doc.length
      ) {
        return;
      }
      applying = true;
      view.dispatch({
        changes: { from: languageFrom, to: languageTo, insert: next },
        userEvent: "input.format",
      });
      if (refocus) view.focus();
    }

    input.addEventListener("focus", () => {
      applying = false;
      suppressBlurApply = false;
      // 位置映射后 dataset 可能过期，聚焦时按 DOM 位置刷新一次。
      const current = currentFence(view, shell);
      if (current) {
        input.dataset.fenceFrom = String(current.fenceFrom);
        footer.dataset.fenceFrom = String(current.fenceFrom);
      }
      showMenu();
    });

    input.addEventListener("input", () => {
      highlighted = -1;
      if (!menuVisible) {
        showMenu(true);
        return;
      }
      renderMenu();
      positionMenu();
    });

    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveHighlight(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const picked = highlighted >= 0 ? options[highlighted] : undefined;
        if (picked) input.value = picked.value;
        apply(true);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (menuVisible) {
          hideMenu();
          return;
        }
        input.value = language;
        suppressBlurApply = true;
        view.focus();
        return;
      }
      if (event.key === "Tab") {
        hideMenu();
      }
    });

    // 点击编辑器或 Tab 离开时也保存输入，不要求必须按回车。
    input.addEventListener("blur", () => {
      hideMenu();
      if (suppressBlurApply) {
        suppressBlurApply = false;
        return;
      }
      apply(false);
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "cm-wysiwyg-code-copy";
    copyButton.textContent = "复制";
    copyButton.title = "复制代码";
    copyButton.setAttribute("aria-label", "复制代码");
    copyButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    copyButton.addEventListener("click", () => {
      if (copyTimer !== null) {
        window.clearTimeout(copyTimer);
        copyTimer = null;
      }
      const current = currentFence(view, shell);
      const start = current?.codeFrom ?? codeFrom;
      const end = current?.codeTo ?? codeTo;
      if (start > view.state.doc.length || end > view.state.doc.length) {
        return;
      }
      const raw = view.state.doc.sliceString(start, end);
      const text = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
      void copyText(text).then((copied) => {
        if (!copyButton.isConnected) return;
        copyButton.textContent = copied ? "已复制" : "复制失败";
        copyButton.classList.toggle("is-copied", copied);
        copyButton.setAttribute(
          "aria-label",
          copied ? "已复制代码" : "复制代码失败",
        );
        copyTimer = window.setTimeout(() => {
          copyButton.textContent = "复制";
          copyButton.classList.remove("is-copied");
          copyButton.setAttribute("aria-label", "复制代码");
          copyTimer = null;
        }, 1500);
      });
    });

    const wrap = document.createElement("span");
    wrap.className = "cm-wysiwyg-code-footer-field";
    wrap.append(input);

    footer.append(label, wrap, copyButton);
    shell.append(footer);
    footerCleanup.set(shell, () => {
      hideMenu();
      if (copyTimer !== null) {
        window.clearTimeout(copyTimer);
        copyTimer = null;
      }
    });
    return shell;
  }

  destroy(dom: HTMLElement): void {
    footerCleanup.get(dom)?.();
    footerCleanup.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 42;
  }
}

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

  toDOM(view?: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-wysiwyg-hr";
    wrapper.appendChild(document.createElement("hr"));

    // 分隔线只有 1px，CodeMirror 对它所在块的坐标映射会落到文档开头或
    // 相邻空行。这里在整块可点区域内直接定位到 `---` 起点，进入源码。
    if (view) {
      wrapper.addEventListener("mousedown", (event) => {
        const mouse = event as MouseEvent;
        if (mouse.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ selection: { anchor: view.posAtDOM(wrapper, 0) } });
        view.focus();
      });
    }

    return wrapper;
  }

  // 让点击落在被替换的分隔线上，光标进入后自动显示 `---` 源码。
  ignoreEvent(): boolean {
    return false;
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

  toDOM(view?: EditorView): HTMLElement {
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

    // 块级 widget 的坐标映射以块中线为准：点下半部分会落到替换范围
    // 末尾之外的空行，光标不在公式里，widget 也就不退出。这里让下半部分
    // 直接定位到开头的 `$$` 之后，和点上半部分一致进入源码。
    if (this.display && view) {
      element.addEventListener("mousedown", (event) => {
        const mouse = event as MouseEvent;
        if (mouse.button !== 0) return;
        const rect = element.getBoundingClientRect();
        if (mouse.clientY < rect.top + rect.height / 2) return;
        event.preventDefault();
        event.stopPropagation();
        const from = view.posAtCoords({
          x: rect.left + rect.width / 2,
          y: rect.top + 1,
        });
        view.dispatch({
          selection: {
            anchor: Math.min((from ?? 0) + 2, view.state.doc.length),
          },
        });
        view.focus();
      });
    }

    return element;
  }

  get estimatedHeight(): number {
    return this.display ? 56 : 20;
  }

  // 点击公式块时把光标放进源码，不用先切到源码 / 分栏。
  ignoreEvent(): boolean {
    return false;
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

  // 点击表格时把光标放进源码，不用先切到源码 / 分栏。
  ignoreEvent(): boolean {
    return false;
  }
}
