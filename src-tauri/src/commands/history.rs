use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::commands::workspace::WorkspaceState;
use crate::error::AppError;
use crate::history;

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
