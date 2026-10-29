//! 崩溃恢复副本：保存在应用数据目录，不写入用户的工作区。
//!
//! 每个「工作区 + 文档路径」只有一份最新副本。正常保存或用户明确放弃修改后
//! 删除副本；恢复副本从不自动覆盖源文件。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::fs_path;

/// 单份恢复副本上限，避免异常内容占满应用数据目录。
const MAX_RECOVERY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub id: String,
    pub workspace_root: String,
    pub rel_path: String,
    pub name: String,
    pub content: String,
    pub saved_at: u64,
    pub base_modified_ms: Option<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// 稳定的 64 位 FNV-1a，用作文件名；不依赖进程随机的哈希种子。
fn fnv1a64(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn snapshot_id(root: &Path, rel_path: &str) -> String {
    format!(
        "{:016x}",
        fnv1a64(&format!("{}\0{}", root.to_string_lossy(), rel_path))
    )
}

fn snapshot_path(dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    if id.len() != 16 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::InvalidPath("恢复副本编号不合法".into()));
    }
    Ok(dir.join(format!("{id}.json")))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath("无法确定恢复目录".into()))?;
    fs::create_dir_all(parent)?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp = parent.join(format!(".feiye-tmp-{}-{nonce}", std::process::id()));

    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(AppError::from)
}

/// 写入一份恢复副本，返回写入后的快照元数据。
pub fn save_snapshot(
    dir: &Path,
    root: &Path,
    rel_path: &str,
    name: &str,
    content: &str,
    base_modified_ms: Option<u64>,
) -> Result<RecoverySnapshot, AppError> {
    let clean = fs_path::normalize_rel(rel_path)?;
    if clean.is_empty() || !fs_path::is_markdown(&clean) {
        return Err(AppError::InvalidPath(
            "只能为 Markdown 文档保存恢复副本".into(),
        ));
    }
    if name.is_empty() || name.contains(['/', '\\', '\0']) {
        return Err(AppError::InvalidPath("文档名称不合法".into()));
    }
    if content.len() > MAX_RECOVERY_BYTES {
        return Err(AppError::InvalidPath("文档过大，已暂停写入恢复副本".into()));
    }

    let snapshot = RecoverySnapshot {
        id: snapshot_id(root, &clean),
        workspace_root: root.to_string_lossy().into_owned(),
        rel_path: clean,
        name: name.to_string(),
        content: content.to_string(),
        saved_at: now_ms(),
        base_modified_ms,
    };

    let bytes = serde_json::to_vec(&snapshot)
        .map_err(|error| AppError::Io(format!("无法序列化恢复副本：{error}")))?;
    write_atomic(&snapshot_path(dir, &snapshot.id)?, &bytes)?;
    Ok(snapshot)
}

/// 读取当前工作区的恢复副本，同一路径只保留最新一份，按时间倒序。
pub fn list_snapshots(dir: &Path, root: &Path) -> Vec<RecoverySnapshot> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let root = root.to_string_lossy();

    let mut snapshots: Vec<RecoverySnapshot> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                return None;
            }
            let bytes = fs::read(&path).ok()?;
            let snapshot: RecoverySnapshot = serde_json::from_slice(&bytes).ok()?;
            (snapshot.workspace_root == root).then_some(snapshot)
        })
        .collect();

    snapshots.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));

    let mut seen = std::collections::HashSet::new();
    snapshots.retain(|snapshot| seen.insert(snapshot.rel_path.clone()));
    snapshots
}

pub fn delete_snapshot(dir: &Path, id: &str) -> Result<(), AppError> {
    let path = snapshot_path(dir, id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::from(error)),
    }
}

/// 删除某个文档的恢复副本（正常保存、重新加载或放弃修改时使用）。
pub fn clear_snapshot(dir: &Path, root: &Path, rel_path: &str) -> Result<(), AppError> {
    let clean = fs_path::normalize_rel(rel_path)?;
    let id = snapshot_id(root, &clean);
    delete_snapshot(dir, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, PathBuf, tempfile::TempDir, PathBuf) {
        let root_dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(root_dir.path()).unwrap();
        let data_dir = tempfile::tempdir().unwrap();
        let data = dunce::canonicalize(data_dir.path()).unwrap();
        (root_dir, root, data_dir, data)
    }

    #[test]
    fn saves_and_lists_latest_copy_per_path() {
        let (_root_dir, root, _data_dir, data) = workspace();

        save_snapshot(&data, &root, "notes/a.md", "a.md", "first", Some(1)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        save_snapshot(&data, &root, "notes/a.md", "a.md", "second", Some(2)).unwrap();
        save_snapshot(&data, &root, "b.md", "b.md", "other", None).unwrap();

        let snapshots = list_snapshots(&data, &root);
        assert_eq!(snapshots.len(), 2);
        assert_eq!(snapshots[0].rel_path, "b.md");
        assert_eq!(snapshots[1].content, "second");
        assert_eq!(snapshots[1].base_modified_ms, Some(2));
    }

    #[test]
    fn ignores_other_workspaces_and_corrupt_files() {
        let (_root_dir, root, _data_dir, data) = workspace();
        let other = tempfile::tempdir().unwrap();
        let other = dunce::canonicalize(other.path()).unwrap();

        save_snapshot(&data, &root, "a.md", "a.md", "mine", None).unwrap();
        save_snapshot(&data, &other, "a.md", "a.md", "theirs", None).unwrap();
        fs::write(data.join("broken.json"), b"{not json").unwrap();

        let snapshots = list_snapshots(&data, &root);
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].content, "mine");
    }

    #[test]
    fn clears_only_the_requested_snapshot() {
        let (_root_dir, root, _data_dir, data) = workspace();
        let saved = save_snapshot(&data, &root, "a.md", "a.md", "draft", None).unwrap();

        clear_snapshot(&data, &root, "a.md").unwrap();
        assert!(list_snapshots(&data, &root).is_empty());
        assert!(!snapshot_path(&data, &saved.id).unwrap().exists());
    }

    #[test]
    fn rejects_unsafe_ids_and_paths() {
        let (_root_dir, root, _data_dir, data) = workspace();
        assert!(delete_snapshot(&data, "../a").is_err());
        assert!(save_snapshot(&data, &root, "../a.md", "a.md", "x", None).is_err());
        assert!(save_snapshot(&data, &root, "a.txt", "a.txt", "x", None).is_err());
    }
}
