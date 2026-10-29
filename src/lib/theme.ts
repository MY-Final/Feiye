export type ThemeMode = "system" | "light" | "dark";

/** localStorage 中缓存主题模式，供 index.html 的首屏脚本读取，避免闪白。 */
export const THEME_CACHE_KEY = "feiye.theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** 把主题解析为具体亮暗，并同步到 <html> 与原生控件配色。 */
export function applyTheme(mode: ThemeMode): "light" | "dark" {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  try {
    localStorage.setItem(THEME_CACHE_KEY, mode);
  } catch {
    // 缓存失败不影响主题本身。
  }

  return resolved;
}

/** 监听系统亮暗变化；调用方自行判断当前是否处于跟随系统模式。 */
export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
