export interface TextStats {
  /** 中文字符逐个计数，西文按词计数。 */
  words: number;
  /** 不含空白与换行的字符数。 */
  chars: number;
}

const CJK = /[㐀-䶿一-鿿豈-﫿]/g;
const LATIN_WORD = /[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g;

export const EMPTY_TEXT_STATS: TextStats = { words: 0, chars: 0 };

export function countTextStats(text: string): TextStats {
  if (!text) return EMPTY_TEXT_STATS;

  const cjk = text.match(CJK)?.length ?? 0;
  const latin =
    text.replace(CJK, " ").match(LATIN_WORD)?.length ?? 0;

  return {
    words: cjk + latin,
    chars: Array.from(text.replace(/\s/g, "")).length,
  };
}
