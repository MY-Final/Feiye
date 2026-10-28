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
