import { useEffect, useRef } from "react";

import { useDocumentStore } from "../../stores/document";
import { useEditorStore } from "../../stores/editor";
import { requestPreview } from "../preview/preview-controller";
import { resolveEditorImage } from "./editor-images";
import {
  getEditorText,
  mountEditor,
  refreshEditorLayout,
  setEditorMode,
  unmountEditor,
} from "./editor-bridge";
import { saveActiveDocument } from "./save";

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewMode = useDocumentStore((state) => state.viewMode);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const mode = useDocumentStore.getState().viewMode;

    mountEditor(
      host,
      {
        onSave() {
          void saveActiveDocument();
        },
        onChange() {
          useDocumentStore.getState().markDirty(true);
          if (useDocumentStore.getState().viewMode === "wysiwyg") return;

          const text = getEditorText();
          if (text !== null && useDocumentStore.getState().path) {
            requestPreview(text);
          }
        },
        onCursor(line, column) {
          useDocumentStore.getState().setCursor(line, column);
        },
        onFormatState(state) {
          useEditorStore.getState().setFormat(state);
        },
      },
      {
        mode: mode === "wysiwyg" ? "wysiwyg" : "source",
        resolveImage: resolveEditorImage,
      },
    );

    return () => unmountEditor();
  }, []);

  // 视图切换：只重配置编辑器，不重建文档。
  useEffect(() => {
    setEditorMode(viewMode === "wysiwyg" ? "wysiwyg" : "source");
    requestAnimationFrame(() => refreshEditorLayout());
  }, [viewMode]);

  return <div className="editor-host" ref={hostRef} />;
}
