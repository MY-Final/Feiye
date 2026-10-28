use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::fs_path::{self, IGNORED_DIRS};

/// 当前工作区根目录（已规范化），由 Tauri 托管。
#[derive(Default)]
pub struct WorkspaceState(Mutex<Option<PathBuf>>);

impl WorkspaceState {
    pub fn root(&self) -> Result<PathBuf, AppError> {
        self.0
            .lock()
            .map_err(|_| AppError::Io("工作区状态已损坏".into()))?
            .clone()
            .ok_or(AppError::NoWorkspace)
    }

    fn set_root(&self, root: PathBuf) -> Result<(), AppError> {
        *self
            .0
            .lock()
            .map_err(|_| AppError::Io("工作区状态已损坏".into()))? = Some(root);
        Ok(())
    }

    fn current(&self) -> Result<Option<PathBuf>, AppError> {
        Ok(self
            .0
            .lock()
            .map_err(|_| AppError::Io("工作区状态已损坏".into()))?
            .clone())
    }

    fn clear(&self) -> Result<(), AppError> {
        *self
            .0
            .lock()
            .map_err(|_| AppError::Io("工作区状态已损坏".into()))? = None;
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
}

fn info(root: &Path) -> WorkspaceInfo {
    WorkspaceInfo {
        root: root.to_string_lossy().into_owned(),
        name: root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub fn open_workspace(
    path: String,
    state: State<'_, WorkspaceState>,
) -> Result<WorkspaceInfo, AppError> {
    let root = dunce::canonicalize(&path)
        .map_err(|_| AppError::NotFound(format!("无法打开文件夹：{path}")))?;

    if !root.is_dir() {
        return Err(AppError::InvalidPath("请选择一个文件夹".into()));
    }

    state.set_root(root.clone())?;
    Ok(info(&root))
}

#[tauri::command]
pub fn current_workspace(
    state: State<'_, WorkspaceState>,
) -> Result<Option<WorkspaceInfo>, AppError> {
    Ok(state.current()?.as_deref().map(info))
}

#[tauri::command]
pub fn close_workspace(state: State<'_, WorkspaceState>) -> Result<(), AppError> {
    state.clear()
}

#[tauri::command]
pub fn list_dir(
    rel_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<Entry>, AppError> {
    let root = state.root()?;
    list_children(&root, &rel_path)
}

fn list_children(root: &Path, rel: &str) -> Result<Vec<Entry>, AppError> {
    let dir = fs_path::resolve_in_workspace(root, rel)?;
    let dir = dunce::canonicalize(&dir)
        .map_err(|_| AppError::NotFound(format!("目录不存在：{rel}")))?;

    if !dir.starts_with(root) {
        return Err(AppError::OutsideWorkspace);
    }
    if !dir.is_dir() {
        return Err(AppError::InvalidPath("目标不是目录".into()));
    }

    let clean = fs_path::normalize_rel(rel)?;
    let mut entries = Vec::new();

    for item in fs::read_dir(&dir)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();

        // 隐藏项一律不展示（同时覆盖 .git、.obsidian 等）。
        if name.starts_with('.') {
            continue;
        }

        let file_type = item.file_type()?;
        // 符号链接可能指向工作区之外，直接跳过。
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            entries.push(Entry {
                rel_path: fs_path::join_rel(&clean, &name),
                name,
                is_dir: true,
            });
        } else if file_type.is_file() && fs_path::is_markdown(&name) {
            entries.push(Entry {
                rel_path: fs_path::join_rel(&clean, &name),
                name,
                is_dir: false,
            });
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_only_directories_and_markdown() {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();

        fs::create_dir(root.join("notes")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join("a.md"), "# a").unwrap();
        fs::write(root.join("B.MD"), "# b").unwrap();
        fs::write(root.join("c.txt"), "c").unwrap();
        fs::write(root.join(".hidden.md"), "hidden").unwrap();
        fs::write(root.join("notes/d.md"), "# d").unwrap();
        fs::write(root.join("node_modules/e.md"), "ignored").unwrap();

        let entries = list_children(&root, "").unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(names, vec!["notes", "a.md", "B.MD"]);
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].rel_path, "a.md");

        let children = list_children(&root, "notes").unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].rel_path, "notes/d.md");
    }

    #[test]
    fn rejects_escaping_listing() {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();

        assert!(list_children(&root, "..").is_err());
        assert!(list_children(&root, "../").is_err());
    }
}
