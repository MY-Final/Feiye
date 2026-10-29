import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import type { ResolvedImage } from "../../lib/images";
import { formatKeymap } from "./format-keymap";
import { readFormatState, type FormatState } from "./formatting";
import { createLivePreview } from "./live-preview";
import { mathMarkdownExtension } from "./live-preview/math-extension";

export type EditorMode = "source" | "wysiwyg";

export interface EditorHandlers {
  onSave(): void;
  onChange(): void;
  onStats(): void;
  onCursor(line: number, column: number): void;
  onFormatState(state: FormatState): void;
}

export interface EditorOptions {
  mode: EditorMode;
  resolveImage(src: string): ResolvedImage | null;
}

export const editorModeCompartment = new Compartment();

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
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [mathMarkdownExtension],
      }),
      EditorView.lineWrapping,
      editorTheme,
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
