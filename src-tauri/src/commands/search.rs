//! 工作区全文搜索：递归扫描 Markdown，按行返回命中位置。

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

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

/// 当前查询代号。前端每次发起查询前推进一次；旧查询发现代号对不上就提前退出。
/// 只做原子读写，不持锁读盘，不会挡住其它命令。
#[derive(Default)]
pub struct SearchState(AtomicU64);

impl SearchState {
    /// 推进代号并返回新值；返回后旧查询在下一次检查时即失效。
    fn bump(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn generation(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// 一次搜索的返回值：`cancelled` 为真表示结果返回前已发起新查询，前端应直接丢弃。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub cancelled: bool,
}

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

/// 递归扫描。`cancelled` 在每个文件 / 子目录前检查一次，返回 true 表示本次查询已被
/// 新查询取代，调用方应丢弃结果；返回值即「是否取消」。
fn walk(
    dir: &Path,
    rel: &str,
    needle: &str,
    limit: usize,
    cancelled: &dyn Fn() -> bool,
    hits: &mut Vec<SearchHit>,
) -> bool {
    if hits.len() >= limit {
        return false;
    }
    if cancelled() {
        return true;
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return false,
    };

    for item in entries.flatten() {
        if hits.len() >= limit {
            return false;
        }
        // 用户在连续输入：每个文件之前看一眼代号，旧扫描不必跑完全库。
        if cancelled() {
            return true;
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
            if walk(&item.path(), &child_rel, needle, limit, cancelled, hits) {
                return true;
            }
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
                return false;
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
    false
}

/// 推进搜索代号：前端在每次新查询前调用，旧查询会在下一个文件前退出。
#[tauri::command]
pub fn next_search_generation(state: State<'_, SearchState>) -> u64 {
    state.bump()
}

#[tauri::command]
pub fn search_workspace(
    query: String,
    limit: Option<u32>,
    generation: u64,
    state: State<'_, WorkspaceState>,
    search: State<'_, SearchState>,
) -> Result<SearchResponse, AppError> {
    let root = state.root()?;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(SearchResponse {
            hits: Vec::new(),
            cancelled: false,
        });
    }
    let limit = limit
        .map(|value| value as usize)
        .unwrap_or(MAX_HITS)
        .clamp(1, MAX_HITS);

    let mut hits = Vec::new();
    let cancelled = walk(
        &root,
        "",
        &needle,
        limit,
        &|| generation != search.generation(),
        &mut hits,
    );
    Ok(SearchResponse {
        hits: if cancelled { Vec::new() } else { hits },
        cancelled,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{frontmatter_end, preview, walk, SearchHit, SearchState};

    fn collect(dir: &std::path::Path, needle: &str) -> Vec<SearchHit> {
        let mut hits = Vec::new();
        assert!(!walk(dir, "", needle, 200, &|| false, &mut hits));
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

    #[test]
    fn walk_stops_after_cancel() {
        let base = std::env::temp_dir().join(format!("feiye-search-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        for name in ["a.md", "b.md", "c.md"] {
            std::fs::write(base.join(name), "needle\n").unwrap();
        }

        // 未取消：三篇都命中。
        assert_eq!(collect(&base, "needle").len(), 3);

        // 第一次检查即返回「已取消」：不读任何文件，结果为空。
        let mut hits = Vec::new();
        let calls = AtomicUsize::new(0);
        let cancelled = walk(
            &base,
            "",
            "needle",
            200,
            &|| {
                calls.fetch_add(1, Ordering::SeqCst);
                true
            },
            &mut hits,
        );
        assert!(cancelled);
        assert!(hits.is_empty());
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn stale_generation_cancels_search_state() {
        let base = std::env::temp_dir().join(format!("feiye-search-gen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("a.md"), "needle\n").unwrap();

        let state = SearchState::default();
        let stale = state.bump();
        assert_eq!(stale, 1);

        // 代号未推进：检查函数始终为 false，正常返回结果。
        let mut hits = Vec::new();
        assert!(!walk(&base, "", "needle", 200, &|| stale != state.generation(), &mut hits));
        assert_eq!(hits.len(), 1);

        // 新查询推进代号后，旧代号立刻失效；再用旧代号检查即视为取消。
        assert_eq!(state.bump(), 2);
        assert_ne!(state.generation(), stale);
        let mut hits = Vec::new();
        assert!(walk(&base, "", "needle", 200, &|| stale != state.generation(), &mut hits));
        assert!(hits.is_empty());

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn cancel_checked_per_file_not_per_line() {
        // 大数据量下检查频率只与文件数相关：这里记录检查次数，避免每次都做
        // 不必要的原子读（与 DOS 攻击无关，主要是省 CPU 抖动）。
        let base = std::env::temp_dir().join(format!("feiye-search-freq-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let body = "line\n".repeat(50);
        std::fs::write(base.join("a.md"), &body).unwrap();

        let calls = AtomicUsize::new(0);
        let mut hits = Vec::new();
        assert!(!walk(&base, "", "line", 200, &|| {
            calls.fetch_add(1, Ordering::SeqCst);
            false
        }, &mut hits));
        // 根目录 + 一个文件：2 次检查，而不是每行一次。
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(hits.len(), 50);

        std::fs::remove_dir_all(&base).unwrap();
    }
}
