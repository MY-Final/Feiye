import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  StateField,
  type EditorState,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";

import { parseTable } from "./table";
import {
  CodeBlockFooterWidget,
  CodeBlockTopWidget,
  MathWidget,
  TableWidget,
} from "./widgets";

const MAX_DOC = 1_000_000;

function isActive(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

/** 整行范围；`includeBreak` 控制是否把行尾换行一并替换。 */
function lineRange(
  state: EditorState,
  line: { from: number; to: number },
  includeBreak = true,
) {
  return {
    from: line.from,
    to:
      includeBreak && line.to < state.doc.length ? line.to + 1 : line.to,
  };
}

/** 行级 widget 只能由 StateField 提供；表格与公式在光标命中时退回源码。 */
export function buildBlockDecorations(state: EditorState): DecorationSet {
  if (state.doc.length > MAX_DOC) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);

  tree.iterate({
    enter(ref) {
      const node = ref.node;

      if (ref.name === "Table") {
        if (!isActive(state, node.from, node.to)) {
          const source = state.doc.sliceString(node.from, node.to);
          const model = parseTable(source);
          if (model) {
            decorations.push(
              Decoration.replace({
                widget: new TableWidget(source, model),
                block: true,
              }).range(node.from, node.to),
            );
          }
        }
        return false;
      }

      if (ref.name === "MathBlock") {
        if (!isActive(state, node.from, node.to)) {
          const closed =
            state.doc.sliceString(
              Math.max(node.from, node.to - 2),
              node.to,
            ) === "$$";
          const tex = state.doc
            .sliceString(
              node.from + 2,
              closed ? Math.max(node.from + 2, node.to - 2) : node.to,
            )
            .trim();
          decorations.push(
            Decoration.replace({
              widget: new MathWidget(tex, true),
              block: true,
            }).range(node.from, node.to),
          );
        }
        return false;
      }

      if (ref.name === "FencedCode") {
        const marks = node.getChildren("CodeMark");
        const opening = marks[0];
        if (!opening) return false;

        const info = node.getChildren("CodeInfo")[0];
        const language = info
          ? state.doc.sliceString(info.from, info.to).trim()
          : "";
        const openLine = state.doc.lineAt(opening.from);
        // 顶部替换到行尾、但不吃掉换行：否则紧跟其后的第一行代码
        // 的行级装饰会落在 block 边界上，被 CodeMirror 丢弃。
        const openRange = lineRange(state, openLine, false);
        decorations.push(
          Decoration.replace({
            widget: new CodeBlockTopWidget(),
            block: true,
          }).range(openRange.from, openRange.to),
        );

        const languageFrom = info ? info.from : opening.to;
        const languageTo = info ? info.to : opening.to;
        const closing = marks.length > 1 ? marks[1] : null;
        const footer = new CodeBlockFooterWidget(
          opening.from,
          languageFrom,
          languageTo,
          language,
        );

        if (closing) {
          const closeLine = state.doc.lineAt(closing.from);
          const closeRange = lineRange(state, closeLine);
          decorations.push(
            Decoration.replace({
              widget: footer,
              block: true,
            }).range(closeRange.from, closeRange.to),
          );
        } else {
          // 未闭合的围栏延伸到文末：在节点末尾放一个零宽块级 widget，
          // 让语言栏仍然出现在代码下方，而不是等用户先补围栏。
          decorations.push(
            Decoration.widget({
              widget: footer,
              block: true,
              side: 1,
            }).range(node.to),
          );
        }
        return false;
      }

      return undefined;
    },
  });

  return Decoration.set(decorations, true);
}

export const blockWidgets = StateField.define<DecorationSet>({
  create: buildBlockDecorations,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection !== transaction.startState.selection
    ) {
      return buildBlockDecorations(transaction.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const blockWidgetExtensions = [
  blockWidgets,
  EditorView.atomicRanges.of(
    (view) => view.state.field(blockWidgets, false) ?? Decoration.none,
  ),
];
