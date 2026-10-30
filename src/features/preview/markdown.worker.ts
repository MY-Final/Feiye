import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import type { BuiltinLanguage } from "shiki";

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

const LANGUAGES: BuiltinLanguage[] = [
  "bash",
  "c",
  "cpp",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "python",
  "rust",
  "shell",
  "sql",
  "toml",
  "tsx",
  "typescript",
  "yaml",
];

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeKatex, { strict: "ignore" })
  .use(rehypeShiki, {
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: "light",
    langs: LANGUAGES,
    fallbackLanguage: "text",
    lazy: true,
  })
  .use(rehypeStringify);

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
