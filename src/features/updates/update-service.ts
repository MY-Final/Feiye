import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { getSetting, setSetting } from "../../lib/tauri";
import { useUiStore } from "../../stores/ui";
import { useUpdateStore } from "../../stores/updates";

/** 正在等待用户确认（或正在下载）的那次更新。 */
let pending: Update | null = null;

/** 自动检查更新的节流标记，值为本地日期（YYYY-MM-DD）。 */
const LAST_SILENT_CHECK_KEY = "lastSilentUpdateCheck";

/** 用户点过「跳过此版本」的版本号：自动检查遇到它就不再打扰。 */
const SKIPPED_VERSION_KEY = "skippedUpdateVersion";

function localDateStamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * 静默检查每天至多一次：同一天内重开应用不再联网。
 * 先记下日期再发请求，弱网时也不在每次启动上反复重试；跨天自动恢复。
 * 读不到设置就照常检查。
 */
let silentCheckGate: Promise<boolean> | null = null;
function allowSilentCheck(): Promise<boolean> {
  silentCheckGate ??= (async () => {
    const today = localDateStamp();
    const last = await getSetting<string>(LAST_SILENT_CHECK_KEY);
    if (last === today) return false;
    await setSetting(LAST_SILENT_CHECK_KEY, today);
    return true;
  })().catch(() => true);
  return silentCheckGate;
}

/**
 * GitHub Release 的正文是 Markdown；这里只留前几行能直接读的文字，
 * 不为了几十个字把整条 Markdown 管线带进启动路径。
 * 行内链接压成「文字（URL）」，弹窗里再把 URL 渲染成可点链接。
 */
function summarizeNotes(body: string | null | undefined): string | null {
  if (!body) return null;
  const kept: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw
      .trim()
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1（$2）");
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
  if (options.silent && !(await allowSilentCheck())) return;

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
    // 只拦自动检查：用户主动点「检查更新」时仍要看到这个版本。
    if (options.silent) {
      const skipped = await getSetting<string>(SKIPPED_VERSION_KEY);
      if (skipped === update.version) {
        pending = null;
        useUpdateStore.setState({ phase: "idle" });
        return;
      }
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

/**
 * 跳过当前版本：自动检查不再为它弹窗，但手动检查仍可看到并安装；
 * 发布了更新的版本时会重新提醒。
 */
export async function skipUpdateVersion(): Promise<void> {
  const version = useUpdateStore.getState().version;
  if (version) {
    await setSetting(SKIPPED_VERSION_KEY, version);
    useUiStore
      .getState()
      .toast(`已跳过 v${version}，可在「设置 → 关于」恢复提醒`, "info");
  }
  dismissUpdate();
}

/** 读取「已跳过」的版本，供关于页展示；读不到按未跳过处理。 */
export async function getSkippedUpdateVersion(): Promise<string | null> {
  return (await getSetting<string>(SKIPPED_VERSION_KEY)) || null;
}

/** 撤销「跳过此版本」：清掉记录，自动检查重新为这个版本提醒。 */
export async function restoreUpdateReminders(): Promise<void> {
  await setSetting(SKIPPED_VERSION_KEY, "");
  useUiStore.getState().toast("已恢复自动检查更新", "info");
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
