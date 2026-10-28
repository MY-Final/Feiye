import { resolveMarkdownImageSrc, type ResolvedImage } from "../../lib/images";
import { parentRel } from "../../lib/paths";
import { useDocumentStore } from "../../stores/document";
import { useWorkspaceStore } from "../../stores/workspace";

export function resolveEditorImage(src: string): ResolvedImage | null {
  const root = useWorkspaceStore.getState().root;
  const docPath = useDocumentStore.getState().path ?? "";
  return resolveMarkdownImageSrc(root, parentRel(docPath), src);
}
