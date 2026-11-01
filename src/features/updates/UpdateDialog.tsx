import { useEffect, useRef } from "react";

import { trapTab } from "../../components/Dialog";
import { useUpdateStore } from "../../stores/updates";
import {
  dismissUpdate,
  downloadAndInstallUpdate,
  restartForUpdate,
} from "./update-service";

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

  useEffect(() => {
    if (open) dialogRef.current?.focus();
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

  const primary = ready ? "重启以完成更新" : busy ? "下载中…" : "下载并安装";

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
        {notes ? <p className="modal-message update-notes">{notes}</p> : null}
        {busy || ready ? (
          <div
            className="update-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
          >
            <div
              className="update-progress-bar"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </div>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
        <div className="modal-actions">
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
