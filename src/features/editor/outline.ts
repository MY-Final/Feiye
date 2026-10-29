import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

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

/** 从 Lezer 语法树读取标题，代码围栏里的内容不会误入大纲。 */
export function readOutline(state: EditorState): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      const match = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match) return;

      const level = Number(match[2]);
      const raw = state.doc.sliceString(node.from, node.to);
      const text =
        match[1] === "Setext"
          ? raw.split(/\r?\n/, 1)[0]
          : raw
              .replace(/^\s*#{1,6}[ \t]*/, "")
              .replace(/[ \t]+#+[ \t]*$/, "");

      const line = state.doc.lineAt(node.from);
      headings.push({
        id: `heading-${node.from}`,
        level,
        text: plainText(text),
        from: node.from,
        line: line.number,
      });
    },
  });

  return headings.sort((a, b) => a.from - b.from);
}
