import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, type ReactNode } from "react";

import { trapTab } from "../../components/Dialog";
import { useUpdateStore } from "../../stores/updates";
import {
  dismissUpdate,
  downloadAndInstallUpdate,
  restartForUpdate,
  skipUpdateVersion,
} from "./update-service";

const URL_PATTERN = /https?:\/\/[^\s<>()（）\[\]【】「」『』《》，。、；：！？…]+/g;

/**
 * 发布说明里的链接交给系统浏览器打开：在弹窗里直接跳转会离开应用，
 * 而纯文本又让用户只能手动复制。只认 http(s)，其余一律按文字显示。
 */
function NoteText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const trailing = match[0].match(/[.,;:!?]+$/)?.[0] ?? "";
    const url = trailing ? match[0].slice(0, -trailing.length) : match[0];
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(
      <a
        key={start}
        href={url}
        className="update-note-link"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void openUrl(url).catch(() => {});
        }}
      >
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

/**
 * 发现新版本时的提示框。和确认框共用一套遮罩 / 卡片样式，
 * 但内容随下载阶段变化，所以单独成组件。
 */
export function UpdateDialog() {
  const open = useUpdateStore((state) => state.open);
  const phase = useUpdateStore((state) => state.phase);
  const version = useUpdateStore((state) => state.version);
  const notes = useUpdateStore((state) => state.notes);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 下载期间不能关：中断后下一次仍要从头下，不如让这一轮走完。
  const busy = phase === "downloading";
  const ready = phase === "ready";

  // 打开时记住焦点、关闭后还回去：弹层卸载会把焦点丢给 body，
  // 下一次 Tab 得从窗口最开头重走一遍。自动弹出的更新没有触发按钮，
  // 或原控件已被移除时回到正文。
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const previous =
      active instanceof HTMLElement && active !== document.body ? active : null;
    dialogRef.current?.focus();
    return () => {
      if (previous?.isConnected) {
        previous.focus();
        return;
      }
      document.querySelector<HTMLElement>(".cm-content")?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      dismissUpdate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy]);

  if (!open) return null;

  // 下载失败后仍停在 available：把主按钮说清楚是「重试」，
  // 而不是让用户对着和第一次一模一样的「下载并安装」猜。
  const failed = !busy && !ready && error !== null;
  const primary = ready
    ? "重启以完成更新"
    : busy
      ? "下载中…"
      : failed
        ? "重试下载"
        : "下载并安装";

  // 读屏播报按 10% 一档：下载进度每收到一块就更新，
  // 直接给进度条挂 aria-live 会每秒念几次百分比。
  const step =
    progress === null ? null : Math.min(100, Math.floor(progress * 10) * 10);
  const announcement = ready
    ? "更新已下载，可以重启以完成更新。"
    : !busy
      ? ""
      : step !== null && step >= 10
        ? `正在下载更新，已完成 ${step}%。`
        : "正在下载更新…";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) dismissUpdate();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="发现新版本"
        onKeyDown={trapTab}
      >
        <h2 className="modal-title">发现新版本 v{version}</h2>
        {notes ? (
          <p className="modal-message update-notes">
            <NoteText text={notes} />
          </p>
        ) : null}
        {busy || ready ? (
          <div
            className="update-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
            aria-label="更新下载进度"
          >
            <div
              className="update-progress-bar"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </div>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        {error ? (
          // role=alert：失败一到就播报，不必等用户把焦点移过来。
          <p className="field-error" role="alert">
            下载失败：{error}
          </p>
        ) : null}
        <div className="modal-actions">
          {phase === "available" ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void skipUpdateVersion();
              }}
            >
              跳过此版本
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={dismissUpdate}
          >
            稍后
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => {
              void (ready ? restartForUpdate() : downloadAndInstallUpdate());
            }}
          >
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}
