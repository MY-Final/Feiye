import { create } from "zustand";

import { applyTheme, isThemeMode, watchSystemTheme } from "../lib/theme";
import { getSetting, setSetting } from "../lib/tauri";
import { isViewMode } from "../lib/view-modes";
import type { ViewMode } from "./document";

export type DefaultView = "last" | ViewMode;
export type FontFamily = "system" | "serif" | "kai";

/** 正文字体栈；标题始终使用衬线，保持界面气质。 */
export const FONT_FAMILY_STACKS: Record<FontFamily, string> = {
  system: "var(--font-ui)",
  serif:
    '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", SimSun, Georgia, "Times New Roman", serif',
  kai: '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif',
};

export interface Preferences {
  theme: "system" | "light" | "dark";
  fontFamily: FontFamily;
  fontSize: number;
  lineHeight: number;
  editorWidth: number;
  autoSaveDelay: number;
  recoveryInterval: number;
  lineNumbers: boolean;
  defaultView: DefaultView;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  fontFamily: "system",
  fontSize: 16,
  lineHeight: 1.8,
  editorWidth: 900,
  autoSaveDelay: 1800,
  recoveryInterval: 4000,
  lineNumbers: true,
  defaultView: "last",
};

export const PREFERENCE_LIMITS = {
  fontSize: { min: 13, max: 20, step: 1 },
  lineHeight: { min: 1.4, max: 2.2, step: 0.05 },
  editorWidth: { min: 600, max: 1200, step: 20 },
  autoSaveDelay: { min: 0, max: 10000 },
  recoveryInterval: { min: 1000, max: 30000 },
} as const;

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  step = 1,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const stepped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

function isDefaultView(value: unknown): value is DefaultView {
  return value === "last" || isViewMode(value);
}

function isFontFamily(value: unknown): value is FontFamily {
  return value === "system" || value === "serif" || value === "kai";
}

/** 把外部读到的任意值收敛为合法偏好，用于加载与写入前校验。 */
export function normalizePreferences(value: unknown): Preferences {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    theme: isThemeMode(source.theme)
      ? source.theme
      : DEFAULT_PREFERENCES.theme,
    fontFamily: isFontFamily(source.fontFamily)
      ? source.fontFamily
      : DEFAULT_PREFERENCES.fontFamily,
    fontSize: clampNumber(
      source.fontSize,
      PREFERENCE_LIMITS.fontSize.min,
      PREFERENCE_LIMITS.fontSize.max,
      DEFAULT_PREFERENCES.fontSize,
      PREFERENCE_LIMITS.fontSize.step,
    ),
    lineHeight: clampNumber(
      source.lineHeight,
      PREFERENCE_LIMITS.lineHeight.min,
      PREFERENCE_LIMITS.lineHeight.max,
      DEFAULT_PREFERENCES.lineHeight,
      PREFERENCE_LIMITS.lineHeight.step,
    ),
    editorWidth: clampNumber(
      source.editorWidth,
      PREFERENCE_LIMITS.editorWidth.min,
      PREFERENCE_LIMITS.editorWidth.max,
      DEFAULT_PREFERENCES.editorWidth,
      PREFERENCE_LIMITS.editorWidth.step,
    ),
    autoSaveDelay: clampNumber(
      source.autoSaveDelay,
      PREFERENCE_LIMITS.autoSaveDelay.min,
      PREFERENCE_LIMITS.autoSaveDelay.max,
      DEFAULT_PREFERENCES.autoSaveDelay,
    ),
    recoveryInterval: clampNumber(
      source.recoveryInterval,
      PREFERENCE_LIMITS.recoveryInterval.min,
      PREFERENCE_LIMITS.recoveryInterval.max,
      DEFAULT_PREFERENCES.recoveryInterval,
    ),
    lineNumbers:
      typeof source.lineNumbers === "boolean"
        ? source.lineNumbers
        : DEFAULT_PREFERENCES.lineNumbers,
    defaultView: isDefaultView(source.defaultView)
      ? source.defaultView
      : DEFAULT_PREFERENCES.defaultView,
  };
}

interface SettingsStore {
  preferences: Preferences;
  loaded: boolean;
  update(patch: Partial<Preferences>): void;
  reset(): void;
}

let persistTimer: number | null = null;
let persistChain: Promise<void> = Promise.resolve();
let pendingPreferences: Preferences | null = null;
let loadPromise: Promise<void> | null = null;

function persistLatest(): Promise<void> {
  const preferences = pendingPreferences;
  if (!preferences) return persistChain;
  pendingPreferences = null;
  persistChain = persistChain
    .then(() => setSetting("preferences", preferences))
    .catch(() => {
      // setSetting 已经吞掉错误；这里只保证链不断。
    });
  return persistChain;
}

function schedulePersist(preferences: Preferences): void {
  pendingPreferences = preferences;
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void persistLatest();
  }, 250);
}

/** 立即写入尚未落盘的偏好，关闭面板或退出应用时调用。 */
export function flushPreferences(): Promise<void> {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  return persistLatest();
}

/** 读取偏好并应用主题；多次调用复用同一个 promise。 */
export function loadPreferences(): Promise<void> {
  loadPromise ??= (async () => {
    const raw = await getSetting<unknown>("preferences");
    const preferences = normalizePreferences(raw);
    useSettingsStore.setState({ preferences, loaded: true });
    applyTheme(preferences.theme);

    watchSystemTheme(() => {
      if (useSettingsStore.getState().preferences.theme === "system") {
        applyTheme("system");
      }
    });
  })();

  return loadPromise;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  loaded: false,

  update(patch) {
    const current = get().preferences;
    const next = normalizePreferences({ ...current, ...patch });
    set({ preferences: next });
    if (next.theme !== current.theme) {
      applyTheme(next.theme);
    }
    schedulePersist(next);
  },

  reset() {
    const next = DEFAULT_PREFERENCES;
    set({ preferences: next });
    applyTheme(next.theme);
    schedulePersist(next);
  },
}));
