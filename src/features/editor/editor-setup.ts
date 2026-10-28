import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

export interface EditorHandlers {
  onSave(): void;
  onChange(): void;
  onCursor(line: number, column: number): void;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    fontSize: "15px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-editor)",
    lineHeight: "1.75",
    overflow: "auto",
  },
  ".cm-content": {
    maxWidth: "780px",
    margin: "0 auto",
    padding: "32px 28px 45vh",
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
    paddingLeft: "8px",
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

export function createEditorState(
  doc: string,
  handlers: EditorHandlers,
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) handlers.onChange();
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          handlers.onCursor(line.number, head - line.from + 1);
        }
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
    ],
  });
}
