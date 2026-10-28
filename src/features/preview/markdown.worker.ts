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

scope.onmessage = async (event) => {
  const { id, markdown } = event.data;

  try {
    const file = await processor.process(markdown);
    scope.postMessage({ id, html: String(file) });
  } catch (error) {
    scope.postMessage({
      id,
      html: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
