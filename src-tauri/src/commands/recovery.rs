use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::commands::workspace::WorkspaceState;
use crate::error::AppError;
use crate::recovery::{self, RecoverySnapshot};

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Io(format!("无法定位应用数据目录：{error}")))?
        .join("recovery");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[tauri::command]
pub fn save_recovery(
    rel_path: String,
    name: String,
    content: String,
    base_modified_ms: Option<u64>,
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> Result<RecoverySnapshot, AppError> {
    let root = state.root()?;
    let dir = recovery_dir(&app)?;
    recovery::save_snapshot(&dir, &root, &rel_path, &name, &content, base_modified_ms)
}

#[tauri::command]
pub fn list_recoveries(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<RecoverySnapshot>, AppError> {
    let root = state.root()?;
    let dir = recovery_dir(&app)?;
    Ok(recovery::list_snapshots(&dir, &root))
}

#[tauri::command]
pub fn delete_recovery(id: String, app: AppHandle) -> Result<(), AppError> {
    let dir = recovery_dir(&app)?;
    recovery::delete_snapshot(&dir, &id)
}

#[tauri::command]
pub fn clear_recovery(
    rel_path: String,
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> Result<(), AppError> {
    let root = state.root()?;
    let dir = recovery_dir(&app)?;
    recovery::clear_snapshot(&dir, &root, &rel_path)
}
