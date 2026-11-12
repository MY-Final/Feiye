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

/// 去掉行尾空白后比较，首行的 BOM 也视作不存在。
fn is_fence(line: &str) -> bool {
    let bare = line.strip_prefix('\u{feff}').unwrap_or(line);
    bare.trim_end() == "---"
}

/// 文件开头 YAML frontmatter 占用的行数；没有或 500 行内无闭合则为 0。
/// 规则与前端预览 / 大纲一致：首行与闭合行都是 `---`。
fn frontmatter_end(lines: &[&str]) -> usize {
    if !lines.first().map(|line| is_fence(line)).unwrap_or(false) {
        return 0;
    }
    let last = lines.len().min(500);
    for (index, line) in lines.iter().enumerate().take(last).skip(1) {
        if is_fence(line) {
            return index + 1;
        }
    }
    0
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

        // 开头的 frontmatter 不参与命中，但行号仍按原文计算，点击能落到正确位置。
        let lines: Vec<&str> = content.lines().collect();
        let skip = frontmatter_end(&lines);
        for (index, line) in lines.iter().enumerate().skip(skip) {
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
    use super::{frontmatter_end, preview, walk, SearchHit};

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
    fn detects_frontmatter_end() {
        assert_eq!(frontmatter_end(&[]), 0);
        assert_eq!(frontmatter_end(&["a", "b"]), 0);
        assert_eq!(frontmatter_end(&["---", "title: x", "---", "body"]), 3);
        // 首行 BOM、闭合行行尾空白都不影响识别。
        assert_eq!(frontmatter_end(&["\u{feff}---", "title: x", "---  "]), 3);
        // CRLF 由 `str::lines` 去掉 `\r`。
        let crlf = "---\r\ntags: [写作]\r\n---\r\n正文\r\n";
        let lines: Vec<&str> = crlf.lines().collect();
        assert_eq!(frontmatter_end(&lines), 3);
        // 未闭合：当没有 frontmatter，不丢弃任何正文。
        assert_eq!(frontmatter_end(&["---", "title: x", "body"]), 0);
        // 首行不是 `---`：正文里的分隔线不误判。
        assert_eq!(frontmatter_end(&["intro", "---", "title: x", "---"]), 0);
        // 闭合行在第 500 行之外（第 501 行）视为未闭合。
        let mut long = vec!["---"];
        long.extend(std::iter::repeat("x").take(499));
        long.push("---");
        assert_eq!(frontmatter_end(&long), 0);
        // 恰在第 500 行闭合仍算。
        let mut edge = vec!["---"];
        edge.extend(std::iter::repeat("x").take(498));
        edge.push("---");
        assert_eq!(frontmatter_end(&edge), 500);
    }

    #[test]
    fn walk_skips_frontmatter_keeps_line_numbers() {
        let base = std::env::temp_dir().join(format!("feiye-search-fm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(
            base.join("a.md"),
            "---\ntags: [写作]\ntitle: 写作草稿\n---\n第一行\n写作在正文\n",
        )
        .unwrap();

        let hits = collect(&base, "写作");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 6);
        assert_eq!(hits[0].text, "写作在正文");

        assert!(collect(&base, "tags").is_empty());

        std::fs::remove_dir_all(&base).unwrap();
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
