let composing = false;
const waiters = new Set<() => void>();

/**
 * 输入法组词状态。组词期间文档里是未上屏的拼音，统计、预览、自动保存
 * 与手动保存都应推迟到 compositionend 之后再处理。
 */
export function setEditorComposing(value: boolean): void {
  composing = value;
  if (!value) {
    for (const resolve of waiters) resolve();
    waiters.clear();
  }
}

export function isEditorComposing(): boolean {
  return composing;
}

/**
 * 组词期间等待提交完成；未组词时立即返回 true。
 * 手动保存（Ctrl+S、关标签、关窗口）若在组词中触发，先等 compositionend，
 * 避免把半截拼音写进源文件。超时返回 false：此时组词仍未结束，调用方
 * 应放弃本次落盘而不是写入拼音。
 */
export function waitForCompositionEnd(timeoutMs = 2000): Promise<boolean> {
  if (!composing) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ended: boolean) => {
      window.clearTimeout(timer);
      waiters.delete(done);
      // 最终提交事务可能在 compositionend 之后才发出，让出一拍再读正文。
      window.setTimeout(() => resolve(ended), 0);
    };
    const done = () => finish(true);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    waiters.add(done);
  });
}
