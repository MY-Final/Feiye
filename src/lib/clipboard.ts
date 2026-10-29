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
