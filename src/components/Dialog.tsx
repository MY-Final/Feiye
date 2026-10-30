import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  useUiStore,
  type ConfirmRequest,
  type PromptRequest,
} from "../stores/ui";

/**
 * 让 Tab / Shift+Tab 只在对话框内部循环。
 * 否则焦点会跑到后面的编辑器里，接着打字就改到了正文。
 */
export function trapTab(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const focusables = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ).filter((element) => !element.hasAttribute("disabled"));
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && event.currentTarget.contains(active);

  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const cancelValue =
    request.buttons.find((button) => button.value === "cancel")?.value ??
    request.buttons[request.buttons.length - 1]?.value ??
    "cancel";
  // 回车只认主按钮；「移动到回收站」这类危险按钮必须真的点一下。
  const primaryValue =
    request.buttons.find((button) => button.tone === "primary")?.value ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        useUiStore.getState().resolveConfirm(cancelValue);
        return;
      }
      if (event.key === "Enter" && primaryValue) {
        // 焦点已经落在某个按钮上（例如 Tab 到「取消」）时交给按钮自己处理，
        // 回车就按当前选中的那个按钮走，而不是一律触发主按钮。
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active.closest(".modal-actions")
        ) {
          return;
        }
        event.preventDefault();
        useUiStore.getState().resolveConfirm(primaryValue);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelValue, primaryValue]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          useUiStore.getState().resolveConfirm(cancelValue);
        }
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={trapTab}
      >
        <h2 className="modal-title">{request.title}</h2>
        {request.message ? <p className="modal-message">{request.message}</p> : null}
        <div className="modal-actions">
          {request.buttons.map((button) => (
            <button
              key={button.value}
              type="button"
              className={`btn ${button.tone === "primary" ? "primary" : ""} ${
                button.tone === "danger" ? "danger" : ""
              }`}
              onClick={() => useUiStore.getState().resolveConfirm(button.value)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PromptDialog({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        useUiStore.getState().resolvePrompt(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    const message = request.validate?.(trimmed) ?? null;
    if (message) {
      setError(message);
      return;
    }
    useUiStore.getState().resolvePrompt(trimmed);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          useUiStore.getState().resolvePrompt(null);
        }
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={trapTab}
        onSubmit={submit}
      >
        <h2 className="modal-title">{request.title}</h2>
        <label className="field">
          <span className="field-label">{request.label ?? "名称"}</span>
          <input
            className="text-input"
            value={value}
            autoFocus
            onFocus={(event) => {
              const input = event.currentTarget;
              if (!request.selectBaseName) {
                input.select();
                return;
              }
              // 只选中「主名」部分，扩展名留着，避免改完还得重新补 `.md`。
              const dot = input.value.lastIndexOf(".");
              input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
            }}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setError(null);
            }}
          />
        </label>
        {error ? <p className="field-error">{error}</p> : null}
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => useUiStore.getState().resolvePrompt(null)}
          >
            取消
          </button>
          <button type="submit" className="btn primary">
            {request.confirmLabel ?? "确定"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogHost() {
  const confirm = useUiStore((state) => state.confirm);
  const prompt = useUiStore((state) => state.prompt);
  const open = Boolean(confirm || prompt);
  const wasOpen = useRef(false);

  // 对话框关掉后把焦点还给正文：接着敲键盘不用先用鼠标点一下。
  useEffect(() => {
    // 设置面板还开着时不抢焦点，否则焦点会跑到遮罩后面的正文里。
    if (wasOpen.current && !open && !useUiStore.getState().settingsOpen) {
      document.querySelector<HTMLElement>(".cm-content")?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  if (confirm) return <ConfirmDialog request={confirm} />;
  if (prompt) return <PromptDialog key={prompt.title} request={prompt} />;
  return null;
}
