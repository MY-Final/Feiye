export function parentRel(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index === -1 ? "" : relPath.slice(0, index);
}

export function baseName(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index === -1 ? relPath : relPath.slice(index + 1);
}

/** 判断 path 是否位于 dir 之内（含 dir 本身）。 */
export function isWithin(path: string, dir: string): boolean {
  if (!dir) return true;
  return path === dir || path.startsWith(`${dir}/`);
}

/**
 * 把目标文件写成相对 fromFile 所在目录的路径，用于插入 Markdown 链接。
 * 只转义会破坏链接语法的字符，中文保持原样。
 */
export function relativeLinkPath(
  fromFile: string,
  targetRel: string,
): string {
  const fromDir = fromFile.split("/").slice(0, -1);
  const target = targetRel.split("/");

  let common = 0;
  while (
    common < fromDir.length &&
    common < target.length - 1 &&
    fromDir[common] === target[common]
  ) {
    common += 1;
  }

  const parts = [
    ...Array.from({ length: fromDir.length - common }, () => ".."),
    ...target.slice(common),
  ];
  return parts
    .join("/")
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    // `#` / `?` 会被解析成锚点或查询串，文件名里出现时必须转义，
    // 否则「C# 入门.md」这类笔记的链接会指向错误路径。
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
}

/**
 * 把文档里的相对链接解析成工作区相对路径。
 * 绝对地址、协议链接或跳出工作区的 `../` 返回 null。
 */
export function resolveRelLink(href: string, fromFile: string): string | null {
  const raw = href.split("#")[0].split("?")[0];
  if (!raw) return null;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 链接里的百分号不是合法转义时按原文处理。
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
  if (decoded.startsWith("/") || decoded.startsWith("\\")) return null;

  const parts = fromFile
    .split("/")
    .slice(0, -1)
    .concat(decoded.split(/[\\/]/));
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length ? stack.join("/") : null;
}
