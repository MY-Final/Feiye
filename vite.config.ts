import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    // 预览管线在 Web Worker 中运行。hast-util-from-html-isomorphic 的 "worker"
    // 导出是不依赖 DOMParser/document 的实现，必须优先命中，否则 Worker 会崩溃。
    conditions: ["worker", "module", "browser", "development|production"],
  },

  // Worker 用 ES 模块格式，才能把 Shiki 的语法按语言拆成独立 chunk：
  // 预览只拉当前文档用到的几种语言，而不是把三百多种语法打进一个文件。
  worker: {
    format: "es",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
