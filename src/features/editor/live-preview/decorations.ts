import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import type { ResolvedImage } from "../../../lib/images";
import {
  BulletWidget,
  ImageWidget,
  MathWidget,
  RuleWidget,
  TaskWidget,
} from "./widgets";

export interface LivePreviewOptions {
  resolveImage(src: string): ResolvedImage | null;
}

export interface BuiltDecorations {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

const MAX_DOC = 1_000_000;

function directChildren(node: SyntaxNode, name: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) result.push(child);
  }
  return result;
}

export function buildDecorations(
  view: EditorView,
  options: LivePreviewOptions,
): BuiltDecorations {
  const { state } = view;
  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];

  const touches = (from: number, to: number): boolean =>
    state.selection.ranges.some(
      (range) => range.from <= to && range.to >= from,
    );

  const hide = (from: number, to: number): void => {
    if (from >= to) return;
    const range = Decoration.replace({}).range(from, to);
    decorations.push(range);
    atomic.push(range);
  };

  const replaceWith = (
    widget: WidgetType,
    from: number,
    to: number,
    block = false,
  ): void => {
    if (from >= to) return;
    const range = Decoration.replace({ widget, block }).range(from, to);
    decorations.push(range);
    atomic.push(range);
  };

  const lineClass = (pos: number, className: string): void => {
    decorations.push(Decoration.line({ class: className }).range(pos));
  };

  const mark = (from: number, to: number, className: string): void => {
    if (from >= to) return;
    decorations.push(Decoration.mark({ class: className }).range(from, to));
  };

  const hideMarkAndSpace = (node: SyntaxNode, lineEnd: number): void => {
    let to = node.to;
    while (to < lineEnd && /\s/.test(state.doc.sliceString(to, to + 1))) to++;
    hide(node.from, to);
  };

  if (state.doc.length > MAX_DOC) {
    return {
      decorations: Decoration.none,
      atomic: Decoration.none,
    };
  }

  const seen = new Set<string>();

  for (const visible of view.visibleRanges) {
    const tree = ensureSyntaxTree(state, visible.to, 50) ?? syntaxTree(state);

    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(nodeRef) {
        const node = nodeRef.node;
        const name = nodeRef.name;
        const key = `${name}:${node.from}:${node.to}`;
        if (seen.has(key)) return false;
        seen.add(key);

        const headingMatch = /^ATXHeading([1-6])$/.exec(name);
        if (headingMatch) {
          const level = Number(headingMatch[1]);
          const line = state.doc.lineAt(node.from);
          lineClass(line.from, `cm-wysiwyg-h${level}`);
          if (!touches(node.from, node.to)) {
            for (const marker of node.getChildren("HeaderMark")) {
              hideMarkAndSpace(marker, line.to);
            }
          }
          return false;
        }

        if (name === "SetextHeading1" || name === "SetextHeading2") {
          const level = name.endsWith("1") ? 1 : 2;
          const line = state.doc.lineAt(node.from);
          lineClass(line.from, `cm-wysiwyg-h${level}`);
          if (!touches(node.from, node.to)) {
            for (const marker of node.getChildren("HeaderMark")) {
              hide(marker.from, marker.to);
            }
          }
          return false;
        }

        if (
          name === "StrongEmphasis" ||
          name === "Emphasis" ||
          name === "Strikethrough" ||
          name === "InlineCode"
        ) {
          if (touches(node.from, node.to)) return false;

          const markerName =
            name === "StrongEmphasis" || name === "Emphasis"
              ? "EmphasisMark"
              : name === "Strikethrough"
                ? "StrikethroughMark"
                : "CodeMark";
          const markers = directChildren(node, markerName);
          if (markers.length < 2) return false;

          const className =
            name === "StrongEmphasis"
              ? "cm-wysiwyg-strong"
              : name === "Emphasis"
                ? "cm-wysiwyg-em"
                : name === "Strikethrough"
                  ? "cm-wysiwyg-strike"
                  : "cm-wysiwyg-code";
          mark(
            markers[0].to,
            markers[markers.length - 1].from,
            className,
          );
          for (const marker of markers) hide(marker.from, marker.to);
          return name === "InlineCode" ? false : true;
        }

        if (name === "Link") {
          if (touches(node.from, node.to)) return false;
          const url = directChildren(node, "URL")[0];
          if (!url) return true;

          const marks = directChildren(node, "LinkMark");
          for (const child of node.getChildren("LinkMark")) hide(child.from, child.to);
          for (const child of node.getChildren("LinkTitle")) hide(child.from, child.to);
          hide(url.from, url.to);

          if (marks.length >= 2) {
            mark(marks[0].to, marks[1].from, "cm-wysiwyg-link");
          }
          return true;
        }

        if (name === "Image") {
          if (touches(node.from, node.to)) return false;
          const url = directChildren(node, "URL")[0];
          if (!url) return true;

          const marks = directChildren(node, "LinkMark");
          const alt =
            marks.length >= 2
              ? state.doc.sliceString(marks[0].to, marks[1].from)
              : "";
          const src = state.doc.sliceString(url.from, url.to);
          const image = options.resolveImage(src);
          replaceWith(new ImageWidget(src, alt, image), node.from, node.to);
          return false;
        }

        if (name === "Blockquote") {
          const firstLine = state.doc.lineAt(node.from).number;
          const lastLine = state.doc.lineAt(
            Math.max(node.from, node.to - 1),
          ).number;
          for (let number = firstLine; number <= lastLine; number++) {
            lineClass(state.doc.line(number).from, "cm-wysiwyg-quote");
          }
          if (!touches(node.from, node.to)) {
            for (const marker of node.getChildren("QuoteMark")) {
              hideMarkAndSpace(
                marker,
                state.doc.lineAt(marker.from).to,
              );
            }
          }
          return true;
        }

        if (name === "ListItem") {
          const line = state.doc.lineAt(node.from);
          lineClass(line.from, "cm-wysiwyg-li");
          if (touches(node.from, node.to)) return true;

          const listMark = directChildren(node, "ListMark")[0];
          const task = directChildren(node, "Task")[0];
          const parentName = node.parent?.name;

          if (listMark) {
            if (task) {
              hideMarkAndSpace(listMark, line.to);
            } else if (parentName === "BulletList") {
              replaceWith(new BulletWidget(), listMark.from, listMark.to);
            } else if (parentName === "OrderedList") {
              mark(
                listMark.from,
                listMark.to,
                "cm-wysiwyg-ordered-mark",
              );
            }
          }
          return true;
        }

        if (name === "Task") {
          if (touches(node.from, node.to)) return false;
          const marker = directChildren(node, "TaskMarker")[0];
          if (!marker) return false;
          const checked = /^\[[xX]\]$/.test(
            state.doc.sliceString(marker.from, marker.to),
          );
          replaceWith(
            new TaskWidget(marker.from, marker.to, checked),
            marker.from,
            marker.to,
          );
          return false;
        }

        if (name === "FencedCode") {
          // 围栏行由 block-decorations 里的顶部占位与底部语言栏替代；
          // 这里只给中间的代码内容行加样式，卡片底边由语言栏收口。
          const marks = node.getChildren("CodeMark");
          const opening = marks[0];
          if (!opening) return false;

          const closing = marks.length > 1 ? marks[1] : null;
          const firstContent = state.doc.lineAt(opening.from).number + 1;
          // 未闭合围栏一直延伸到文末，末尾的空行也属于代码块；
          // 若只算到 node.to - 1，文末空行会落在卡片与语言栏之间。
          const lastContent = closing
            ? state.doc.lineAt(closing.from).number - 1
            : state.doc.lines;

          for (let number = firstContent; number <= lastContent; number++) {
            const line = state.doc.line(number);
            const classes = ["cm-wysiwyg-code-line"];
            if (number === firstContent) classes.push("cm-wysiwyg-code-first");
            if (number === lastContent) classes.push("cm-wysiwyg-code-last");
            lineClass(line.from, classes.join(" "));
          }
          return false;
        }

        if (name === "HorizontalRule") {
          if (touches(node.from, node.to)) return false;
          replaceWith(new RuleWidget(), node.from, node.to);
          return false;
        }

        // 表格与块级公式由 block-decorations 的 StateField 渲染。
        if (name === "Table" || name === "MathBlock") {
          return false;
        }

        if (name === "MathInline") {
          if (touches(node.from, node.to)) return false;
          const tex = state.doc.sliceString(node.from + 1, node.to - 1);
          replaceWith(new MathWidget(tex, false), node.from, node.to);
          return false;
        }

        if (name === "Autolink") {
          mark(node.from, node.to, "cm-wysiwyg-link");
          return false;
        }

        return undefined;
      },
    });
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
  };
}
