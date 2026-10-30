function copyViaSelection(text: string): boolean {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.append(area);
    area.focus({ preventScroll: true });
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    active?.focus({ preventScroll: true });
    return copied;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  // WebView2 里 execCommand 不依赖剪贴板权限，优先使用；
  // 失败时再退回异步 Clipboard API。
  if (copyViaSelection(text)) return true;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyRichViaSelection(html: string): boolean {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.innerHTML = html;
  holder.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.append(holder);

  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    window.getSelection()?.removeAllRanges();
    holder.remove();
    active?.focus({ preventScroll: true });
  }
}

/** 把 HTML 同时以富文本与纯文本写进剪贴板，可直接粘贴到邮件或公众号草稿。 */
export async function copyHtml(html: string): Promise<boolean> {
  return copyRichViaSelection(html) || copyText(html);
}
