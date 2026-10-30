//! 目录监听与外部修改检测（M3）。
//!
//! 只监听当前工作区，事件交给前端做去抖：刷新文件树、检查当前文档是否被外部改过。
//! 监听器保存在受管状态里，切换工作区时替换旧的，关闭工作区时释放。

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Clone, Serialize)]
struct WorkspaceChanged {
    kind: String,
    paths: Vec<String>,
}

#[tauri::command]
pub fn watch_workspace(
    app: AppHandle,
    state: State<'_, WatchState>,
    root: String,
) -> Result<(), String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err("not-a-directory".into());
    }

    let app_for_events = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        let payload = WorkspaceChanged {
            kind: format!("{:?}", event.kind),
            paths: event
                .paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        };
        let _ = app_for_events.emit("workspace-changed", payload);
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    let mut slot = state
        .watcher
        .lock()
        .map_err(|_| "watcher-lock-poisoned".to_string())?;
    *slot = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_workspace(state: State<'_, WatchState>) {
    if let Ok(mut slot) = state.watcher.lock() {
        *slot = None;
    }
}
