import { pauseToast, resumeToast, useUiStore } from "../stores/ui";

export function ToastHost() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast ${toast.kind}`}
          onClick={() => {
            // 带动作的提示（如导出成功）点击后执行它，而不是原地关掉；
            // 动作执行完提示也随即收起，不留下一条点过却没反应的气泡。
            toast.action?.();
            dismiss(toast.id);
          }}
          // 鼠标停上来时别急着消失，挪开后再留一点时间。
          onMouseEnter={() => pauseToast(toast.id)}
          onMouseLeave={() => resumeToast(toast.id, toast.kind)}
          title={toast.action ? "点击在资源管理器中显示" : "点击关闭"}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
