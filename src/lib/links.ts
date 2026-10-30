/**
 * 带协议的链接（`http:`、`mailto:`、`file:` 等）交给系统处理；
 * 没有协议的按相对路径解析。别只认 http，邮件链接在笔记里同样常见。
 */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}
