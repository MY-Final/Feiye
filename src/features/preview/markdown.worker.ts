import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import rehypeStringify from "rehype-stringify";
import { createBundledHighlighter } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { bundledLanguages } from "shiki/langs";
import { bundledThemes } from "shiki/themes";
// 走独立资源而不是 `shiki/wasm`：后者把 456KB 的 wasm 编成 base64 塞进 JS，
// 产物会多出 150KB 和一段需要解码的大字符串。
import wasmUrl from "shiki/onig.wasm?url";

import type { PreviewRequest, PreviewResponse } from "./preview-protocol";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null;
  postMessage(message: PreviewResponse): void;
};

/**
 * 先净化用户内容，再交给 KaTeX / Shiki 生成可信节点。
 * 因此这里只放行 Markdown 管线自身需要的 class，不允许内联 style，
 * 也不允许 script / iframe / object / embed / form 等标签。
 */
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", "math", "math-inline", "math-display"],
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "math", "math-display"],
    ],
    // 图片的尺寸 / 对齐由 Markdown 里的 {width=… align=…} 决定。
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "width",
      ["className", "md-align-left", "md-align-center", "md-align-right"],
    ],
  },
};

/**
 * 语法不预先全量加载：代码块第一次出现某种语言时，Shiki 才按名字
 * 去拉对应的语法分块（构建时每种语言单独成为一个 chunk）。
 * Worker 里只保留 26KB 左右的语言索引，三百多种语法都不进首包。
 */
const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: {
    "github-light": bundledThemes["github-light"],
    "github-dark": bundledThemes["github-dark"],
  },
  engine: () => createOnigurumaEngine(fetch(wasmUrl)),
});

function buildProcessor(
  highlighter: Awaited<ReturnType<typeof createHighlighter>>,
) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(rehypeKatex, { strict: "ignore" })
    .use(() =>
      rehypeShikiFromHighlighter(highlighter, {
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: "light",
        fallbackLanguage: "text",
        lazy: true,
      }),
    )
    .use(rehypeStringify);
}

let processorPromise: Promise<ReturnType<typeof buildProcessor>> | null = null;

/**
 * Worker 首次收到预览请求时才装配管线：加载 wasm 与语法要几十毫秒，
 * 不能挡在模块求值阶段，否则连“打开但没预览”的场景也要付这份开销。
 */
function getProcessor(): Promise<ReturnType<typeof buildProcessor>> {
  // 只预载主题；语言交给 rehype 的 lazy 选项按代码块内容加载。
  processorPromise ??= createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: [],
  }).then(buildProcessor);
  return processorPromise;
}

interface MdastNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdastNode[];
  data?: {
    hProperties?: Record<string, string | string[]>;
  };
}

/** 收集 ```mermaid 代码块的源码：Worker 里不能画图，交给主线程渲染。 */
function collectMermaid(node: MdastNode, out: string[]): void {
  if (node.type === "code" && (node.lang ?? "").split(/\s+/)[0].toLowerCase() === "mermaid") {
    out.push(node.value ?? "");
  }
  for (const child of node.children ?? []) collectMermaid(child, out);
}

const IMAGE_ATTRS = /^\s*\{([^{}]*)\}\s*$/;
const WIDTH = /^(?:\d{1,3}%|\d{1,4}px)$/;

/**
 * 解析图片后的属性块：`![alt](src){width=50% align=center}`。
 * 只认宽度与对齐两个键，其它一律忽略，避免把任意 HTML 属性带进页面。
 */
function parseImageAttrs(source: string): Record<string, string | string[]> | null {
  const props: Record<string, string | string[]> = {};
  for (const part of source.trim().split(/\s+/)) {
    const [key, raw] = part.split("=");
    const value = (raw ?? "").trim();
    if (!value) continue;
    if (key === "width" && WIDTH.test(value)) props.width = value;
    if (key === "align" && ["left", "center", "right"].includes(value)) {
      props.className = [`md-align-${value}`];
    }
  }
  return Object.keys(props).length ? props : null;
}

/**
 * 属性块在 mdast 里是图片后面的文本节点；取走后图片通过 hProperties
 * 带上 width / class，交给 rehype 输出成普通属性。
 */
function applyImageAttrs(node: MdastNode): void {
  const children = node.children;
  if (children) {
    for (let index = 0; index < children.length - 1; index += 1) {
      const child = children[index];
      if (child.type !== "image") continue;
      const next = children[index + 1];
      if (next.type !== "text") continue;
      const match = IMAGE_ATTRS.exec(next.value ?? "");
      if (!match) continue;
      const props = parseImageAttrs(match[1]);
      if (!props) continue;
      child.data = { ...child.data, hProperties: props };
      children.splice(index + 1, 1);
    }
  }
  for (const child of node.children ?? []) applyImageAttrs(child);
}

scope.onmessage = async (event) => {
  const { id, markdown } = event.data;

  try {
    const processor = await getProcessor();
    const tree = processor.parse(markdown) as unknown as MdastNode;
    applyImageAttrs(tree);
    const mermaid: string[] = [];
    collectMermaid(tree, mermaid);
    const file = await processor.run(tree as never);
    scope.postMessage({
      id,
      html: String(processor.stringify(file)),
      mermaid: mermaid.length ? mermaid : undefined,
    });
  } catch (error) {
    scope.postMessage({
      id,
      html: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
