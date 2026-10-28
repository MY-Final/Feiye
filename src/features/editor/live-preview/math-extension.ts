import type {
  BlockContext,
  InlineContext,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";

const DOLLAR = 36;
const BACKSLASH = 92;
const SPACE = 32;
const TAB = 9;
const NEWLINE = 10;

function isSpace(code: number): boolean {
  return code === SPACE || code === TAB || code === NEWLINE;
}

/**
 * 给 Markdown 语法树补上 `$…$` 与 `$$…$$` 节点。
 * 只负责结构识别，渲染交给 live preview 的装饰/widget。
 */
export const mathMarkdownExtension: MarkdownConfig = {
  defineNodes: [
    "MathInline",
    { name: "MathBlock", block: true },
    "MathMark",
  ],

  parseBlock: [
    {
      name: "FeiyeMathBlock",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line): boolean {
        if (line.next !== DOLLAR) return false;
        const rest = line.text.slice(line.pos);
        // 只把独占一行的 $$ 当作块级公式，避免误伤正文里的 $$x$$。
        if (!/^\$\$\s*$/.test(rest)) return false;

        const from = cx.lineStart + line.pos;
        const marks = [cx.elt("MathMark", from, from + 2)];
        let end = from + 2;

        while (cx.nextLine()) {
          const closeAt = cx.lineStart + line.pos;
          if (
            line.next === DOLLAR &&
            line.indent - line.baseIndent < 4 &&
            /^\$\$\s*$/.test(line.text.slice(line.pos))
          ) {
            marks.push(cx.elt("MathMark", closeAt, closeAt + 2));
            end = cx.lineStart + line.text.length;
            cx.nextLine();
            break;
          }
          end = cx.lineStart + line.text.length;
        }

        cx.addElement(cx.elt("MathBlock", from, end, marks));
        return true;
      },
    },
  ],

  parseInline: [
    {
      name: "FeiyeMathInline",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== DOLLAR) return -1;
        if (cx.char(pos - 1) === BACKSLASH) return -1;
        if (cx.char(pos + 1) === DOLLAR) return -1;
        if (isSpace(cx.char(pos + 1))) return -1;

        for (let at = pos + 1; at < cx.end; at++) {
          const code = cx.char(at);
          if (code === NEWLINE) return -1;
          if (code === BACKSLASH) {
            at++;
            continue;
          }
          if (code !== DOLLAR) continue;
          if (isSpace(cx.char(at - 1))) continue;

          return cx.addElement(
            cx.elt("MathInline", pos, at + 1, [
              cx.elt("MathMark", pos, pos + 1),
              cx.elt("MathMark", at, at + 1),
            ]),
          );
        }

        return -1;
      },
    },
  ],
};
