let composing = false;

/**
 * 输入法组词状态。组词期间文档里是未上屏的拼音，统计、预览与自动保存
 * 都应推迟到 compositionend 之后再处理。
 */
export function setEditorComposing(value: boolean): void {
  composing = value;
}

export function isEditorComposing(): boolean {
  return composing;
}
