import { pauseToast, resumeToast, useUiStore } from "../stores/ui";

export function ToastHost() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  // 读屏只播报「已存在的」live region 里新增的内容；若等第一条提示才挂载
  // 这个容器，文字和区域同时出现，多数读屏不会念。因此空着也保留一个常驻
  // 容器（无子节点时宽高为 0，不影响界面与点击）。
  //
  // role=status 隐含 aria-atomic=true：容器里同时挂着几条提示时，新增一条会
  // 让读屏把仍在显示的前几条整段重念，最新的反而被淹没。改为只播报新增节点。
  return (
    <div
      className="toast-host"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
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
          title={
            toast.action
              ? (toast.actionTitle ?? "点击在资源管理器中显示")
              : "点击关闭"
          }
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
