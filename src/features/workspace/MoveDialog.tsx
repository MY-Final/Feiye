import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { trapTab } from "../../components/Dialog";
import { listDir, type Entry } from "../../lib/tauri";
import { isWithin, parentRel } from "../../lib/paths";
import { moveEntry } from "./workspace-actions";

interface MoveDialogProps {
  entry: Entry;
  onClose(): void;
}

interface FolderOption {
  relPath: string;
  label: string;
}

const MAX_FOLDERS = 200;

/** 扫一遍工作区里的文件夹，供「移动到…」选择；读不到的子目录跳过。 */
async function collectFolders(entry: Entry): Promise<FolderOption[]> {
  const currentParent = parentRel(entry.relPath);
  // 已经就在根目录时，「根目录」不是有效目标。
  const options: FolderOption[] =
    currentParent === "" ? [] : [{ relPath: "", label: "根目录（工作区）" }];
  const queue: string[] = [""];

  while (queue.length > 0 && options.length < MAX_FOLDERS) {
    const parent = queue.shift();
    if (parent === undefined) break;

    let children: Entry[] = [];
    try {
      children = await listDir(parent);
    } catch {
      continue;
    }

    for (const child of children) {
      if (!child.isDir) continue;
      // 不能放进自己或自己的子目录里，会和拖拽保持同一套规则。
      if (isWithin(child.relPath, entry.relPath)) continue;
      if (child.relPath === currentParent) continue;
      options.push({
        relPath: child.relPath,
        label: child.relPath,
      });
      queue.push(child.relPath);
      if (options.length >= MAX_FOLDERS) break;
    }
  }

  return options;
}

export function MoveDialog({ entry, onClose }: MoveDialogProps) {
  const [folders, setFolders] = useState<FolderOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // 对话框关闭后把焦点还给打开前那一行，键盘整理文件不中断。
    const previous = document.activeElement;
    restoreRef.current = previous instanceof HTMLElement ? previous : null;
    void collectFolders(entry).then(setFolders);
    return () => {
      const restore = restoreRef.current;
      if (restore?.isConnected) restore.focus();
    };
  }, [entry]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!folders || folders.length === 0) return;
    listRef.current?.querySelector<HTMLButtonElement>(".move-option")?.focus();
  }, [folders]);

  const choose = (target: string) => {
    if (busy) return;
    setBusy(true);
    onClose();
    void moveEntry(entry, target);
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".move-option"),
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = index <= 0 ? buttons.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else next = buttons.length - 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal move-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`移动「${entry.name}」`}
        onKeyDown={trapTab}
      >
        <h2 className="modal-title">移动「{entry.name}」</h2>
        <p className="modal-message">
          选择目标文件夹。↑↓ 选择，回车确认，Esc 取消。
        </p>
        {folders === null ? (
          <p className="move-empty">正在读取文件夹…</p>
        ) : folders.length === 0 ? (
          <p className="move-empty">没有其它可以放进去的文件夹。</p>
        ) : (
          <div
            className="move-list"
            ref={listRef}
            role="group"
            aria-label="目标文件夹"
            onKeyDown={onListKeyDown}
          >
            {folders.map((folder) => (
              <button
                key={folder.relPath || "root"}
                type="button"
                className="move-option"
                disabled={busy}
                onClick={() => choose(folder.relPath)}
              >
                {folder.label}
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
