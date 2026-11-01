import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { useUiStore } from "../../stores/ui";
import { useUpdateStore } from "../../stores/updates";

/** 正在等待用户确认（或正在下载）的那次更新。 */
let pending: Update | null = null;

/**
 * GitHub Release 的正文是 Markdown；这里只留前几行能直接读的文字，
 * 不为了几十个字把整条 Markdown 管线带进启动路径。
 */
function summarizeNotes(body: string | null | undefined): string | null {
  if (!body) return null;
  const kept: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    kept.push(line.replace(/^[-*]\s*/, "· "));
    if (kept.length >= 8) break;
  }
  return kept.length > 0 ? kept.join("\n") : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 查询更新。silent 为 true 时用于启动后的静默检查：
 * 没有更新、或网络失败都不打扰用户；手动检查则给出明确反馈。
 */
export async function checkForUpdates(options: { silent: boolean }): Promise<void> {
  const { phase } = useUpdateStore.getState();
  if (phase === "checking" || phase === "downloading") return;

  useUpdateStore.setState({ phase: "checking", error: null });
  try {
    const update = await check();
    if (!update) {
      useUpdateStore.setState({ phase: "idle" });
      if (!options.silent) {
        useUiStore.getState().toast("已是最新版本", "info");
      }
      return;
    }
    pending = update;
    useUpdateStore.setState({
      open: true,
      phase: "available",
      version: update.version,
      notes: summarizeNotes(update.body),
      progress: null,
      error: null,
    });
  } catch (error) {
    pending = null;
    useUpdateStore.setState({ phase: "idle" });
    if (!options.silent) {
      useUiStore.getState().toast(`检查更新失败：${messageOf(error)}`, "error");
    }
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  const update = pending;
  if (!update) return;

  useUpdateStore.setState({ phase: "downloading", progress: null, error: null });
  let total = 0;
  let received = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        received = 0;
        useUpdateStore.setState({ progress: total > 0 ? 0 : null });
        return;
      }
      if (event.event === "Progress") {
        received += event.data.chunkLength;
        useUpdateStore.setState({
          progress: total > 0 ? Math.min(received / total, 1) : null,
        });
        return;
      }
      useUpdateStore.setState({ progress: 1, phase: "ready" });
    });
    useUpdateStore.setState({ phase: "ready", progress: 1 });
  } catch (error) {
    useUpdateStore.setState({ phase: "available", error: messageOf(error) });
    useUiStore.getState().toast(`更新失败：${messageOf(error)}`, "error");
  }
}

export async function restartForUpdate(): Promise<void> {
  await relaunch();
}

export function dismissUpdate(): void {
  if (useUpdateStore.getState().phase === "downloading") return;
  pending = null;
  useUpdateStore.setState({
    open: false,
    phase: "idle",
    version: null,
    notes: null,
    progress: null,
    error: null,
  });
}
