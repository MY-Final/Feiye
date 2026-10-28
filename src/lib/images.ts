import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

import { parentRel } from "./paths";

export interface ResolvedImage {
  kind: "local" | "external";
  url: string;
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** 把工作区相对路径规范化；越出工作区时返回 null。 */
export function normalizeImagePath(raw: string): string | null {
  let path = raw.split("#")[0].split("?")[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // 保留原样，交给后续校验。
  }

  path = path.replace(/\\/g, "/");
  if (path.startsWith("//")) return null;

  const segments = path.split("/");
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (result.length === 0) return null;
      result.pop();
      continue;
    }
    result.push(segment);
  }

  return result.length > 0 ? result.join("/") : null;
}

function localUrl(root: string, relPath: string): string {
  const base = root.replace(/[\\/]+$/, "");
  const absolute = `${base}/${relPath}`;
  if (!isTauri()) return absolute;
  return convertFileSrc(absolute, "feiyeimg");
}

/**
 * 解析 Markdown 图片地址：
 * - http(s) 原样保留；
 * - 相对路径以文档所在目录为基准，`/` 开头以工作区根为基准；
 * - 其他协议（data/file/javascript）与越界路径返回 null。
 */
export function resolveMarkdownImageSrc(
  root: string | null,
  dirRel: string,
  src: string,
): ResolvedImage | null {
  const value = src.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    return { kind: "external", url: value };
  }
  if (SCHEME.test(value) || value.startsWith("//")) return null;

  const relative = value.startsWith("/")
    ? normalizeImagePath(value.slice(1))
    : normalizeImagePath(dirRel ? `${dirRel}/${value}` : value);

  if (!relative) return null;
  if (!root) return null;

  return { kind: "local", url: localUrl(root, relative) };
}

/** 把预览 HTML 中的相对图片改成受工作区限制的协议地址。 */
export function rewritePreviewImages(
  html: string,
  root: string | null,
  docRel: string,
): string {
  if (!root) return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  const dirRel = parentRel(docRel);

  template.content.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) return;

    const resolved = resolveMarkdownImageSrc(root, dirRel, src);
    if (!resolved) {
      img.removeAttribute("src");
      img.classList.add("preview-image-broken");
      img.setAttribute("alt", img.getAttribute("alt") || "图片无法显示");
      return;
    }

    img.setAttribute("src", resolved.url);
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
  });

  return template.innerHTML;
}
