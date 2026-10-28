import { useEffect, useRef } from "react";

import { useDocumentStore } from "../../stores/document";
import { requestPreview } from "../preview/preview-controller";
import {
  getEditorText,
  mountEditor,
  refreshEditorLayout,
  unmountEditor,
} from "./editor-bridge";
import { saveActiveDocument } from "./save";

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewMode = useDocumentStore((state) => state.viewMode);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    mountEditor(host, {
      onSave() {
        void saveActiveDocument();
      },
      onChange() {
        useDocumentStore.getState().markDirty(true);
        const text = getEditorText();
        if (text !== null && useDocumentStore.getState().path) {
          requestPreview(text);
        }
      },
      onCursor(line, column) {
        useDocumentStore.getState().setCursor(line, column);
      },
    });

    return () => unmountEditor();
  }, []);

  // 分栏切换后编辑器容器尺寸变化，需要重新测量。
  useEffect(() => {
    refreshEditorLayout();
  }, [viewMode]);

  return <div className="editor-host" ref={hostRef} />;
}
