//! 工作区全文搜索：递归扫描 Markdown，按行返回命中位置。

use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::State;

use super::workspace::WorkspaceState;
use crate::error::AppError;
use crate::fs_path::{self, IGNORED_DIRS};

/// 单个文件超过这个大小直接跳过：真正的大文件搜起来慢，命中也没什么用。
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// 一次最多返回多少条，避免把整个侧栏塞满。
const MAX_HITS: usize = 200;
/// 单行预览最多保留多少字符。
const MAX_TEXT_CHARS: usize = 240;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub rel_path: String,
    /// 从 1 开始的行号；点击结果后编辑器按它定位。
    pub line: u32,
    /// 去掉首尾空白的整行，长行截断。
    pub text: String,
}

fn preview(line: &str) -> String {
    let trimmed = line.trim();
    let mut text: String = trimmed.chars().take(MAX_TEXT_CHARS).collect();
    if trimmed.chars().count() > MAX_TEXT_CHARS {
        text.push('…');
    }
    text
}

fn walk(dir: &Path, rel: &str, needle: &str, limit: usize, hits: &mut Vec<SearchHit>) {
    if hits.len() >= limit {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for item in entries.flatten() {
        if hits.len() >= limit {
            return;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        // 和文件树保持一致：隐藏项、符号链接、忽略目录都不进搜索。
        if name.starts_with('.') {
            continue;
        }
        let file_type = match item.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }

        let child_rel = fs_path::join_rel(rel, &name);
        if file_type.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&item.path(), &child_rel, needle, limit, hits);
            continue;
        }
        if !file_type.is_file() || !fs_path::is_markdown(&name) {
            continue;
        }
        if item.metadata().map(|meta| meta.len()).unwrap_or(0) > MAX_FILE_BYTES {
            continue;
        }

        let content = match fs::read_to_string(item.path()) {
            Ok(content) => content,
            // 非 UTF-8 / 读取失败：跳过这一篇，不影响别的结果。
            Err(_) => continue,
        };

        for (index, line) in content.lines().enumerate() {
            if hits.len() >= limit {
                return;
            }
            if line.to_lowercase().contains(needle) {
                hits.push(SearchHit {
                    rel_path: child_rel.clone(),
                    line: index as u32 + 1,
                    text: preview(line),
                });
            }
        }
    }
}

#[tauri::command]
pub fn search_workspace(
    query: String,
    limit: Option<u32>,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<SearchHit>, AppError> {
    let root = state.root()?;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit
        .map(|value| value as usize)
        .unwrap_or(MAX_HITS)
        .clamp(1, MAX_HITS);

    let mut hits = Vec::new();
    walk(&root, "", &needle, limit, &mut hits);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::{preview, walk, SearchHit};

    fn collect(dir: &std::path::Path, needle: &str) -> Vec<SearchHit> {
        let mut hits = Vec::new();
        walk(dir, "", needle, 200, &mut hits);
        hits
    }

    #[test]
    fn preview_trims_and_truncates() {
        assert_eq!(preview("  hello  "), "hello");
        let long = "a".repeat(300);
        let text = preview(&long);
        assert_eq!(text.chars().count(), 241);
        assert!(text.ends_with('…'));
    }

    #[test]
    fn walks_markdown_and_skips_ignored() {
        let base = std::env::temp_dir().join(format!("feiye-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("notes")).unwrap();
        std::fs::create_dir_all(base.join(".git")).unwrap();
        std::fs::write(base.join("notes/a.md"), "first line\nNeedle here\n").unwrap();
        std::fs::write(base.join("notes/b.txt"), "needle in text\n").unwrap();
        std::fs::write(base.join(".git/c.md"), "needle in git\n").unwrap();

        let hits = collect(&base, "needle");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rel_path, "notes/a.md");
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].text, "Needle here");

        let hits = collect(&base, "needle in text");
        assert!(hits.is_empty());

        std::fs::remove_dir_all(&base).unwrap();
    }
}
