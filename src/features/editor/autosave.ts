import { useDocumentStore } from "../../stores/document";
import { useSettingsStore } from "../../stores/settings";
import { isEditorComposing } from "./composition";
import { snapshotActiveDocument } from "./recovery";
import { saveActiveDocument } from "./save";

/** 第一次恢复副本的等待上限；更短的恢复间隔直接采用设置值。 */
const RECOVERY_FIRST_DELAY_MS = 900;

function recoveryFirstDelay(recoveryInterval: number): number {
  return Math.min(RECOVERY_FIRST_DELAY_MS, recoveryInterval);
}

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

  const delay = useSettingsStore.getState().preferences.autoSaveDelay;
  // 0 表示关闭自动保存，仅保留恢复副本与手动保存。
  if (delay <= 0) return;

  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null;
    if (isEditorComposing()) {
      // 组词还没结束：过一会再试，等 compositionend 后自然落盘。
      scheduleAutoSave();
      return;
    }
    void flushAutoSave();
  }, delay);
}

function scheduleRecovery(
  delay = recoveryFirstDelay(
    useSettingsStore.getState().preferences.recoveryInterval,
  ),
): void {
  if (recoveryTimer !== null) return;

  recoveryTimer = window.setTimeout(async () => {
    recoveryTimer = null;
    const doc = useDocumentStore.getState();
    if (!doc.path || !doc.dirty) return;
    if (isEditorComposing()) {
      scheduleRecovery();
      return;
    }

    if (!recoveryRunning) {
      recoveryRunning = true;
      try {
        await snapshotActiveDocument();
      } finally {
        recoveryRunning = false;
      }
    }

    if (useDocumentStore.getState().dirty) {
      scheduleRecovery(
        useSettingsStore.getState().preferences.recoveryInterval,
      );
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

/** 自动保存或恢复节奏变化后，按新设置重排尚未触发的计时器。 */
export function resyncAutoSave(): void {
  const hadAutoSave = autoSaveTimer !== null;
  clearAutoSaveTimer();
  if (hadAutoSave) {
    scheduleAutoSave();
  }

  const hadRecovery = recoveryTimer !== null;
  clearRecoveryTimer();
  if (hadRecovery) {
    scheduleRecovery();
  }
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

  useSettingsStore.subscribe((state, previous) => {
    if (
      state.preferences.autoSaveDelay !==
        previous.preferences.autoSaveDelay ||
      state.preferences.recoveryInterval !==
        previous.preferences.recoveryInterval
    ) {
      resyncAutoSave();
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
