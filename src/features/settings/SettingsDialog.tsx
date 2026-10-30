import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { trapTab } from "../../components/Dialog";
import { SlidingSegmented } from "../../components/SlidingSegmented";
import { APP_NAME, APP_NAME_EN, APP_TAGLINE } from "../../lib/app-info";
import { VIEW_MODES } from "../../lib/view-modes";
import {
  flushPreferences,
  PREFERENCE_LIMITS,
  useSettingsStore,
  type DefaultView,
  type FontFamily,
  type Preferences,
} from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import { changeViewMode } from "../workspace/workspace-actions";
import "./settings.css";

type Category = "appearance" | "editing" | "view" | "about";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "appearance", label: "外观排版" },
  { id: "editing", label: "编辑行为" },
  { id: "view", label: "视图与预览" },
  { id: "about", label: "关于" },
];

const THEME_OPTIONS: { value: Preferences["theme"]; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const FONT_FAMILY_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "system", label: "系统默认" },
  { value: "serif", label: "宋体 / 衬线" },
  { value: "kai", label: "楷体" },
];

const AUTO_SAVE_OPTIONS = [
  { value: 0, label: "关闭（手动保存）" },
  { value: 1000, label: "1 秒" },
  { value: 1800, label: "1.8 秒（默认）" },
  { value: 3000, label: "3 秒" },
  { value: 5000, label: "5 秒" },
];

const RECOVERY_OPTIONS = [
  { value: 2000, label: "2 秒" },
  { value: 4000, label: "4 秒（默认）" },
  { value: 8000, label: "8 秒" },
];

const DEFAULT_VIEW_OPTIONS: { value: DefaultView; label: string }[] = [
  { value: "last", label: "上次使用的视图" },
  ...VIEW_MODES.map((mode) => ({ value: mode.value, label: mode.label })),
];

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-label">{label}</span>
        {hint ? <span className="settings-desc">{hint}</span> : null}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function AboutPanel() {
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    let disposed = false;
    void getVersion()
      .then((value) => {
        if (!disposed) setVersion(value);
      })
      .catch(() => {
        // 非 Tauri 环境或权限缺失时保留回退版本号。
      });
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div className="settings-about">
      <div className="settings-about-mark" aria-hidden="true">
        扉
      </div>
      <h3>
        {APP_NAME}
        <span>{APP_NAME_EN}</span>
      </h3>
      <p>{APP_TAGLINE}</p>
      <dl>
        <div>
          <dt>版本</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>技术栈</dt>
          <dd>Tauri 2 · React 19 · CodeMirror 6 · Shiki</dd>
        </div>
        <div>
          <dt>存储</dt>
          <dd>本地 Markdown 文件，无账号与云同步</dd>
        </div>
      </dl>
    </div>
  );
}

export function SettingsDialog() {
  const open = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const preferences = useSettingsStore((state) => state.preferences);
  const update = useSettingsStore((state) => state.update);
  const reset = useSettingsStore((state) => state.reset);

  const [category, setCategory] = useState<Category>("appearance");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setCategory("appearance");
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      // Esc、齿轮或遮罩关闭时也把待写入的偏好落盘。
      void flushPreferences();
    };
  }, [open]);

  if (!open) return null;

  const close = () => {
    void flushPreferences();
    closeSettings();
  };

  // 一次性覆盖所有偏好，先确认，避免在面板底部误点后无从恢复。
  const restoreDefaults = async () => {
    const choice = await useUiStore.getState().ask({
      title: "恢复默认设置",
      message:
        "主题、字体、字号、行高、保存间隔与默认视图都会改回默认值，当前设置会被覆盖。",
      buttons: [
        { label: "恢复默认", value: "reset", tone: "danger" },
        { label: "取消", value: "cancel" },
      ],
    });
    if (choice !== "reset") return;
    reset();
    useUiStore.getState().toast("已恢复默认设置");
  };

  const changeDefaultView = (value: DefaultView) => {
    update({ defaultView: value });
    if (value !== "last") {
      void changeViewMode(value);
    }
  };

  return (
    <div
      className="modal-backdrop settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="偏好设置"
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <header className="settings-header">
          <h2>偏好设置</h2>
          <button
            type="button"
            className="icon-btn"
            title="关闭"
            aria-label="关闭"
            onClick={close}
          >
            ×
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" role="tablist" aria-label="设置分类">
            {CATEGORIES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={category === item.id}
                className={`settings-nav-item${category === item.id ? " active" : ""}`}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="settings-content" role="tabpanel">
            {category === "appearance" ? (
              <section className="settings-section">
                <h3 className="settings-section-title">排版</h3>

                <Row label="主题" hint="界面、编辑器与预览同时切换">
                  <SlidingSegmented
                    options={THEME_OPTIONS}
                    value={preferences.theme}
                    ariaLabel="主题"
                    onChange={(theme) => update({ theme })}
                  />
                </Row>

                <Row
                  label="正文字体"
                  hint="编辑区与预览同步；标题保持衬线"
                >
                  <select
                    className="settings-select"
                    value={preferences.fontFamily}
                    aria-label="正文字体"
                    onChange={(event) =>
                      update({ fontFamily: event.target.value as FontFamily })
                    }
                  >
                    {FONT_FAMILY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row label="正文字号" hint="编辑区与预览同步生效">
                  <div className="settings-range-wrap">
                    <input
                      type="range"
                      className="settings-range"
                      min={PREFERENCE_LIMITS.fontSize.min}
                      max={PREFERENCE_LIMITS.fontSize.max}
                      step={PREFERENCE_LIMITS.fontSize.step}
                      value={preferences.fontSize}
                      aria-label="正文字号"
                      onChange={(event) =>
                        update({ fontSize: Number(event.target.value) })
                      }
                    />
                    <output className="settings-value">
                      {preferences.fontSize} px
                    </output>
                  </div>
                </Row>

                <Row label="行高" hint="段落之间的松紧程度">
                  <div className="settings-range-wrap">
                    <input
                      type="range"
                      className="settings-range"
                      min={PREFERENCE_LIMITS.lineHeight.min}
                      max={PREFERENCE_LIMITS.lineHeight.max}
                      step={PREFERENCE_LIMITS.lineHeight.step}
                      value={preferences.lineHeight}
                      aria-label="行高"
                      onChange={(event) =>
                        update({ lineHeight: Number(event.target.value) })
                      }
                    />
                    <output className="settings-value">
                      {preferences.lineHeight.toFixed(2)}
                    </output>
                  </div>
                </Row>

                <Row label="行宽" hint="正文最大宽度，窄窗口下自动收缩">
                  <div className="settings-range-wrap">
                    <input
                      type="range"
                      className="settings-range"
                      min={PREFERENCE_LIMITS.editorWidth.min}
                      max={PREFERENCE_LIMITS.editorWidth.max}
                      step={PREFERENCE_LIMITS.editorWidth.step}
                      value={preferences.editorWidth}
                      aria-label="行宽"
                      onChange={(event) =>
                        update({ editorWidth: Number(event.target.value) })
                      }
                    />
                    <output className="settings-value">
                      {preferences.editorWidth} px
                    </output>
                  </div>
                </Row>
              </section>
            ) : null}

            {category === "editing" ? (
              <section className="settings-section">
                <h3 className="settings-section-title">保存与恢复</h3>

                <Row
                  label="自动保存"
                  hint="停止输入后等待多久写入源文件；关闭后仍保留崩溃恢复副本"
                >
                  <select
                    className="settings-select"
                    value={preferences.autoSaveDelay}
                    aria-label="自动保存间隔"
                    onChange={(event) =>
                      update({ autoSaveDelay: Number(event.target.value) })
                    }
                  >
                    {AUTO_SAVE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row
                  label="恢复副本"
                  hint="未保存内容写入崩溃恢复副本的间隔"
                >
                  <select
                    className="settings-select"
                    value={preferences.recoveryInterval}
                    aria-label="恢复副本间隔"
                    onChange={(event) =>
                      update({ recoveryInterval: Number(event.target.value) })
                    }
                  >
                    {RECOVERY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Row>
              </section>
            ) : null}

            {category === "view" ? (
              <section className="settings-section">
                <h3 className="settings-section-title">视图</h3>

                <Row label="默认视图" hint="启动时打开的视图">
                  <select
                    className="settings-select"
                    value={preferences.defaultView}
                    aria-label="默认视图"
                    onChange={(event) =>
                      changeDefaultView(event.target.value as DefaultView)
                    }
                  >
                    {DEFAULT_VIEW_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row label="显示行号" hint="仅影响源码与分栏模式">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={preferences.lineNumbers}
                    aria-label="显示行号"
                    className={`settings-switch${preferences.lineNumbers ? " on" : ""}`}
                    onClick={() =>
                      update({ lineNumbers: !preferences.lineNumbers })
                    }
                  >
                    <span aria-hidden="true" />
                  </button>
                </Row>
              </section>
            ) : null}

            {category === "about" ? <AboutPanel /> : null}
          </div>
        </div>

        <footer className="settings-footer">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void restoreDefaults()}
          >
            恢复默认设置
          </button>
          <button type="button" className="btn primary" onClick={close}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
