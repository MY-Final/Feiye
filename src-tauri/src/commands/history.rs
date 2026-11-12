use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::recovery::recovery_dir;
use crate::commands::workspace::WorkspaceState;
use crate::error::AppError;
use crate::{history, recovery};

fn history_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Io(format!("无法定位应用数据目录：{error}")))?
        .join("history");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 保存成功后留一份快照；返回是否写入（内容与上一版相同则跳过）。
#[tauri::command]
pub fn save_history(
    rel_path: String,
    content: String,
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> Result<bool, AppError> {
    let root = state.root()?;
    let dir = history_dir(&app)?;
    history::push_snapshot(&dir, &root, &rel_path, &content)
}

#[tauri::command]
pub fn list_history(
    rel_path: String,
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<history::HistoryEntry>, AppError> {
    let root = state.root()?;
    let dir = history_dir(&app)?;
    history::list_history(&dir, &root, &rel_path)
}

#[tauri::command]
pub fn read_history(
    rel_path: String,
    id: String,
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> Result<history::HistoryRevision, AppError> {
    let root = state.root()?;
    let dir = history_dir(&app)?;
    history::read_history(&dir, &root, &rel_path, &id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub history_files: u64,
    pub history_bytes: u64,
    pub recovery_files: u64,
    pub recovery_bytes: u64,
}

/// 历史快照与恢复副本占用的文件数与字节数，供设置页展示。
#[tauri::command]
pub fn storage_stats(app: AppHandle) -> Result<StorageStats, AppError> {
    let (history_files, history_bytes) = history::storage_stats(&history_dir(&app)?);
    let (recovery_files, recovery_bytes) = recovery::storage_stats(&recovery_dir(&app)?);
    Ok(StorageStats {
        history_files,
        history_bytes,
        recovery_files,
        recovery_bytes,
    })
}

#[tauri::command]
pub fn delete_history(
    rel_path: String,
    id: String,
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> Result<(), AppError> {
    let root = state.root()?;
    let dir = history_dir(&app)?;
    history::delete_history(&dir, &root, &rel_path, &id)
}

/// 删除早于 `before_days` 天的历史快照；不传则清空全部。返回删除数量。
#[tauri::command]
pub fn clear_history(before_days: Option<u64>, app: AppHandle) -> Result<usize, AppError> {
    let cutoff = before_days.map(|days| {
        let back = days.saturating_mul(24 * 60 * 60 * 1000);
        history::now_ms().saturating_sub(back)
    });
    Ok(history::clear_history(&history_dir(&app)?, cutoff))
}

/// 清空全部崩溃恢复副本，返回删除数量。
#[tauri::command]
pub fn clear_recoveries(app: AppHandle) -> Result<usize, AppError> {
    Ok(recovery::clear_all(&recovery_dir(&app)?))
}
