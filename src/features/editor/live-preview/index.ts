import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { blockWidgetExtensions } from "./block-decorations";
import {
  buildDecorations,
  type LivePreviewOptions,
} from "./decorations";

import "./live-preview.css";

class LivePreviewState {
  decorations: DecorationSet = Decoration.none;
  atomic: DecorationSet = Decoration.none;

  constructor(
    view: EditorView,
    private readonly options: LivePreviewOptions,
  ) {
    this.rebuild(view);
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged && !update.selectionSet && !update.viewportChanged) {
      return;
    }
    // 中文输入法组合期间不改写 DOM，避免打断候选词。
    if (update.view.composing) return;
    this.rebuild(update.view);
  }

  private rebuild(view: EditorView): void {
    const built = buildDecorations(view, this.options);
    this.decorations = built.decorations;
    this.atomic = built.atomic;
  }
}

export type { LivePreviewOptions };

export function createLivePreview(options: LivePreviewOptions): Extension {
  const plugin = ViewPlugin.define<LivePreviewState>(
    (view) => new LivePreviewState(view, options),
    {
      decorations: (value) => value.decorations,
    },
  );

  return [
    blockWidgetExtensions,
    plugin,
    EditorView.atomicRanges.of(
      (view) => view.plugin(plugin)?.atomic ?? Decoration.none,
    ),
  ];
}
