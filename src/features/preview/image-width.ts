/**
 * 预览里拖动图片改宽度：在 Markdown 正文中按图片地址找到唯一一张图片，
 * 更新（或补上）其后的 `{width=NN%}` 属性块。
 * 纯文本处理，不碰 DOM，便于直接测试。
 */

export const IMAGE_WIDTH_MIN = 10;
export const IMAGE_WIDTH_MAX = 100;

export function clampImagePercent(percent: number): number {
  if (!Number.isFinite(percent)) return IMAGE_WIDTH_MAX;
  return Math.min(IMAGE_WIDTH_MAX, Math.max(IMAGE_WIDTH_MIN, Math.round(percent)));
}

interface ParsedImage {
  /** `![alt](src)` 之后的位置。 */
  end: number;
  /** 原始地址（去掉了尖括号，保留查询串与括号）。 */
  dest: string;
}

/**
 * 从 `![` 起解析一张行内图片；目的地按括号配对读取，
 * 因此 `(图片 (1).png)`、带查询串的地址都能完整取到。
 * 支持 `![alt](src "title")` 与 `![alt](<src with space>)`。
 */
function parseImageAt(text: string, start: number): ParsedImage | null {
  let index = start + 2;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === "]") break;
    index += 1;
  }
  if (text[index] !== "]") return null;
  index += 1;
  if (text[index] !== "(") return null;
  index += 1;
  while (index < text.length && /\s/.test(text[index])) index += 1;

  let dest: string;
  if (text[index] === "<") {
    index += 1;
    const begin = index;
    while (index < text.length && text[index] !== ">") {
      if (text[index] === "\\") index += 1;
      index += 1;
    }
    if (text[index] !== ">") return null;
    dest = text.slice(begin, index);
    index += 1;
  } else {
    const begin = index;
    let depth = 0;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (/\s/.test(char)) break;
      index += 1;
    }
    dest = text.slice(begin, index);
  }

  // 跳过可选 title，找到与 `(` 配对的 `)`。
  let depth = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) return { end: index + 1, dest };
      depth -= 1;
    }
    index += 1;
  }
  return null;
}

/** 正文中所有地址匹配的行内图片；引用式图片不计入。 */
function findImageRanges(text: string, src: string): ParsedImage[] {
  const matches: ParsedImage[] = [];
  let index = 0;
  while (index < text.length - 1) {
    const next = text.indexOf("![", index);
    if (next < 0) break;
    const parsed = parseImageAt(text, next);
    if (parsed) {
      if (parsed.dest === src) matches.push(parsed);
      index = parsed.end;
    } else {
      index = next + 2;
    }
  }
  return matches;
}

/**
 * 把唯一一张地址为 `src` 的图片宽度设为 `percent`%。
 * 已有 `{…}` 属性组时只替换 / 追加 `width`，保留 align 等其它属性；
 * 找不到或有多处同地址时返回 null，交给调用方提示用户手动处理。
 */
export function setImageWidth(
  text: string,
  src: string,
  percent: number,
): string | null {
  const target = src.trim();
  if (!target) return null;
  const found = findImageRanges(text, target);
  if (found.length !== 1) return null;

  const image = found[0];
  const width = `${clampImagePercent(percent)}%`;
  const rest = text.slice(image.end);
  const attrs = /^[ \t]*\{([^{}]*)\}/.exec(rest);

  if (!attrs) {
    return `${text.slice(0, image.end)}{width=${width}}${rest}`;
  }

  const group = attrs[0];
  const body = attrs[1];
  const nextBody = /(^|\s)width\s*=\s*\S+/.test(body)
    ? body.replace(
        /(^|\s)width\s*=\s*\S+/,
        (_match, lead: string) => `${lead}width=${width}`,
      )
    : `${body}${body.trim() ? " " : ""}width=${width}`;
  const lead = group.slice(0, group.indexOf("{"));
  return `${text.slice(0, image.end)}${lead}{${nextBody}}${rest.slice(group.length)}`;
}
