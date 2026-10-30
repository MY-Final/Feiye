export type ThemeMode = "system" | "light" | "dark";
export type AccentPreset = "indigo" | "umber" | "pine";

/** localStorage 中缓存主题模式，供 index.html 的首屏脚本读取，避免闪白。 */
export const THEME_CACHE_KEY = "feiye.theme";
/** 点缀色同样缓存，首屏脚本先套上，避免打开设置前闪一下默认色。 */
export const ACCENT_CACHE_KEY = "feiye.accent";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function isAccentPreset(value: unknown): value is AccentPreset {
  return value === "indigo" || value === "umber" || value === "pine";
}

/** 点缀色只换强调色，背景与正文仍由亮暗主题决定。 */
export function applyAccent(preset: AccentPreset): void {
  const root = document.documentElement;
  if (preset === "indigo") {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = preset;
  }
  try {
    localStorage.setItem(ACCENT_CACHE_KEY, preset);
  } catch {
    // 缓存失败不影响当前会话。
  }
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


const CUSTOM_CSS_ID = "feiye-custom-css";

/** 用户自定义 CSS 的上限，防止误粘贴超大内容拖慢界面。 */
export const CUSTOM_CSS_LIMIT = 20000;

/**
 * 把用户样式注入页面（编辑器与预览都生效）；内容为空则移除。
 * 样式只存在本机偏好里，不写进工作区。
 */
export function applyCustomCss(css: string): void {
  const current = document.getElementById(CUSTOM_CSS_ID) as
    | HTMLStyleElement
    | null;
  if (!css.trim()) {
    current?.remove();
    return;
  }
  const style = current ?? document.createElement("style");
  if (!current) {
    style.id = CUSTOM_CSS_ID;
    document.head.appendChild(style);
  }
  style.textContent = css.slice(0, CUSTOM_CSS_LIMIT);
}
