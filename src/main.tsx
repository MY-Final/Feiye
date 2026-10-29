import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import App from "./app/App";
import "./styles/global.css";
import { loadPreferences } from "./stores/settings";

async function bootstrap(): Promise<void> {
  // 先读取主题等偏好，再渲染，避免暗色模式下出现一帧白光。
  await loadPreferences();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
