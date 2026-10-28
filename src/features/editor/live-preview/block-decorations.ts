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
import { MathWidget, TableWidget } from "./widgets";

const MAX_DOC = 1_000_000;

function isActive(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

/** 行级 widget 只能由 StateField 提供；光标命中时退回源码。 */
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
