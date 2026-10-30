import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  StateField,
  type EditorState,
  type Range,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

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

/** 光标是否落在表格 / 公式里：这两类块在光标进入时要退回源码。 */
const SOURCE_BLOCK = /^(Table|MathBlock)$/;
const ANY_BLOCK = /^(Table|MathBlock|FencedCode)$/;
/** 行首的围栏 / 公式起始标记；这些字符会让块的边界移动。 */
const BLOCK_START = /^[ \t]*(?:`{3,}|~{3,}|\$\$)/;

const BIASES = [-1, 1] as const;

function enclosingBlock(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  const at = Math.max(0, Math.min(pos, state.doc.length));
  for (const bias of BIASES) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(at, bias);
      node;
      node = node.parent
    ) {
      if (ANY_BLOCK.test(node.name)) return node.name;
    }
  }
  return null;
}

/** 选区命中哪些块（按类型与起点区分），用于判断「进入 / 离开块」是否真的变了。 */
function activeBlocks(state: EditorState): string {
  const keys: string[] = [];
  const tree = syntaxTree(state);
  for (const range of state.selection.ranges) {
    const positions =
      range.from === range.to ? [range.from] : [range.from, range.to];
    for (const pos of positions) {
      for (const bias of BIASES) {
        let node: SyntaxNode | null = tree.resolveInner(pos, bias);
        for (; node; node = node.parent) {
          if (SOURCE_BLOCK.test(node.name)) {
            keys.push(`${node.name}:${node.from}`);
            break;
          }
        }
      }
    }
  }
  return keys.join(",");
}

/**
 * 普通输入只会移动已有块的位置，不需要整篇重建装饰。
 * 只有改动落在表格 / 公式里、碰到围栏或公式起始行、或可能生成表格的
 * `|` 时，才重新遍历语法树。FencedCode 内部改代码不必重建。
 */
function needsBlockRebuild(transaction: Transaction): boolean {
  const start = transaction.startState;
  const next = transaction.state;
  if (start.doc.length > MAX_DOC || next.doc.length > MAX_DOC) {
    return start.doc.length > MAX_DOC && next.doc.length <= MAX_DOC;
  }

  let rebuild = false;
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (rebuild) return;
    const oldLine = start.doc.lineAt(fromA).text;
    const newLine = next.doc.lineAt(fromB).text;
    if (BLOCK_START.test(oldLine) || BLOCK_START.test(newLine)) {
      rebuild = true;
      return;
    }
    const removed = start.doc.sliceString(fromA, toA);
    const inserted = next.doc.sliceString(fromB, toB);
    // 增删换行会移动块的边界（围栏开合、表格 / 公式与段落分合）。
    if (removed.includes("\n") || inserted.includes("\n")) {
      rebuild = true;
      return;
    }
    const before = enclosingBlock(start, fromA);
    const after = enclosingBlock(next, fromB);
    if (
      (before && before !== "FencedCode") ||
      (after && after !== "FencedCode")
    ) {
      rebuild = true;
      return;
    }
    // 普通段落里出现 `|` 可能正在写表格的表头 / 分隔行。
    if (!before && !after && (removed.includes("|") || inserted.includes("|"))) {
      rebuild = true;
    }
  });
  return rebuild;
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
        const codeFrom = Math.min(state.doc.length, openLine.to + 1);
        const codeTo = closing
          ? Math.max(codeFrom, state.doc.lineAt(closing.from).from - 1)
          : state.doc.length;
        const footer = new CodeBlockFooterWidget(
          opening.from,
          languageFrom,
          languageTo,
          language,
          codeFrom,
          codeTo,
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
    if (transaction.docChanged) {
      if (needsBlockRebuild(transaction)) {
        return buildBlockDecorations(transaction.state);
      }
      // 块结构没变：按编辑映射位置，省掉整篇语法树遍历与 widget 重建。
      return value.map(transaction.changes);
    }
    if (transaction.selection !== transaction.startState.selection) {
      if (
        activeBlocks(transaction.startState) === activeBlocks(transaction.state)
      ) {
        return value;
      }
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
