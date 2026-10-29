import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load, type Store } from "@tauri-apps/plugin-store";

export interface Entry {
  name: string;
  relPath: string;
  isDir: boolean;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
}

export interface FileContent {
  content: string;
  modifiedMs: number;
  size: number;
}

export interface FileMeta {
  modifiedMs: number;
  size: number;
}

export interface RecoverySnapshot {
  id: string;
  workspaceRoot: string;
  relPath: string;
  name: string;
  content: string;
  savedAt: number;
  baseModifiedMs: number | null;
}

export interface ImageAsset {
  relPath: string;
  markdownPath: string;
}

export interface AppError {
  code:
    | "no-workspace"
    | "invalid-path"
    | "outside-workspace"
    | "not-found"
    | "already-exists"
    | "conflict"
    | "not-utf8"
    | "io";
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppError).code === "string" &&
    typeof (value as AppError).message === "string"
  );
}

export function describeError(value: unknown): string {
  if (isAppError(value)) return value.message;
  if (value instanceof Error) return value.message;
  return String(value);
}

export function openWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("open_workspace", { path });
}

export function currentWorkspace(): Promise<WorkspaceInfo | null> {
  return invoke<WorkspaceInfo | null>("current_workspace");
}

export function closeWorkspace(): Promise<void> {
  return invoke<void>("close_workspace");
}

export function listDir(relPath: string): Promise<Entry[]> {
  return invoke<Entry[]>("list_dir", { relPath });
}

export function readFile(relPath: string): Promise<FileContent> {
  return invoke<FileContent>("read_file", { relPath });
}

export function writeFile(
  relPath: string,
  content: string,
  expectedModifiedMs: number | null,
): Promise<FileMeta> {
  return invoke<FileMeta>("write_file", {
    relPath,
    content,
    expectedModifiedMs,
  });
}

export function createFile(
  parentRelPath: string,
  name: string,
): Promise<Entry> {
  return invoke<Entry>("create_file", { parentRelPath, name });
}

export function createFolder(
  parentRelPath: string,
  name: string,
): Promise<Entry> {
  return invoke<Entry>("create_folder", { parentRelPath, name });
}

export function renameEntry(
  relPath: string,
  newName: string,
): Promise<Entry> {
  return invoke<Entry>("rename_entry", { relPath, newName });
}

export function deleteEntry(relPath: string): Promise<void> {
  return invoke<void>("delete_entry", { relPath });
}

export function saveRecovery(
  relPath: string,
  name: string,
  content: string,
  baseModifiedMs: number | null,
): Promise<RecoverySnapshot> {
  return invoke<RecoverySnapshot>("save_recovery", {
    relPath,
    name,
    content,
    baseModifiedMs,
  });
}

export function listRecoveries(): Promise<RecoverySnapshot[]> {
  return invoke<RecoverySnapshot[]>("list_recoveries");
}

export function deleteRecovery(id: string): Promise<void> {
  return invoke<void>("delete_recovery", { id });
}

export function clearRecovery(relPath: string): Promise<void> {
  return invoke<void>("clear_recovery", { relPath });
}

export function saveImageAsset(
  relPath: string,
  data: string,
  baseName: string,
): Promise<ImageAsset> {
  return invoke<ImageAsset>("save_image_asset", {
    relPath,
    data,
    baseName,
  });
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择工作区文件夹",
  });
  return typeof selected === "string" ? selected : null;
}

let settingsPromise: Promise<Store> | null = null;

function settings(): Promise<Store> {
  settingsPromise ??= load("settings.json", { autoSave: 300 });
  return settingsPromise;
}

export async function getSetting<T>(key: string): Promise<T | null> {
  try {
    const store = await settings();
    const value = await store.get<T>(key);
    return value ?? null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  try {
    const store = await settings();
    await store.set(key, value);
    await store.save();
  } catch {
    // 设置写入失败不应影响主流程。
  }
}
