import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const TYPED_DASHES = /^-+$/;
const RULE_LINE = /^\s*-{3,}\s*$/;

/** 上一行是顶层正文段落时，紧贴它的 `---` 会被解析成 Setext H2 下划线。 */
function paragraphAbove(state: EditorState, lineNumber: number): boolean {
  if (lineNumber < 2) return false;

  const prev = state.doc.line(lineNumber - 1);
  if (!prev.text.trim()) return false;

  const firstText = prev.from + prev.text.search(/\S/);
  let node = syntaxTree(state).resolveInner(firstText, 1);
  while (node && node.name !== "Paragraph") {
    if (node.name === "Document") return false;
    node = node.parent!;
  }
  return node?.parent?.name === "Document";
}

/**
 * 在正文下一行输入 `---` 时，Markdown 会把它当成上一行的标题下划线，
 * 分隔线看起来就“消失”了。这里自动补一个空行，让输入意图落成真正分隔线。
 * 代码块、引用和列表里的 `---` 保持原始语义。
 */
export const keepDashesAsHorizontalRule: Extension = EditorView.inputHandler.of(
  (view, from, to, text) => {
    if (!TYPED_DASHES.test(text)) return false;

    const { state } = view;
    const line = state.doc.lineAt(from);
    if (to > line.to) return false;

    const nextLine =
      line.text.slice(0, from - line.from) +
      text +
      line.text.slice(to - line.from);
    if (!RULE_LINE.test(nextLine) || !paragraphAbove(state, line.number)) {
      return false;
    }

    view.dispatch({
      changes: { from: line.from, to: line.to, insert: `\n${nextLine}` },
      selection: EditorSelection.cursor(
        line.from + 1 + (from - line.from) + text.length,
      ),
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return true;
  },
);
