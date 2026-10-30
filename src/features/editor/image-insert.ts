import type { EditorView } from "@codemirror/view";

import { describeError, saveImageAsset } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document";
import { useUiStore } from "../../stores/ui";
import { getEditorView } from "./editor-bridge";

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function baseName(date = new Date()): string {
  return [
    "image",
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join("-");
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_NAME.test(file.name);
}

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files).filter(isImageFile);
  if (files.length > 0) return files;

  return Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma === -1) {
        reject(new Error("无法读取图片数据"));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

interface InsertRange {
  from: number;
  to: number;
}

async function insertImages(
  files: File[],
  range: InsertRange | null,
): Promise<void> {
  const doc = useDocumentStore.getState();
  if (!doc.path) {
    useUiStore.getState().toast("请先打开一篇 Markdown 再插入图片", "error");
    return;
  }

  const path = doc.path;
  const label = files.length > 1 ? `正在插入 ${files.length} 张图片…` : "正在插入图片…";
  useUiStore.getState().toast(label, "info");

  const links: string[] = [];
  for (const file of files) {
    try {
      const data = await blobToBase64(file);
      const asset = await saveImageAsset(path, data, baseName());
      links.push(`![](${asset.markdownPath})`);
    } catch (error) {
      useUiStore
        .getState()
        .toast(`图片插入失败：${describeError(error)}`, "error");
    }
  }

  if (links.length === 0) return;

  const view = getEditorView();
  if (!view || useDocumentStore.getState().path !== path) return;

  const markdown = links.join(" ");
  // 异步保存期间文档可能已经变化；最终按捕获的选区插入，并夹紧到文档长度。
  const length = view.state.doc.length;
  const currentSelection = view.state.selection.main;
  const from = Math.min(range?.from ?? currentSelection.from, length);
  const to = Math.max(
    from,
    Math.min(range?.to ?? currentSelection.to, length),
  );
  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  view.focus();
}

/** 从文件选择器等外部来源插入图片，沿用当前选区。 */
export function insertImageFiles(files: File[]): void {
  const images = files.filter(isImageFile);
  if (images.length === 0) {
    useUiStore
      .getState()
      .toast("只支持 PNG、JPEG、GIF、WebP、AVIF 或 BMP 图片", "error");
    return;
  }

  const view = getEditorView();
  const range = view
    ? {
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      }
    : null;
  void insertImages(images, range);
}

export function handleEditorPaste(
  event: ClipboardEvent,
  view: EditorView,
): boolean {
  const files = imageFiles(event.clipboardData);
  if (files.length === 0) return false;

  event.preventDefault();
  const { from, to } = view.state.selection.main;
  void insertImages(files, { from, to });
  return true;
}

export function handleEditorDrop(
  event: DragEvent,
  view: EditorView,
): boolean {
  const dropped = event.dataTransfer?.files.length ?? 0;
  const files = imageFiles(event.dataTransfer);
  if (dropped === 0) return false;

  // 任何文件拖入都拦下，避免 WebView 打开非图片文件离开应用。
  event.preventDefault();
  if (files.length === 0) {
    useUiStore
      .getState()
      .toast("只支持拖入 PNG、JPEG、GIF、WebP、AVIF 或 BMP 图片", "error");
    return true;
  }

  const position =
    view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
    view.state.selection.main.from;
  void insertImages(files, { from: position, to: position });
  return true;
}

export function handleEditorDragOver(event: DragEvent): boolean {
  if (!event.dataTransfer) return false;
  if (!Array.from(event.dataTransfer.types).includes("Files")) return false;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  return true;
}
