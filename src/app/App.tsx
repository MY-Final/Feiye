import { APP_NAME, APP_NAME_EN, APP_TAGLINE } from "../lib/app-info";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">
          {APP_NAME}
          <span className="brand-en">{APP_NAME_EN}</span>
        </span>
      </header>

      <main className="empty-state">
        <div className="mark" aria-hidden="true">
          扉
        </div>
        <h1>{APP_TAGLINE}</h1>
        <p>工作区与编辑器尚未接入。脚手架已就绪。</p>
      </main>

      <footer className="statusbar">
        <span>本地优先 · 纯文本</span>
        <span>v0.1.0</span>
      </footer>
    </div>
  );
}
