import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

import type { ResolvedImage } from "../../lib/images";
import { formatKeymap } from "./format-keymap";
import { readFormatState, type FormatState } from "./formatting";
import {
  handleEditorDragOver,
  handleEditorDrop,
  handleEditorPaste,
} from "./image-insert";
import { createLivePreview } from "./live-preview";
import { mathMarkdownExtension } from "./live-preview/math-extension";

export type EditorMode = "source" | "wysiwyg";

export interface EditorHandlers {
  onSave(): void;
  onChange(): void;
  onStats(): void;
  onOutline(): void;
  onCursor(line: number, column: number): void;
  onFormatState(state: FormatState): void;
}

export interface EditorOptions {
  mode: EditorMode;
  resolveImage(src: string): ResolvedImage | null;
}

export const editorModeCompartment = new Compartment();

// 语法配色只引用 CSS 变量，切换明暗主题时无需重建编辑器。
const editorHighlightStyle = HighlightStyle.define([
  {
    tag: [
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
      t.heading,
    ],
    color: "var(--syn-heading)",
    fontWeight: "600",
  },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--syn-link)" },
  {
    tag: t.monospace,
    color: "var(--syn-string)",
    fontFamily: "var(--font-mono)",
  },
  {
    tag: [t.quote, t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "var(--syn-comment)",
  },
  { tag: [t.list, t.contentSeparator], color: "var(--syn-meta)" },
  {
    tag: [
      t.string,
      t.docString,
      t.character,
      t.attributeValue,
      t.regexp,
      t.escape,
    ],
    color: "var(--syn-string)",
  },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null],
    color: "var(--syn-number)",
  },
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.self,
    ],
    color: "var(--syn-keyword)",
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName],
    color: "var(--syn-type)",
  },
  {
    tag: [t.variableName, t.propertyName, t.attributeName, t.labelName],
    color: "var(--syn-variable)",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--syn-function)",
  },
  { tag: [t.operator, t.derefOperator], color: "var(--syn-operator)" },
  {
    tag: [t.punctuation, t.bracket, t.separator],
    color: "var(--syn-punctuation)",
  },
  {
    tag: [t.meta, t.processingInstruction, t.annotation, t.documentMeta],
    color: "var(--syn-meta)",
  },
  { tag: t.invalid, color: "var(--syn-invalid)" },
]);

// 查找 / 替换面板默认是英文，这里统一成中文；未覆盖的短语回退英文。
const searchPhrases = EditorState.phrases.of({
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  regexp: "正则表达式",
  close: "关闭",
  replace: "替换",
  "replace all": "全部替换",
  "current match": "当前匹配",
  "Go to line": "跳到行",
  go: "跳转",
  line: "行号",
  "on line": "行",
  "replaced $ matches": "已替换 $ 处",
  "replaced match on line $": "已替换第 $ 行的匹配",
});

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    fontSize: "var(--editor-font-size)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-editor)",
    lineHeight: "var(--editor-line-height, 1.75)",
    overflow: "auto",
    // 行号与正文作为一组居中，避免行号被留在窗口最左侧。
    justifyContent: "center",
  },
  ".cm-content": {
    flex: "0 1 var(--editor-measure)",
    maxWidth: "var(--editor-measure)",
    margin: "0",
    padding: "var(--editor-padding)",
    caretColor: "var(--text)",
    userSelect: "text",
    WebkitUserSelect: "text",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  // 空白笔记里给一句起手提示，比一整片空白更让人知道可以开始写。
  ".cm-placeholder": {
    color: "var(--text-faint)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--text-faint)",
    paddingLeft: "10px",
    paddingRight: "10px",
  },
  // 写作时不需要代码折叠标记，避免行号旁出现零散的折角。
  ".cm-foldGutter": {
    display: "none !important",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--editor-active-line)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--editor-selection)",
    },
  ".cm-searchMatch": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-panels": {
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text)",
    borderColor: "var(--line)",
  },
  ".cm-textfield": {
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--line)",
    borderRadius: "4px",
  },
  ".cm-button": {
    backgroundColor: "var(--bg-elevated)",
    backgroundImage: "none",
    color: "var(--text)",
    border: "1px solid var(--line)",
    borderRadius: "4px",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-elevated)",
    border: "1px solid var(--line)",
    color: "var(--text)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
});

export function editorModeExtension(
  mode: EditorMode,
  options: EditorOptions,
): Extension {
  if (mode === "wysiwyg") {
    return createLivePreview({ resolveImage: options.resolveImage });
  }
  return [];
}

export function createEditorState(
  doc: string,
  handlers: EditorHandlers,
  options: EditorOptions,
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      searchPhrases,
      syntaxHighlighting(editorHighlightStyle),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [mathMarkdownExtension],
      }),
      EditorView.lineWrapping,
      placeholder("开始写点什么，# 加空格就是标题"),
      editorTheme,
      // 粘贴 / 拖入图片时保存到文档旁的 assets/ 并插入相对路径。
      EditorView.domEventHandlers({
        paste: (event, view) => handleEditorPaste(event, view),
        drop: (event, view) => handleEditorDrop(event, view),
        dragover: (event) => handleEditorDragOver(event),
      }),
      editorModeCompartment.of(editorModeExtension(options.mode, options)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          handlers.onChange();
          handlers.onStats();
        }
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          handlers.onCursor(line.number, head - line.from + 1);
        }
        // 后台解析推进（滚动长文档时）会产生没有改文档的事务；大纲此时
        // 也要跟着补齐，否则不输入就会一直停留在打开文档时的那一段。
        if (
          !update.docChanged &&
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          handlers.onOutline();
        }
        // 语法树解析完成时还会产生事务；每次都同步一次，保证工具栏
        // 的标题 / 列表等激活态不会停留在解析前的旧值。
        handlers.onFormatState(readFormatState(update.state));
      }),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              handlers.onSave();
              return true;
            },
          },
        ]),
      ),
      Prec.high(keymap.of(formatKeymap)),
    ],
  });
}
