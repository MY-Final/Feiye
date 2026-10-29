import { useEffect, useRef } from "react";

import { countTextStats } from "../../lib/text-stats";
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

const STATS_DELAY_MS = 150;

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const statsTimer = useRef<number | null>(null);
  const viewMode = useDocumentStore((state) => state.viewMode);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const mode = useDocumentStore.getState().viewMode;

    // 最多每 150ms 取一次全文统计，连续输入时字数也会持续更新。
    const scheduleStats = () => {
      if (statsTimer.current !== null) return;
      statsTimer.current = window.setTimeout(() => {
        statsTimer.current = null;
        const text = getEditorText();
        if (text !== null) {
          useDocumentStore.getState().setStats(countTextStats(text));
        }
      }, STATS_DELAY_MS);
    };

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
        onStats: scheduleStats,
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

    return () => {
      unmountEditor();
      if (statsTimer.current !== null) {
        window.clearTimeout(statsTimer.current);
        statsTimer.current = null;
      }
    };
  }, []);

  // 视图切换：只重配置编辑器，不重建文档。
  useEffect(() => {
    setEditorMode(viewMode === "wysiwyg" ? "wysiwyg" : "source");
    requestAnimationFrame(() => refreshEditorLayout());
  }, [viewMode]);

  return <div className="editor-host" ref={hostRef} />;
}
