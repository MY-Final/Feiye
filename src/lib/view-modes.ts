import type { ViewMode } from "../stores/document";

export const VIEW_MODES: { value: ViewMode; label: string; title: string }[] = [
  { value: "source", label: "源码", title: "只显示 Markdown 源码" },
  { value: "split", label: "分栏", title: "源码与预览并排" },
  { value: "preview", label: "预览", title: "只显示渲染后的内容" },
  { value: "wysiwyg", label: "所见", title: "所见即所得：在排版里直接写作" },
];

export const VIEW_MODE_VALUES = VIEW_MODES.map((mode) => mode.value);

export function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODE_VALUES.includes(value as ViewMode);
}
