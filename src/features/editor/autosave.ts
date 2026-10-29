import { useDocumentStore } from "../../stores/document";
import { snapshotActiveDocument } from "./recovery";
import { saveActiveDocument } from "./save";

/** 停止输入后写入源文件的等待时间。 */
const AUTO_SAVE_DELAY_MS = 1800;
/** 第一次恢复副本的等待时间。 */
const RECOVERY_FIRST_DELAY_MS = 900;
/** 持续输入时恢复副本的刷新间隔。 */
const RECOVERY_REPEAT_MS = 4000;

let autoSaveTimer: number | null = null;
let recoveryTimer: number | null = null;
let recoveryRunning = false;
let initialized = false;

function clearAutoSaveTimer(): void {
  if (autoSaveTimer !== null) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function clearRecoveryTimer(): void {
  if (recoveryTimer !== null) {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}

function scheduleAutoSave(): void {
  clearAutoSaveTimer();

  const doc = useDocumentStore.getState();
  if (!doc.path || !doc.dirty || doc.saveBlocked) return;

  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null;
    void flushAutoSave();
  }, AUTO_SAVE_DELAY_MS);
}

function scheduleRecovery(delay = RECOVERY_FIRST_DELAY_MS): void {
  if (recoveryTimer !== null) return;

  recoveryTimer = window.setTimeout(async () => {
    recoveryTimer = null;
    const doc = useDocumentStore.getState();
    if (!doc.path || !doc.dirty) return;

    if (!recoveryRunning) {
      recoveryRunning = true;
      try {
        await snapshotActiveDocument();
      } finally {
        recoveryRunning = false;
      }
    }

    if (useDocumentStore.getState().dirty) {
      scheduleRecovery(RECOVERY_REPEAT_MS);
    }
  }, delay);
}

/**
 * 编辑器内容变化：安排一次源文件自动保存，并持续刷新崩溃恢复副本。
 */
export function noteDocumentChange(): void {
  if (!useDocumentStore.getState().path) return;
  scheduleAutoSave();
  scheduleRecovery();
}

/**
 * 立即写入源文件。返回 true 表示当前编辑器内容已经落盘。
 * 关闭窗口或切换文档前调用。
 */
export async function flushAutoSave(): Promise<boolean> {
  clearAutoSaveTimer();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const doc = useDocumentStore.getState();
    if (!doc.path || !doc.dirty) return true;
    if (doc.saveBlocked) return false;

    const saved = await saveActiveDocument({ auto: true });
    if (!saved) return false;
    if (!useDocumentStore.getState().dirty) return true;
  }

  return !useDocumentStore.getState().dirty;
}

/** 关闭窗口、窗口失焦或应用隐藏时尽快落一份恢复副本。 */
export async function flushRecovery(): Promise<void> {
  clearRecoveryTimer();
  if (recoveryRunning) return;
  recoveryRunning = true;
  try {
    await snapshotActiveDocument();
  } finally {
    recoveryRunning = false;
  }
}

/** 切换文档或工作区时清空计时器。 */
export function resetAutoSave(): void {
  clearAutoSaveTimer();
  clearRecoveryTimer();
}

function init(): void {
  if (initialized) return;
  initialized = true;

  useDocumentStore.subscribe((state, previous) => {
    if (state.path !== previous.path) {
      resetAutoSave();
    }
    // 手动保存成功后解除“自动保存暂停”，后续输入会正常自动保存。
    if (previous.dirty && !state.dirty) {
      clearAutoSaveTimer();
    }
  });

  window.addEventListener("blur", () => {
    void flushRecovery();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushRecovery();
    }
  });
}

init();
