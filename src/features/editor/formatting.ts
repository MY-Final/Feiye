import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { useUiStore } from "../../stores/ui";

export type InlineKind = "bold" | "italic" | "strike" | "code";
export type BlockKind = "quote" | "bullet" | "ordered" | "task";

export interface FormatState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  heading: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  quote: boolean;
  list: "none" | "bullet" | "ordered" | "task";
  codeBlock: boolean;
  math: "none" | "inline" | "block";
  table: boolean;
}

const INLINE_NODES: Record<
  InlineKind,
  { node: string; marker: string; wrap: string }
> = {
  bold: { node: "StrongEmphasis", marker: "EmphasisMark", wrap: "**" },
  italic: { node: "Emphasis", marker: "EmphasisMark", wrap: "*" },
  strike: { node: "Strikethrough", marker: "StrikethroughMark", wrap: "~~" },
  code: { node: "InlineCode", marker: "CodeMark", wrap: "`" },
};

const BLOCK_PATTERNS: Record<BlockKind, RegExp> = {
  quote: /^(\s*)>\s?/,
  bullet: /^(\s*)[-*+]\s+(?!\[[ xX]\])/,
  ordered: /^(\s*)\d+[.)]\s+/,
  task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
};

const ANY_PREFIX =
  /^(?:(\s*)>\s?)?(?:(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+))?/;

function isInside(state: EditorState, pos: number, names: string[]): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (names.includes(node.name)) return true;
  }
  return false;
}

function findAncestor(
  state: EditorState,
  pos: number,
  name: string,
): SyntaxNode | null {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (node.name === name) return node;
  }
  return null;
}

/** 直接子节点中的标记范围，避免误删嵌套强调的标记。 */
function directMarkerRanges(
  node: SyntaxNode,
  markerName: string,
): { from: number; to: number }[] {
  const result: { from: number; to: number }[] = [];
  for (
    let child = node.firstChild;
    child;
    child = child.nextSibling
  ) {
    if (child.name === markerName) {
      result.push({ from: child.from, to: child.to });
    }
  }
  return result;
}

function codeWrap(text: string): string {
  const longest = Math.max(
    0,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(longest + 1);
}

function wrapRange(
  state: EditorState,
  range: SelectionRange,
  kind: InlineKind,
): {
  changes: ChangeSpec;
  range: SelectionRange;
} {
  const info = INLINE_NODES[kind];
  const doc = state.doc;

  // 1. 光标/选区已在对应节点内：去掉这个节点的标记。
  const node = findAncestor(state, range.from, info.node);
  if (node && node.from <= range.from && node.to >= range.to) {
    const markers = directMarkerRanges(node, info.marker);
    if (markers.length > 0) {
      const spec: ChangeSpec = markers.map((marker) => ({
        from: marker.from,
        to: marker.to,
        insert: "",
      }));
      const changes = state.changes(spec);
      return {
        changes: spec,
        range: EditorSelection.range(
          changes.mapPos(range.from, 1),
          changes.mapPos(range.to, -1),
        ),
      };
    }
  }

  // 2. 选区两侧正好是标记（通常出现在刚插入、尚未被语法树识别时）。
  const content = doc.sliceString(range.from, range.to);
  const marker = kind === "code" ? codeWrap(content) : info.wrap;
  if (
    range.from >= marker.length &&
    doc.sliceString(range.from - marker.length, range.from) === marker &&
    doc.sliceString(range.to, range.to + marker.length) === marker
  ) {
    const spec: ChangeSpec = [
      { from: range.from - marker.length, to: range.from, insert: "" },
      { from: range.to, to: range.to + marker.length, insert: "" },
    ];
    const changes = state.changes(spec);
    return {
      changes: spec,
      range: EditorSelection.range(
        changes.mapPos(range.from, 1),
        changes.mapPos(range.to, -1),
      ),
    };
  }

  // 3. 空光标先尝试选中单词。
  const target = range.empty ? (state.wordAt(range.head) ?? range) : range;
  const targetText = doc.sliceString(target.from, target.to);

  if (target.empty) {
    const insert = marker + marker;
    return {
      changes: { from: target.from, insert },
      range: EditorSelection.cursor(target.from + marker.length),
    };
  }

  const insertMarker = kind === "code" ? codeWrap(targetText) : info.wrap;
  const spec: ChangeSpec = [
    { from: target.from, insert: insertMarker },
    { from: target.to, insert: insertMarker },
  ];
  const changes = state.changes(spec);
  return {
    changes: spec,
    range: EditorSelection.range(
      changes.mapPos(target.from, 1),
      changes.mapPos(target.to, -1),
    ),
  };
}

function dispatchFormat(view: EditorView, spec: Parameters<EditorView["dispatch"]>[0]): boolean {
  view.dispatch({
    ...spec,
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
}

export function toggleInline(view: EditorView, kind: InlineKind): boolean {
  const { state } = view;
  const result = state.changeByRange((range) => wrapRange(state, range, kind));
  return dispatchFormat(view, result);
}

function lineNumbersInRange(state: EditorState, range: SelectionRange): number[] {
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const lines: number[] = [];
  for (let number = first; number <= last; number++) lines.push(number);
  return lines;
}

function selectedLines(state: EditorState): number[] {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    for (const number of lineNumbersInRange(state, range)) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b);
}

export function setHeading(
  view: EditorView,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];

  for (const number of selectedLines(state)) {
    const line = state.doc.line(number);
    if (isInside(state, line.from, ["FencedCode", "CodeBlock"])) continue;

    const indent = /^\s*/.exec(line.text)?.[0] ?? "";
    const rest = line.text.slice(indent.length);
    const content = rest.replace(/^#{1,6}(?:\s+|$)/, "");
    const prefix = level === 0 ? "" : `${"#".repeat(level)} `;
    const from = line.from + indent.length;
    const to = from + (rest.length - content.length);
    if (state.doc.sliceString(from, to) !== prefix) {
      changes.push({ from, to, insert: prefix });
    }
  }

  if (!changes.length) return false;
  return dispatchFormat(view, { changes });
}

function stripPrefixes(text: string): { indent: string; body: string } {
  const match = ANY_PREFIX.exec(text);
  if (!match) return { indent: "", body: text };
  const indent = match[1] ?? match[2] ?? "";
  return { indent, body: text.slice(match[0].length) };
}

function prefixFor(kind: BlockKind, index: number): string {
  switch (kind) {
    case "quote":
      return "> ";
    case "bullet":
      return "- ";
    case "ordered":
      return `${index + 1}. `;
    case "task":
      return "- [ ] ";
  }
}

export function toggleBlockPrefix(view: EditorView, kind: BlockKind): boolean {
  const { state } = view;
  const numbers = selectedLines(state);
  const lines = numbers
    .map((number) => state.doc.line(number))
    .filter((line) => line.text.trim().length > 0)
    .filter((line) => !isInside(state, line.from, ["FencedCode", "CodeBlock"]));

  if (!lines.length) return false;

  const pattern = BLOCK_PATTERNS[kind];
  const allMatch = lines.every((line) => pattern.test(line.text));
  const changes: ChangeSpec[] = [];

  lines.forEach((line, index) => {
    const { indent, body } = stripPrefixes(line.text);
    const insert = allMatch ? `${indent}${body}` : `${indent}${prefixFor(kind, index)}${body}`;
    if (insert !== line.text) {
      changes.push({ from: line.from, to: line.to, insert });
    }
  });

  if (!changes.length) return false;
  return dispatchFormat(view, { changes });
}

export function toggleFencedCode(view: EditorView): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const fence = findAncestor(state, head, "FencedCode");

  if (fence) {
    const marks = fenceMarks(fence);
    if (!marks) return false;
    const changes: ChangeSpec[] = [];
    if (marks.closing) {
      const closeLine = state.doc.lineAt(marks.closing.from);
      changes.push({
        from: closeLine.from,
        to: Math.min(state.doc.length, closeLine.to + 1),
        insert: "",
      });
    }
    const openLine = state.doc.lineAt(marks.opening.from);
    changes.push({
      from: openLine.from,
      to: Math.min(state.doc.length, openLine.to + 1),
      insert: "",
    });
    return dispatchFormat(view, { changes });
  }

  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const selected = state.doc.sliceString(startLine.from, endLine.to);

  const changes: ChangeSpec[] = [
    { from: startLine.from, insert: "```\n" },
    { from: endLine.to, insert: "\n```" },
  ];
  const insertAt = startLine.from + 4 + selected.length;

  if (range.empty) {
    const line = state.doc.lineAt(range.from);
    const leading = line.text.trim().length > 0 ? "\n\n" : "";
    const from = leading ? line.to : line.from;
    const insert = `${leading}\`\`\`\n\n\`\`\``;
    return dispatchFormat(view, {
      changes: { from, insert },
      selection: EditorSelection.cursor(from + leading.length + 4),
    });
  }

  return dispatchFormat(view, {
    changes,
    selection: EditorSelection.range(insertAt - selected.length, insertAt),
  });
}

function fenceMarks(
  fence: SyntaxNode,
): { opening: SyntaxNode; closing: SyntaxNode | null } | null {
  const marks = fence.getChildren("CodeMark");
  if (marks.length === 0) return null;
  return { opening: marks[0], closing: marks.length > 1 ? marks[1] : null };
}

/** 把光标移到代码块之后的空段落；没有闭合围栏时先补上。 */
export function exitCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const fence = findAncestor(
    state,
    state.selection.main.head,
    "FencedCode",
  );
  if (!fence) return false;
  const marks = fenceMarks(fence);
  if (!marks) return false;

  if (marks.closing) {
    const closeLine = state.doc.lineAt(marks.closing.from);

    if (closeLine.number < state.doc.lines) {
      const next = state.doc.line(closeLine.number + 1);
      if (next.text.trim() === "") {
        view.dispatch({
          selection: EditorSelection.cursor(next.from),
          scrollIntoView: true,
        });
        view.focus();
        return true;
      }
    }

    const atEnd = closeLine.to === state.doc.length;
    const insert = atEnd ? "\n\n" : "\n";
    view.dispatch({
      changes: { from: closeLine.to, insert },
      selection: EditorSelection.cursor(closeLine.to + insert.length),
      scrollIntoView: true,
      userEvent: "input.format",
    });
    view.focus();
    return true;
  }

  // 没有闭合围栏时，块会一直延伸到文末；在最后一行代码后补围栏，
  // 并去掉块尾多余的空行，避免退出后留下一个很高的空白代码块。
  const openingLine = state.doc.lineAt(marks.opening.from);
  let contentEnd = openingLine.to;
  for (let number = state.doc.lines; number > openingLine.number; number--) {
    const line = state.doc.line(number);
    if (line.text.trim() !== "") {
      contentEnd = line.to;
      break;
    }
  }

  const fenceText = state.doc.sliceString(marks.opening.from, marks.opening.to);
  const insert = `\n${fenceText}\n\n`;
  view.dispatch({
    changes: { from: contentEnd, to: state.doc.length, insert },
    selection: EditorSelection.cursor(contentEnd + insert.length),
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

/**
 * 代码块里按回车：只有光标位于块尾的空行时才退出，
 * 普通代码行仍然插入换行。
 */
export function handleCodeBlockEnter(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;

  const fence = findAncestor(state, selection.head, "FencedCode");
  if (!fence) return false;

  const line = state.doc.lineAt(selection.head);
  if (line.text.trim() !== "") return false;

  const marks = fenceMarks(fence);
  if (!marks) return false;

  if (marks.closing) {
    const closeLine = state.doc.lineAt(marks.closing.from);
    // 最后一行代码之后的空行，或闭合围栏所在行（已被隐藏）。
    if (line.number < closeLine.number - 1) return false;
    return exitCodeBlock(view);
  }

  // 未闭合的围栏只在文档最后一行收尾，避免中断代码中间的换行。
  if (line.number !== state.doc.lines) return false;
  return exitCodeBlock(view);
}

/** 把焦点移到当前代码块底部的语言输入框，并选中已有语言。 */
export function focusCodeLanguage(view: EditorView): boolean {
  const { state } = view;
  const fence = findAncestor(state, state.selection.main.head, "FencedCode");
  if (!fence) return false;

  const inputs =
    view.dom.querySelectorAll<HTMLInputElement>(
      ".cm-wysiwyg-code-lang-input",
    );
  for (const input of inputs) {
    const from = Number(input.dataset.fenceFrom);
    if (Number.isFinite(from) && from >= fence.from && from <= fence.to) {
      input.focus();
      input.select();
      return true;
    }
  }
  return false;
}

export function insertMath(view: EditorView, display: boolean): boolean {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.doc.sliceString(range.from, range.to);

  if (display) {
    const text = selected ? `$$\n${selected}\n$$` : "$$\n\n$$";
    const changes: ChangeSpec = [{ from: range.from, to: range.to, insert: text }];
    return dispatchFormat(view, {
      changes,
      selection: selected
        ? EditorSelection.range(
            range.from + 3,
            range.from + 3 + selected.length,
          )
        : EditorSelection.cursor(range.from + 3),
    });
  }

  if (selected) {
    return dispatchFormat(view, {
      changes: { from: range.from, to: range.to, insert: `$${selected}$` },
      selection: EditorSelection.range(range.from + 1, range.to + 1),
    });
  }

  return dispatchFormat(view, {
    changes: { from: range.from, insert: "$$" },
    selection: EditorSelection.cursor(range.from + 1),
  });
}

const TABLE_TEMPLATE = [
  "| 列 1 | 列 2 | 列 3 |",
  "| --- | --- | --- |",
  "|  |  |  |",
].join("\n");

export function insertTable(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const needsLeading = line.text.trim().length > 0;
  const insert = `${needsLeading ? "\n\n" : ""}${TABLE_TEMPLATE}\n\n`;
  const from = needsLeading ? line.to : line.from;

  return dispatchFormat(view, {
    changes: { from, insert },
    selection: EditorSelection.cursor(from + insert.indexOf("列 1") + 1),
  });
}

export function insertHorizontalRule(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const atLineStart = range.from === line.from && line.text.trim() === "";
  const insert = atLineStart ? "---" : "\n\n---\n\n";
  const from = atLineStart ? line.from : line.to;

  return dispatchFormat(view, {
    changes: { from, insert },
    selection: EditorSelection.cursor(from + insert.length),
  });
}

export async function insertLink(view: EditorView): Promise<boolean> {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.doc.sliceString(range.from, range.to);

  const url = await useUiStore.getState().askInput({
    title: selected ? "插入链接" : "插入链接",
    label: "链接地址",
    initialValue: "https://",
    confirmLabel: "插入",
    validate: (value) => (value.trim() ? null : "链接地址不能为空"),
  });

  if (!url) {
    view.focus();
    return false;
  }

  const trimmed = url.trim();
  if (!view.dom.isConnected) return false;

  if (selected) {
    const result = dispatchFormat(view, {
      changes: {
        from: range.from,
        to: range.to,
        insert: `[${selected}](${trimmed})`,
      },
      selection: EditorSelection.range(
        range.from + 1,
        range.from + 1 + selected.length,
      ),
    });
    view.focus();
    return result;
  }

  const label = "链接文字";
  const text = `[${label}](${trimmed})`;
  const result = dispatchFormat(view, {
    changes: { from: range.from, insert: text },
    selection: EditorSelection.range(
      range.from + 1,
      range.from + 1 + label.length,
    ),
  });
  view.focus();
  return result;
}

function ancestorUntil(
  state: EditorState,
  pos: number,
  stopAt: string[],
): string[] {
  const names: string[] = [];
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    names.push(node.name);
    if (stopAt.includes(node.name)) break;
  }
  return names;
}

export function readFormatState(state: EditorState): FormatState {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);

  // 光标停在行首时，resolveInner 可能落在块之前；补看行首后的第一个位置。
  const names = new Set(ancestorUntil(state, head, ["Document"]));
  if (head === line.from && head < line.to) {
    for (const name of ancestorUntil(state, head + 1, ["Document"])) {
      names.add(name);
    }
  }
  const has = (name: string) => names.has(name);
  const codeBlock = has("FencedCode") || has("CodeBlock");
  const text = line.text;

  const headingName = [...names].find((name) => /^ATXHeading[1-6]$/.test(name));
  const setext = [...names].find((name) => /^SetextHeading[12]$/.test(name));
  const heading = headingName
    ? (Number(headingName.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6)
    : setext
      ? (Number(setext.slice(-1)) as 1 | 2)
      : 0;

  // 任务列表的 Task 节点从 `[ ]` 开始，行首光标看不到它；按行首特征补齐。
  const task =
    !codeBlock && /^\s*[-*+]\s+\[[ xX]\](?:\s|$)/.test(text);
  const ordered = !codeBlock && /^\s*\d+[.)]\s+/.test(text);
  const bullet = !codeBlock && /^\s*[-*+]\s+/.test(text);

  const list = codeBlock
    ? "none"
    : task
      ? "task"
      : ordered
        ? "ordered"
        : bullet
          ? "bullet"
          : has("BulletList")
            ? "bullet"
            : has("OrderedList")
              ? "ordered"
              : "none";

  const math = has("MathBlock")
    ? "block"
    : has("MathInline")
      ? "inline"
      : "none";

  return {
    bold: has("StrongEmphasis"),
    italic: has("Emphasis"),
    strike: has("Strikethrough"),
    code: has("InlineCode"),
    link: has("Link") || has("Autolink"),
    heading,
    quote: has("Blockquote") || (!codeBlock && /^\s{0,3}>/.test(text)),
    list,
    codeBlock,
    math,
    table: has("Table"),
  };
}

/** 按字段比较，避免工具栏在每次按键时无谓重渲染。 */
export function sameFormatState(a: FormatState, b: FormatState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.code === b.code &&
    a.link === b.link &&
    a.heading === b.heading &&
    a.quote === b.quote &&
    a.list === b.list &&
    a.codeBlock === b.codeBlock &&
    a.math === b.math &&
    a.table === b.table
  );
}
