import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";

export interface OutlineHeading {
  id: string;
  level: number;
  text: string;
  from: number;
  line: number;
}

function plainText(raw: string): string {
  const text = raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text || "无标题";
}

/**
 * 清洗后的标题文本按「原始标题行 + 类型」缓存：长文档里每 150ms 重读一次
 * 大纲，绝大多数标题的源码没变，没必要重跑去标记与六道正则。
 */
const headingTextCache = new Map<string, string>();
const HEADING_TEXT_CACHE_LIMIT = 12000;

function cleanHeadingText(raw: string, setext: boolean): string {
  const key = (setext ? "S:" : "A:") + raw;
  const cached = headingTextCache.get(key);
  if (cached !== undefined) return cached;

  const stripped = setext
    ? raw.split(/\r?\n/, 1)[0]
    : raw
        .replace(/^\s*#{1,6}[ \t]*/, "")
        .replace(/[ \t]+#+[ \t]*$/, "");
  const result = plainText(stripped);
  if (headingTextCache.size >= HEADING_TEXT_CACHE_LIMIT) {
    headingTextCache.clear();
  }
  headingTextCache.set(key, result);
  return result;
}

/** 同一份文档内的行号缓存：后台解析推进时会反复读大纲，文档没变时不必重算。 */
let lineCacheDoc: Text | null = null;
const lineCache = new Map<number, number>();
const LINE_CACHE_LIMIT = 20000;

/** 从 Lezer 语法树读取标题，代码围栏里的内容不会误入大纲。 */
export function readOutline(state: EditorState): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const doc = state.doc;
  const tree = syntaxTree(state);

  if (doc !== lineCacheDoc) {
    lineCache.clear();
    lineCacheDoc = doc;
  }

  tree.iterate({
    enter(node) {
      // 先按首字母挡掉大量非标题节点，省去每个节点跑一次正则。
      const first = node.name.charCodeAt(0);
      if (first !== 65 && first !== 83) return;
      const match = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match) return;

      const level = Number(match[2]);
      const raw = doc.sliceString(node.from, node.to);

      let line = lineCache.get(node.from);
      if (line === undefined) {
        line = doc.lineAt(node.from).number;
        if (lineCache.size >= LINE_CACHE_LIMIT) lineCache.clear();
        lineCache.set(node.from, line);
      }
      headings.push({
        id: `heading-${node.from}`,
        level,
        text: cleanHeadingText(raw, match[1] === "Setext"),
        from: node.from,
        line,
      });
    },
  });

  return headings.sort((a, b) => a.from - b.from);
}
