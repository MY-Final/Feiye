export type CssCheckError = {
  line: number;
  column: number;
  message: string;
};

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * 轻量检查 CSS 的括号配平与字符串引号闭合。
 * 注释与字符串内部的括号不参与配对；只报第一处问题，行列从 1 开始。
 * 不做选择器 / 属性语法解析，合法样式返回 null。
 */
export function checkCssBalance(source: string): CssCheckError | null {
  const opens: { char: string; line: number; column: number }[] = [];
  let line = 1;
  let column = 1;
  let comment = false;
  let quote = "";
  let quoteAt = { line: 1, column: 1 };

  const step = (char: string) => {
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1] ?? "";
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        i += 1;
        column += 2;
      } else {
        step(char);
      }
    } else if (quote) {
      if (char === "\\") {
        i += 1;
        step(char);
        step(next);
      } else {
        if (char === quote) quote = "";
        step(char);
      }
    } else if (char === "/" && next === "*") {
      comment = true;
      i += 1;
      column += 2;
    } else if (char === '"' || char === "'") {
      quote = char;
      quoteAt = { line, column };
      step(char);
    } else if (char === ")" || char === "]" || char === "}") {
      const top = opens.pop();
      if (!top) return { line, column, message: `多余的 ${char}` };
      if (CLOSERS[top.char] !== char) {
        return {
          line,
          column,
          message: `应为 ${CLOSERS[top.char]}，却遇到 ${char}`,
        };
      }
      step(char);
    } else {
      if (CLOSERS[char]) opens.push({ char, line, column });
      step(char);
    }
  }

  if (quote) {
    return {
      line: quoteAt.line,
      column: quoteAt.column,
      message: `字符串缺少结束引号 ${quote}`,
    };
  }
  const first = opens[0];
  if (first) {
    return {
      line: first.line,
      column: first.column,
      message: `缺少 ${CLOSERS[first.char]}`,
    };
  }
  return null;
}
