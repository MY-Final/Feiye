import { useEffect, useState, type FormEvent } from "react";

import {
  useUiStore,
  type ConfirmRequest,
  type PromptRequest,
} from "../stores/ui";

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const cancelValue =
    request.buttons.find((button) => button.value === "cancel")?.value ??
    request.buttons[request.buttons.length - 1]?.value ??
    "cancel";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        useUiStore.getState().resolveConfirm(cancelValue);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelValue]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          useUiStore.getState().resolveConfirm(cancelValue);
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={request.title}>
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
        onSubmit={submit}
      >
        <h2 className="modal-title">{request.title}</h2>
        <label className="field">
          <span className="field-label">{request.label ?? "名称"}</span>
          <input
            className="text-input"
            value={value}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
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

  if (confirm) return <ConfirmDialog request={confirm} />;
  if (prompt) return <PromptDialog key={prompt.title} request={prompt} />;
  return null;
}
