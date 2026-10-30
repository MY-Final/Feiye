export interface TextStats {
  /** 中文字符逐个计数，西文按词计数。 */
  words: number;
  /** 不含空白与换行的字符数。 */
  chars: number;
}

export const EMPTY_TEXT_STATS: TextStats = { words: 0, chars: 0 };

/** 中日韩统一区、基本区与兼容区：逐个汉字计数。 */
function isCjk(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

/** 与 JavaScript `/\s/` 一致的空白集合。 */
function isWhitespace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function isLatinWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

/** 单词内部的连接符，与 `[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*` 保持一致。 */
function isWordConnector(code: number): boolean {
  return code === 0x27 || code === 0x2019 || code === 0x5f || code === 0x2d;
}

export function countTextStats(text: string): TextStats {
  if (!text) return EMPTY_TEXT_STATS;

  // 单遍扫描：长文档里每 150ms 会调用一次，避免多次全局正则与整篇字符数组。
  let cjk = 0;
  let latin = 0;
  let chars = 0;
  let inWord = false;
  const length = text.length;

  for (let i = 0; i < length; i += 1) {
    const code = text.charCodeAt(i);

    // 中日韩基本区最常见，先走快路径。
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjk += 1;
      chars += 1;
      inWord = false;
      continue;
    }

    if (code < 0x80) {
      if (code === 32 || (code >= 9 && code <= 13)) {
        inWord = false;
        continue;
      }
      chars += 1;
      if (isLatinWordChar(code)) {
        if (!inWord) {
          latin += 1;
          inWord = true;
        }
        continue;
      }
      if (isWordConnector(code) && inWord) {
        const next = i + 1 < length ? text.charCodeAt(i + 1) : -1;
        if (!isLatinWordChar(next)) inWord = false;
        continue;
      }
      inWord = false;
      continue;
    }

    // 其余字符：兼容区汉字、Unicode 空白、弯引号连接符与代理对（emoji 等）。
    let size = 1;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) size = 2;
    }
    if (size === 1 && isWordConnector(code) && inWord) {
      chars += 1;
      if (!isLatinWordChar(i + 1 < length ? text.charCodeAt(i + 1) : -1)) {
        inWord = false;
      }
      continue;
    }
    inWord = false;
    if (size === 1 && isWhitespace(code)) continue;
    // 代理对按一个字符计（如 emoji），不计入字数。
    chars += 1;
    if (size === 1 && isCjk(code)) cjk += 1;
    i += size - 1;
  }

  return { words: cjk + latin, chars };
}
