//! 文档版本快照：每次成功保存后在应用数据目录留一份，最多保留最近 20 份。
//!
//! 与崩溃恢复副本（`recovery.rs`）分开：恢复副本只保留最新一份、正常保存即删除；
//! 这里的快照跨保存累积，供用户回看与手动恢复，从不自动写回源文件。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::error::AppError;
use crate::fs_path;

/// 每篇文档最多保留的版本数。
pub const MAX_HISTORY: usize = 20;
/// 快照过大时不写入，避免历史目录无限膨胀。
const MAX_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub saved_at: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRevision {
    pub id: String,
    pub saved_at: u64,
    pub content: String,
}

/// 稳定的 64 位 FNV-1a，与恢复副本同一算法：目录名不随进程变化。
fn fnv1a64(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn document_dir(dir: &Path, root: &Path, rel_path: &str) -> Result<PathBuf, AppError> {
    let clean = fs_path::normalize_rel(rel_path)?;
    if clean.is_empty() || !fs_path::is_markdown(&clean) {
        return Err(AppError::InvalidPath("只能为 Markdown 文档保存历史".into()));
    }
    let key = format!("{}\0{}", root.to_string_lossy(), clean);
    Ok(dir.join(format!("{:016x}", fnv1a64(&key))))
}

fn parse_id(stem: &str) -> Option<u64> {
    let stamp = stem.split('-').next()?;
    stamp.parse::<u64>().ok()
}

fn read_entries(doc_dir: &Path) -> Vec<HistoryEntry> {
    let Ok(entries) = fs::read_dir(doc_dir) else {
        return Vec::new();
    };

    let mut list: Vec<HistoryEntry> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_string();
            let saved_at = parse_id(&id)?;
            let size = entry.metadata().ok()?.len();
            Some(HistoryEntry {
                id,
                saved_at,
                size,
            })
        })
        .collect();

    // 同一毫秒内会有 `ms-1`、`ms-2` 这样的后缀，按编号倒序保证新的在前。
    list.sort_by(|a, b| (&b.id).cmp(&a.id));
    list
}

fn snapshot_path(doc_dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    if id.is_empty()
        || id.len() > 24
        || !id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-')
    {
        return Err(AppError::InvalidPath("历史版本编号不合法".into()));
    }
    Ok(doc_dir.join(format!("{id}.md")))
}

/// 保存一份快照；内容与最新一份相同则跳过，返回是否真的写入。
pub fn push_snapshot(
    dir: &Path,
    root: &Path,
    rel_path: &str,
    content: &str,
) -> Result<bool, AppError> {
    if content.len() > MAX_SNAPSHOT_BYTES {
        return Err(AppError::InvalidPath("文档过大，已跳过历史快照".into()));
    }
    let doc_dir = document_dir(dir, root, rel_path)?;
    let existing = read_entries(&doc_dir);
    if let Some(newest) = existing.first() {
        let path = snapshot_path(&doc_dir, &newest.id)?;
        if fs::read_to_string(path).ok().as_deref() == Some(content) {
            return Ok(false);
        }
    }

    fs::create_dir_all(&doc_dir)?;
    let now = now_ms();
    let mut id = now.to_string();
    let mut suffix = 1;
    while snapshot_path(&doc_dir, &id)?.exists() {
        id = format!("{now}-{suffix}");
        suffix += 1;
    }

    let path = snapshot_path(&doc_dir, &id)?;
    fs::write(&path, content)?;

    // 只留最近的 MAX_HISTORY 份：按编号倒序，超出部分从尾部删。
    let mut list = read_entries(&doc_dir);
    list.sort_by(|a, b| (&b.id).cmp(&a.id));
    for stale in list.iter().skip(MAX_HISTORY) {
        if let Ok(path) = snapshot_path(&doc_dir, &stale.id) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(true)
}

pub fn list_history(
    dir: &Path,
    root: &Path,
    rel_path: &str,
) -> Result<Vec<HistoryEntry>, AppError> {
    let doc_dir = document_dir(dir, root, rel_path)?;
    let mut list = read_entries(&doc_dir);
    list.sort_by(|a, b| (&b.id).cmp(&a.id));
    list.truncate(MAX_HISTORY);
    Ok(list)
}

pub fn read_history(
    dir: &Path,
    root: &Path,
    rel_path: &str,
    id: &str,
) -> Result<HistoryRevision, AppError> {
    let doc_dir = document_dir(dir, root, rel_path)?;
    let path = snapshot_path(&doc_dir, id)?;
    let content = fs::read_to_string(&path)
        .map_err(|_| AppError::NotFound("历史版本不存在或已被清理".into()))?;
    let saved_at = parse_id(id).ok_or_else(|| AppError::InvalidPath("历史版本编号不合法".into()))?;
    Ok(HistoryRevision {
        id: id.to_string(),
        saved_at,
        content,
    })
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
    fn pushes_lists_and_reads() {
        let (_root_dir, root, _data_dir, data) = workspace();
        assert!(push_snapshot(&data, &root, "notes/a.md", "first").unwrap());
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(push_snapshot(&data, &root, "notes/a.md", "second").unwrap());
        assert!(push_snapshot(&data, &root, "b.md", "other").unwrap());

        let list = list_history(&data, &root, "notes/a.md").unwrap();
        assert_eq!(list.len(), 2);
        let newest = read_history(&data, &root, "notes/a.md", &list[0].id).unwrap();
        assert_eq!(newest.content, "second");
        let older = read_history(&data, &root, "notes/a.md", &list[1].id).unwrap();
        assert_eq!(older.content, "first");

        assert!(list_history(&data, &root, "b.md").unwrap().len() == 1);
        assert!(list_history(&data, &root, "notes/a.txt").is_err());
    }

    #[test]
    fn skips_identical_content() {
        let (_root_dir, root, _data_dir, data) = workspace();
        assert!(push_snapshot(&data, &root, "a.md", "same").unwrap());
        assert!(!push_snapshot(&data, &root, "a.md", "same").unwrap());
        assert!(push_snapshot(&data, &root, "a.md", "changed").unwrap());
        assert_eq!(list_history(&data, &root, "a.md").unwrap().len(), 2);
    }

    #[test]
    fn prunes_to_max_history() {
        let (_root_dir, root, _data_dir, data) = workspace();
        for index in 0..(MAX_HISTORY + 3) {
            push_snapshot(&data, &root, "a.md", &format!("version {index}")).unwrap();
        }
        let list = list_history(&data, &root, "a.md").unwrap();
        assert_eq!(list.len(), MAX_HISTORY);
        let newest = read_history(&data, &root, "a.md", &list[0].id).unwrap();
        assert_eq!(newest.content, format!("version {}", MAX_HISTORY + 2));
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let (_root_dir, root, _data_dir, data) = workspace();
        push_snapshot(&data, &root, "a.md", "x").unwrap();
        assert!(read_history(&data, &root, "a.md", "../a").is_err());
        assert!(read_history(&data, &root, "a.md", "abc").is_err());
    }
}
