//! 启动路径：把系统「用扉页打开」的文件夹 / 笔记变成启动工作区。
//!
//! Windows 上把文件夹或 `.md` 拖到桌面快捷方式图标，系统会以
//! `Feiye.exe <路径>` 启动；应用已在运行时，single-instance 插件把参数
//! 转发给首个实例，由它发出 `feiye://launch-path` 事件。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::fs_path;

/// 启动时要打开的目标：工作区根目录 +（可选）要接着打开的笔记。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchTarget {
    /// 作为工作区打开的目录（已规范化）。
    pub root: String,
    /// 需要随后打开的笔记相对路径；直接拖目录时为 `None`。
    pub rel_path: Option<String>,
}

/// 首次启动携带的路径，只被前端取走一次。
#[derive(Default)]
pub struct LaunchState(Mutex<Option<LaunchTarget>>);

impl LaunchState {
    pub fn new(target: Option<LaunchTarget>) -> Self {
        Self(Mutex::new(target))
    }

    pub fn take(&self) -> Option<LaunchTarget> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }
}

/// 从命令行参数里挑出第一个存在的路径；跳过 `--flag` 这类开关。
/// 相对路径按启动时的工作目录解析。
pub fn path_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Option<PathBuf> {
    for arg in args {
        if arg.is_empty() || arg.starts_with('-') {
            continue;
        }
        let raw = PathBuf::from(&arg);
        let path = if raw.is_absolute() {
            raw
        } else {
            cwd.join(raw)
        };
        if path.exists() {
            return Some(dunce::canonicalize(&path).unwrap_or(path));
        }
    }
    None
}

/// 目录 → 它自己；Markdown 文件 → 父目录 + 文件名；其它类型不处理。
pub fn target_for(path: &Path) -> Option<LaunchTarget> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.is_dir() {
        return Some(LaunchTarget {
            root: path.to_string_lossy().into_owned(),
            rel_path: None,
        });
    }
    if !meta.is_file() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().into_owned();
    if !fs_path::is_markdown(&name) {
        return None;
    }
    let parent = path.parent()?;
    Some(LaunchTarget {
        root: parent.to_string_lossy().into_owned(),
        rel_path: Some(name),
    })
}

pub fn target_from_args(
    args: impl IntoIterator<Item = String>,
    cwd: &Path,
) -> Option<LaunchTarget> {
    target_for(&path_from_args(args, cwd)?)
}

/// 前端启动完成后取走启动目标；取过一次就为空。
#[tauri::command]
pub fn take_launch_target(state: tauri::State<'_, LaunchState>) -> Option<LaunchTarget> {
    state.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_flags_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let args = vec![
            "--flag".to_string(),
            root.join("missing").to_string_lossy().into_owned(),
            root.to_string_lossy().into_owned(),
        ];
        let found = path_from_args(args, &root).unwrap();
        assert_eq!(found, root);
        assert!(path_from_args(Vec::<String>::new(), &root).is_none());
    }

    #[test]
    fn resolves_relative_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        let found = path_from_args(vec!["a.md".to_string()], dir.path()).unwrap();
        assert_eq!(found.file_name().unwrap(), "a.md");
    }

    #[test]
    fn maps_directory_and_markdown_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let folder = root.join("notes");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(root.join("a.md"), "x").unwrap();
        std::fs::write(root.join("a.txt"), "x").unwrap();

        assert_eq!(
            target_for(&folder),
            Some(LaunchTarget {
                root: folder.to_string_lossy().into_owned(),
                rel_path: None
            })
        );
        assert_eq!(
            target_for(&root.join("a.md")),
            Some(LaunchTarget {
                root: root.to_string_lossy().into_owned(),
                rel_path: Some("a.md".into())
            })
        );
        // 非 Markdown 文件不抢工作区。
        assert!(target_for(&root.join("a.txt")).is_none());
    }

    #[test]
    fn takes_target_only_once() {
        let state = LaunchState::new(Some(LaunchTarget {
            root: "C:/notes".into(),
            rel_path: None,
        }));
        assert!(state.take().is_some());
        assert!(state.take().is_none());
    }
}
