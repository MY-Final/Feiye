import { useUiStore } from "../stores/ui";

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
          onClick={() => dismiss(toast.id)}
          title="点击关闭"
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
