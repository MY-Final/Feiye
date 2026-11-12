//! 工作区全文搜索：递归扫描 Markdown，按行返回命中位置。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

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
/// 缓存占用上限（按内容字节数粗算）。大库只缓存最近用到的部分，不把内存吃满。
const CACHE_MAX_BYTES: usize = 64 * 1024 * 1024;

/// 一篇已读取的文件：原文行用于预览，小写行用于匹配，行号即下标。
#[derive(Clone)]
struct Doc {
    raw: Arc<Vec<String>>,
    lower: Arc<Vec<String>>,
}

struct CachedDoc {
    mtime: u64,
    size: u64,
    bytes: usize,
    last_used: u64,
    raw: Arc<Vec<String>>,
    lower: Arc<Vec<String>>,
}

/// 进程内的搜索缓存。读盘在锁外进行，只有查表与插入短暂持锁。
#[derive(Default)]
struct CacheInner {
    docs: HashMap<PathBuf, CachedDoc>,
    bytes: usize,
    clock: u64,
}

/// 当前查询代号 + 文件缓存。代号只做原子读写，前端每次查询前推进；
/// 缓存只在文件 mtime / size 都未变时复用，避免重复读盘与小写转换。
#[derive(Default)]
pub struct SearchState {
    generation: AtomicU64,
    cache: Mutex<CacheInner>,
}

impl SearchState {
    /// 推进代号并返回新值；返回后旧查询在下一次检查时即失效。
    fn bump(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    fn lookup(&self, path: &Path, mtime: u64, size: u64) -> Option<Doc> {
        self.cache.lock().ok()?.lookup(path, mtime, size)
    }

    fn store(&self, path: &Path, mtime: u64, size: u64, doc: &Doc) {
        if let Ok(mut inner) = self.cache.lock() {
            inner.insert(path, mtime, size, doc);
        }
    }

    /// 本次扫描完整走完后，丢掉这个工作区里已删除文件留下的缓存。
    fn prune(&self, root: &Path, seen: &HashSet<PathBuf>) {
        if let Ok(mut inner) = self.cache.lock() {
            inner.retain_seen(root, seen);
        }
    }
}

/// 文件的版本标记：修改时间（毫秒）；取不到就用大小作退路。
fn file_stamp(meta: &fs::Metadata) -> (u64, u64) {
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as u64)
        .unwrap_or(size);
    (mtime, size)
}

/// 缓存项是否仍对应当前文件：mtime 与 size 都没变才复用。
fn is_fresh(cached_mtime: u64, cached_size: u64, mtime: u64, size: u64) -> bool {
    cached_mtime == mtime && cached_size == size
}

/// 容量超限时按「最久未使用」挑出要淘汰的路径，直到占用降到上限以内。
fn pick_evictions(mut entries: Vec<(PathBuf, usize, u64)>, mut bytes: usize, max: usize) -> Vec<PathBuf> {
    if bytes <= max {
        return Vec::new();
    }
    entries.sort_by_key(|(_, _, used)| *used);
    let mut evicted = Vec::new();
    for (path, size, _) in entries {
        if bytes <= max {
            break;
        }
        bytes = bytes.saturating_sub(size);
        evicted.push(path);
    }
    evicted
}

impl CacheInner {
    fn lookup(&mut self, path: &Path, mtime: u64, size: u64) -> Option<Doc> {
        let entry = self.docs.get_mut(path)?;
        if !is_fresh(entry.mtime, entry.size, mtime, size) {
            return None;
        }
        self.clock += 1;
        entry.last_used = self.clock;
        Some(Doc {
            raw: entry.raw.clone(),
            lower: entry.lower.clone(),
        })
    }

    fn insert(&mut self, path: &Path, mtime: u64, size: u64, doc: &Doc) {
        let bytes = doc.raw.iter().map(|line| line.len()).sum::<usize>()
            + doc.lower.iter().map(|line| line.len()).sum::<usize>();
        // 单篇就超上限：不缓存，避免把别的条目全淘汰光。
        if bytes > CACHE_MAX_BYTES {
            return;
        }
        if let Some(old) = self.docs.remove(path) {
            self.bytes = self.bytes.saturating_sub(old.bytes);
        }
        self.clock += 1;
        self.docs.insert(
            path.to_path_buf(),
            CachedDoc {
                mtime,
                size,
                bytes,
                last_used: self.clock,
                raw: doc.raw.clone(),
                lower: doc.lower.clone(),
            },
        );
        self.bytes += bytes;
        if self.bytes > CACHE_MAX_BYTES {
            let entries = self
                .docs
                .iter()
                .map(|(path, doc)| (path.clone(), doc.bytes, doc.last_used))
                .collect();
            for path in pick_evictions(entries, self.bytes, CACHE_MAX_BYTES) {
                if let Some(old) = self.docs.remove(&path) {
                    self.bytes = self.bytes.saturating_sub(old.bytes);
                }
            }
        }
    }

    /// 只保留 `seen` 里的文件；别的目录（其它工作区）不动。
    fn retain_seen(&mut self, root: &Path, seen: &HashSet<PathBuf>) {
        let mut removed = 0usize;
        self.docs.retain(|path, doc| {
            if path.starts_with(root) && !seen.contains(path) {
                removed += doc.bytes;
                false
            } else {
                true
            }
        });
        self.bytes = self.bytes.saturating_sub(removed);
    }
}

/// 取一篇文件的小写行内容：缓存新鲜就复用，否则读盘并按新内容更新缓存。
fn cached_doc(cache: &SearchState, path: &Path, mtime: u64, size: u64) -> Option<Doc> {
    if let Some(doc) = cache.lookup(path, mtime, size) {
        return Some(doc);
    }
    let content = fs::read_to_string(path).ok()?;
    let raw: Vec<String> = content.lines().map(str::to_string).collect();
    let lower: Vec<String> = raw.iter().map(|line| line.to_lowercase()).collect();
    let doc = Doc {
        raw: Arc::new(raw),
        lower: Arc::new(lower),
    };
    cache.store(path, mtime, size, &doc);
    Some(doc)
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
    cache: &SearchState,
    seen: &mut HashSet<PathBuf>,
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
            if walk(
                &item.path(),
                &child_rel,
                needle,
                limit,
                cancelled,
                cache,
                seen,
                hits,
            ) {
                return true;
            }
            continue;
        }
        if !file_type.is_file() || !fs_path::is_markdown(&name) {
            continue;
        }
        let meta = match item.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }

        let (mtime, size) = file_stamp(&meta);
        let path = item.path();
        seen.insert(path.clone());
        // 未变的文件直接复用缓存（原文 + 小写行），不重复读盘。
        let doc = match cached_doc(cache, &path, mtime, size) {
            Some(doc) => doc,
            // 非 UTF-8 / 读取失败：跳过这一篇，不影响别的结果。
            None => continue,
        };

        // 开头的 frontmatter 不参与命中，但行号仍按原文计算，点击能落到正确位置。
        let raw: Vec<&str> = doc.raw.iter().map(String::as_str).collect();
        let skip = frontmatter_end(&raw);
        for (index, line) in doc.lower.iter().enumerate().skip(skip) {
            if hits.len() >= limit {
                return false;
            }
            if line.contains(needle) {
                hits.push(SearchHit {
                    rel_path: child_rel.clone(),
                    line: index as u32 + 1,
                    text: preview(&doc.raw[index]),
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
    let mut seen = HashSet::new();
    let cancelled = walk(
        &root,
        "",
        &needle,
        limit,
        &|| generation != search.generation(),
        &search,
        &mut seen,
        &mut hits,
    );
    // 只有完整走完一遍才清理缓存，避免命中上限提前结束时误删没访问到的条目。
    if !cancelled && hits.len() < limit {
        search.prune(&root, &seen);
    }
    Ok(SearchResponse {
        hits: if cancelled { Vec::new() } else { hits },
        cancelled,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::{
        cached_doc, file_stamp, frontmatter_end, pick_evictions, preview, walk, CacheInner, Doc,
        SearchHit, SearchState,
    };

    fn collect(dir: &std::path::Path, needle: &str) -> Vec<SearchHit> {
        let mut hits = Vec::new();
        let cache = SearchState::default();
        let mut seen = HashSet::new();
        assert!(!walk(
            dir,
            "",
            needle,
            200,
            &|| false,
            &cache,
            &mut seen,
            &mut hits
        ));
        hits
    }

    fn doc_of(text: &str) -> Doc {
        let raw: Vec<String> = text.lines().map(str::to_string).collect();
        let lower: Vec<String> = raw.iter().map(|line| line.to_lowercase()).collect();
        Doc {
            raw: Arc::new(raw),
            lower: Arc::new(lower),
        }
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
        let mut seen = HashSet::new();
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
            &SearchState::default(),
            &mut seen,
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
        let mut seen = HashSet::new();
        assert!(!walk(
            &base,
            "",
            "needle",
            200,
            &|| stale != state.generation(),
            &state,
            &mut seen,
            &mut hits
        ));
        assert_eq!(hits.len(), 1);

        // 新查询推进代号后，旧代号立刻失效；再用旧代号检查即视为取消。
        assert_eq!(state.bump(), 2);
        assert_ne!(state.generation(), stale);
        let mut hits = Vec::new();
        assert!(walk(
            &base,
            "",
            "needle",
            200,
            &|| stale != state.generation(),
            &state,
            &mut seen,
            &mut hits
        ));
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
        let mut seen = HashSet::new();
        assert!(!walk(&base, "", "line", 200, &|| {
            calls.fetch_add(1, Ordering::SeqCst);
            false
        }, &SearchState::default(), &mut seen, &mut hits));
        // 根目录 + 一个文件：2 次检查，而不是每行一次。
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(hits.len(), 50);

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn cache_reuses_unchanged_file() {
        let base = std::env::temp_dir().join(format!("feiye-search-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let path = base.join("a.md");
        std::fs::write(&path, "Hello\nworld\n").unwrap();

        let (mtime, size) = file_stamp(&std::fs::metadata(&path).unwrap());
        let cache = SearchState::default();

        // 首次：缓存没有，读盘。
        let first = cached_doc(&cache, &path, mtime, size).unwrap();
        assert_eq!(*first.lower, vec!["hello".to_string(), "world".to_string()]);

        // 磁盘内容变了但版本标记没变：命中缓存，不重新读盘。
        std::fs::write(&path, "changed\n").unwrap();
        let second = cached_doc(&cache, &path, mtime, size).unwrap();
        assert_eq!(*second.lower, vec!["hello".to_string(), "world".to_string()]);
        assert!(Arc::ptr_eq(&first.lower, &second.lower));

        // mtime / size 变了：重读，得到新内容。
        let (mtime2, size2) = file_stamp(&std::fs::metadata(&path).unwrap());
        let third = cached_doc(&cache, &path, mtime2, size2).unwrap();
        assert_eq!(*third.lower, vec!["changed".to_string()]);

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn cache_drops_deleted_files() {
        let mut inner = CacheInner::default();
        inner.insert(Path::new("lib/a.md"), 1, 3, &doc_of("aa\n"));
        inner.insert(Path::new("lib/b.md"), 1, 3, &doc_of("bb\n"));
        inner.insert(Path::new("other/c.md"), 1, 3, &doc_of("cc\n"));

        let mut seen = HashSet::new();
        seen.insert(PathBuf::from("lib/a.md"));
        inner.retain_seen(Path::new("lib"), &seen);

        assert!(inner.lookup(Path::new("lib/a.md"), 1, 3).is_some());
        // 已删除（本次没扫到）：移除。
        assert!(inner.lookup(Path::new("lib/b.md"), 1, 3).is_none());
        // 别的工作区的条目不清理。
        assert!(inner.lookup(Path::new("other/c.md"), 1, 3).is_some());
    }

    #[test]
    fn evicts_least_recently_used_over_budget() {
        let entries = vec![
            (PathBuf::from("a.md"), 40usize, 1u64),
            (PathBuf::from("b.md"), 40, 3),
            (PathBuf::from("c.md"), 40, 2),
        ];
        // 没超上限：不淘汰。
        assert!(pick_evictions(entries.clone(), 80, 100).is_empty());
        // 超上限：按最近使用时间从旧到新淘汰，够用即停。
        assert_eq!(
            pick_evictions(entries, 120, 60),
            vec![PathBuf::from("a.md"), PathBuf::from("c.md")]
        );
    }

    #[test]
    fn cache_hit_keeps_original_case_in_preview() {
        let base = std::env::temp_dir().join(format!("feiye-search-case-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("a.md"), "Hello World\nhello\n").unwrap();

        let cache = SearchState::default();
        for _ in 0..2 {
            let mut hits = Vec::new();
            let mut seen = HashSet::new();
            assert!(!walk(
                &base,
                "",
                "world",
                200,
                &|| false,
                &cache,
                &mut seen,
                &mut hits
            ));
            // 第二次走缓存，命中文本仍保留原文大小写，行号不变。
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].line, 1);
            assert_eq!(hits[0].text, "Hello World");
        }

        std::fs::remove_dir_all(&base).unwrap();
    }
}
