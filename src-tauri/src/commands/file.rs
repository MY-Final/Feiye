use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use super::workspace::{Entry, WorkspaceState};
use crate::error::AppError;
use crate::fs_path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub modified_ms: u64,
    pub size: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn strip_bom(bytes: Vec<u8>) -> Vec<u8> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes[3..].to_vec()
    } else {
        bytes
    }
}

fn ensure_markdown(path: &Path) -> Result<(), AppError> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if fs_path::is_markdown(&name) {
        Ok(())
    } else {
        Err(AppError::InvalidPath("只支持 Markdown 文件".into()))
    }
}

fn read_path(path: &Path) -> Result<FileContent, AppError> {
    let meta = fs::metadata(path).map_err(|_| AppError::NotFound(path.display().to_string()))?;
    if !meta.is_file() {
        return Err(AppError::InvalidPath("目标不是文件".into()));
    }

    let bytes = strip_bom(fs::read(path)?);
    let content = String::from_utf8(bytes).map_err(|_| AppError::NotUtf8)?;

    Ok(FileContent {
        content,
        modified_ms: mtime_ms(&meta),
        size: meta.len(),
    })
}

fn write_path(path: &Path, content: &str, expected_ms: Option<u64>) -> Result<FileMeta, AppError> {
    if let Some(expected) = expected_ms {
        let meta = fs::metadata(path).map_err(|_| AppError::Conflict)?;
        if mtime_ms(&meta) != expected {
            return Err(AppError::Conflict);
        }
    }

    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath("无法确定文件所在目录".into()))?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_path = parent.join(format!(".feiye-tmp-{}-{nonce}", std::process::id()));

    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // Windows 上 std::fs::rename 使用 MoveFileExW(REPLACE_EXISTING)，
        // 可以在同一卷内原子替换已存在的文件。
        fs::rename(&temp_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result?;

    let meta = fs::metadata(path)?;
    Ok(FileMeta {
        modified_ms: mtime_ms(&meta),
        size: meta.len(),
    })
}

fn create_in(root: &Path, parent_rel: &str, name: &str) -> Result<Entry, AppError> {
    fs_path::validate_name(name)?;
    if !fs_path::is_markdown(name) {
        return Err(AppError::InvalidPath("文件名必须以 .md 结尾".into()));
    }

    let parent = fs_path::resolve_in_workspace(root, parent_rel)?;
    if !parent.is_dir() {
        return Err(AppError::NotFound(format!("目录不存在：{parent_rel}")));
    }

    let clean_parent = fs_path::normalize_rel(parent_rel)?;
    let path = parent.join(name);
    if path.exists() {
        return Err(AppError::AlreadyExists(fs_path::join_rel(
            &clean_parent,
            name,
        )));
    }

    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;

    Ok(Entry {
        name: name.to_string(),
        rel_path: fs_path::join_rel(&clean_parent, name),
        is_dir: false,
    })
}

fn create_folder_in(root: &Path, parent_rel: &str, name: &str) -> Result<Entry, AppError> {
    fs_path::validate_name(name)?;

    let parent = fs_path::resolve_in_workspace(root, parent_rel)?;
    if !parent.is_dir() {
        return Err(AppError::NotFound(format!("目录不存在：{parent_rel}")));
    }

    let clean_parent = fs_path::normalize_rel(parent_rel)?;
    let path = parent.join(name);
    if path.exists() {
        return Err(AppError::AlreadyExists(fs_path::join_rel(
            &clean_parent,
            name,
        )));
    }

    fs::create_dir(&path)?;

    Ok(Entry {
        name: name.to_string(),
        rel_path: fs_path::join_rel(&clean_parent, name),
        is_dir: true,
    })
}

/// 校验并返回「在资源管理器中显示」的目标；只接受工作区内已存在的路径。
fn reveal_target(root: &Path, rel: &str) -> Result<std::path::PathBuf, AppError> {
    let path = fs_path::resolve_in_workspace(root, rel)?;
    if !path.exists() {
        return Err(AppError::NotFound(if rel.is_empty() {
            root.display().to_string()
        } else {
            rel.to_string()
        }));
    }
    Ok(path)
}

fn rename_in(root: &Path, rel: &str, new_name: &str) -> Result<Entry, AppError> {
    let clean = fs_path::normalize_rel(rel)?;
    if clean.is_empty() {
        return Err(AppError::InvalidPath("不能重命名工作区根目录".into()));
    }

    fs_path::validate_name(new_name)?;

    let source = fs_path::resolve_in_workspace(root, &clean)?;
    let meta = fs::symlink_metadata(&source).map_err(|_| AppError::NotFound(clean.clone()))?;
    if meta.file_type().is_symlink() {
        return Err(AppError::InvalidPath("不支持操作符号链接".into()));
    }

    let is_dir = meta.is_dir();
    if !is_dir && !fs_path::is_markdown(new_name) {
        return Err(AppError::InvalidPath("文件名必须以 .md 结尾".into()));
    }

    let parent_rel = fs_path::parent_rel(&clean);
    let parent = source
        .parent()
        .ok_or_else(|| AppError::InvalidPath("无法确定文件所在目录".into()))?;
    let target = parent.join(new_name);

    if target.exists() {
        // Windows / macOS 的文件系统不区分大小写：只改大小写时
        // target 指向的正是源文件本身，不该报「已存在」。
        let same_file = target
            .canonicalize()
            .ok()
            .zip(source.canonicalize().ok())
            .is_some_and(|(a, b)| a == b);
        if !same_file {
            return Err(AppError::AlreadyExists(fs_path::join_rel(
                parent_rel, new_name,
            )));
        }
    }

    fs::rename(&source, &target)?;

    Ok(Entry {
        name: new_name.to_string(),
        rel_path: fs_path::join_rel(parent_rel, new_name),
        is_dir,
    })
}

/// 把文件 / 文件夹移到另一个目录下；文件名保持不变。
/// 目标目录必须在工作区内且确实存在，目录不能移进自己里面。
fn move_in(root: &Path, rel: &str, new_parent: &str) -> Result<Entry, AppError> {
    let clean = fs_path::normalize_rel(rel)?;
    if clean.is_empty() {
        return Err(AppError::InvalidPath("不能移动工作区根目录".into()));
    }

    let parent_rel = fs_path::normalize_rel(new_parent)?;
    let source = fs_path::resolve_in_workspace(root, &clean)?;
    let meta = fs::symlink_metadata(&source).map_err(|_| AppError::NotFound(clean.clone()))?;
    if meta.file_type().is_symlink() {
        return Err(AppError::InvalidPath("不支持操作符号链接".into()));
    }

    // 把文件夹拖进它自己或它的子目录，会让整棵子树从工作区里消失。
    if !parent_rel.is_empty()
        && (parent_rel == clean || parent_rel.starts_with(&format!("{clean}/")))
    {
        return Err(AppError::InvalidPath("不能把文件夹移动到它自己里面".into()));
    }

    let parent_dir = if parent_rel.is_empty() {
        root.to_path_buf()
    } else {
        fs_path::resolve_in_workspace(root, &parent_rel)?
    };
    let parent_meta = fs::metadata(&parent_dir)
        .map_err(|_| AppError::NotFound(parent_rel.clone()))?;
    if !parent_meta.is_dir() {
        return Err(AppError::InvalidPath("目标不是文件夹".into()));
    }

    let is_dir = meta.is_dir();
    let rel_parent = fs_path::parent_rel(&clean);
    let name = clean[rel_parent.len()..].trim_start_matches('/').to_string();
    let target = parent_dir.join(&name);
    let target_rel = fs_path::join_rel(&parent_rel, &name);

    if target.exists() {
        let same_file = target
            .canonicalize()
            .ok()
            .zip(source.canonicalize().ok())
            .is_some_and(|(a, b)| a == b);
        if !same_file {
            return Err(AppError::AlreadyExists(target_rel));
        }
        // 拖回原来的目录：什么都不用做。
        return Ok(Entry {
            name,
            rel_path: target_rel,
            is_dir,
        });
    }

    fs::rename(&source, &target)?;

    Ok(Entry {
        name,
        rel_path: target_rel,
        is_dir,
    })
}

fn delete_in(root: &Path, rel: &str) -> Result<(), AppError> {
    let clean = fs_path::normalize_rel(rel)?;
    if clean.is_empty() {
        return Err(AppError::InvalidPath("不能删除工作区根目录".into()));
    }

    let path = fs_path::resolve_in_workspace(root, &clean)?;
    let meta = fs::symlink_metadata(&path).map_err(|_| AppError::NotFound(clean.clone()))?;

    if meta.file_type().is_symlink() {
        return fs::remove_file(&path).map_err(AppError::from);
    }

    // 优先移到系统回收站，避免误删无法恢复。
    trash::delete(&path).map_err(|err| AppError::Io(format!("移到回收站失败：{err}")))
}

#[tauri::command]
pub fn read_file(
    rel_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<FileContent, AppError> {
    let root = state.root()?;
    let path = fs_path::resolve_in_workspace(&root, &rel_path)?;
    ensure_markdown(&path)?;
    read_path(&path)
}

#[tauri::command]
pub fn write_file(
    rel_path: String,
    content: String,
    expected_modified_ms: Option<u64>,
    state: State<'_, WorkspaceState>,
) -> Result<FileMeta, AppError> {
    let root = state.root()?;
    let path = fs_path::resolve_in_workspace(&root, &rel_path)?;
    ensure_markdown(&path)?;
    write_path(&path, &content, expected_modified_ms)
}

/// 导出 HTML 落盘：工作区内、只允许 `.html`、不覆盖已有文件、沿用原子写。
fn export_to(root: &Path, rel: &str, content: &str) -> Result<FileMeta, AppError> {
    let path = fs_path::resolve_in_workspace(root, rel)?;
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();
    if !ext.eq_ignore_ascii_case("html") {
        return Err(AppError::InvalidPath("导出文件必须以 .html 结尾".into()));
    }
    if path.exists() {
        return Err(AppError::AlreadyExists(fs_path::normalize_rel(rel)?));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath("无法确定导出目录".into()))?;
    if !parent.is_dir() {
        return Err(AppError::NotFound(
            fs_path::parent_rel(&fs_path::normalize_rel(rel)?).to_string(),
        ));
    }
    write_path(&path, content, None)
}

#[tauri::command]
pub fn export_html(
    rel_path: String,
    content: String,
    state: State<'_, WorkspaceState>,
) -> Result<FileMeta, AppError> {
    let root = state.root()?;
    export_to(&root, &rel_path, &content)
}

#[tauri::command]
pub fn create_file(
    parent_rel_path: String,
    name: String,
    state: State<'_, WorkspaceState>,
) -> Result<Entry, AppError> {
    let root = state.root()?;
    create_in(&root, &parent_rel_path, &name)
}

#[tauri::command]
pub fn create_folder(
    parent_rel_path: String,
    name: String,
    state: State<'_, WorkspaceState>,
) -> Result<Entry, AppError> {
    let root = state.root()?;
    create_folder_in(&root, &parent_rel_path, &name)
}

#[tauri::command]
pub fn reveal_entry(rel_path: String, state: State<'_, WorkspaceState>) -> Result<(), AppError> {
    let root = state.root()?;
    let path = reveal_target(&root, &rel_path)?;
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|err| AppError::Io(format!("无法打开资源管理器：{err}")))
}

#[tauri::command]
pub fn rename_entry(
    rel_path: String,
    new_name: String,
    state: State<'_, WorkspaceState>,
) -> Result<Entry, AppError> {
    let root = state.root()?;
    rename_in(&root, &rel_path, &new_name)
}

#[tauri::command]
pub fn move_entry(
    rel_path: String,
    new_parent: String,
    state: State<'_, WorkspaceState>,
) -> Result<Entry, AppError> {
    let root = state.root()?;
    move_in(&root, &rel_path, &new_parent)
}

#[tauri::command]
pub fn delete_entry(rel_path: String, state: State<'_, WorkspaceState>) -> Result<(), AppError> {
    let root = state.root()?;
    delete_in(&root, &rel_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn workspace() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        (temp, root)
    }

    #[test]
    fn reads_and_strips_bom() {
        let (_temp, root) = workspace();
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("# 标题".as_bytes());
        fs::write(root.join("a.md"), bytes).unwrap();

        let content = read_path(&root.join("a.md")).unwrap();
        assert_eq!(content.content, "# 标题");
        assert_eq!(content.size, 3 + "# 标题".len() as u64);
    }

    #[test]
    fn writes_atomically_and_detects_conflict() {
        let (_temp, root) = workspace();
        let path = root.join("a.md");
        fs::write(&path, "old").unwrap();

        let first = read_path(&path).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let saved = write_path(&path, "new", Some(first.modified_ms)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(saved.size, 3);

        // 使用过期 mtime 再次写入应被拒绝。
        let stale = write_path(&path, "clobber", Some(first.modified_ms));
        assert!(matches!(stale, Err(AppError::Conflict)));
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");

        // 文件在外部被改动后，携带旧 mtime 的保存同样应冲突。
        let before = read_path(&path).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&path, "external").unwrap();
        assert!(matches!(
            write_path(&path, "x", Some(before.modified_ms)),
            Err(AppError::Conflict)
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }

    #[test]
    fn creates_only_markdown_without_overwriting() {
        let (_temp, root) = workspace();
        let entry = create_in(&root, "", "新文章.md").unwrap();
        assert_eq!(entry.rel_path, "新文章.md");
        assert!(root.join("新文章.md").is_file());

        assert!(matches!(
            create_in(&root, "", "新文章.md"),
            Err(AppError::AlreadyExists(_))
        ));
        assert!(create_in(&root, "", "a.txt").is_err());
        assert!(create_in(&root, "", "../escape.md").is_err());
    }

    #[test]
    fn creates_folders_and_files_inside_them() {
        let (_temp, root) = workspace();
        let folder = create_folder_in(&root, "", "01_笔记").unwrap();
        assert!(folder.is_dir);
        assert_eq!(folder.rel_path, "01_笔记");
        assert!(root.join("01_笔记").is_dir());

        let nested = create_folder_in(&root, "01_笔记", "01_子目录").unwrap();
        assert_eq!(nested.rel_path, "01_笔记/01_子目录");

        let file = create_in(&root, "01_笔记/01_子目录", "a.md").unwrap();
        assert_eq!(file.rel_path, "01_笔记/01_子目录/a.md");
        assert!(root.join("01_笔记/01_子目录/a.md").is_file());

        assert!(matches!(
            create_folder_in(&root, "", "01_笔记"),
            Err(AppError::AlreadyExists(_))
        ));
        assert!(create_folder_in(&root, "", "bad/name").is_err());
        assert!(create_folder_in(&root, "", "..").is_err());
        assert!(create_folder_in(&root, "missing", "x").is_err());
    }

    #[test]
    fn resolves_reveal_targets_inside_workspace() {
        let (_temp, root) = workspace();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::create_dir(root.join("sub")).unwrap();

        assert_eq!(reveal_target(&root, "").unwrap(), root);
        assert_eq!(reveal_target(&root, "a.md").unwrap(), root.join("a.md"));
        assert_eq!(reveal_target(&root, "sub").unwrap(), root.join("sub"));
        assert!(matches!(
            reveal_target(&root, "missing.md"),
            Err(AppError::NotFound(_))
        ));
        assert!(reveal_target(&root, "../escape").is_err());
    }

    #[test]
    fn renames_within_directory() {
        let (_temp, root) = workspace();
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/a.md"), "a").unwrap();

        let entry = rename_in(&root, "notes/a.md", "b.md").unwrap();
        assert_eq!(entry.rel_path, "notes/b.md");
        assert!(root.join("notes/b.md").is_file());
        assert!(!root.join("notes/a.md").exists());

        assert!(rename_in(&root, "notes/b.md", "c.txt").is_err());
        assert!(rename_in(&root, "notes/b.md", "../c.md").is_err());
    }

    #[test]
    fn moves_entries_between_directories() {
        let (_temp, root) = workspace();
        fs::create_dir(root.join("inbox")).unwrap();
        fs::create_dir(root.join("archive")).unwrap();
        fs::write(root.join("inbox/a.md"), "a").unwrap();
        fs::create_dir(root.join("inbox/sub")).unwrap();

        let entry = move_in(&root, "inbox/a.md", "archive").unwrap();
        assert_eq!(entry.rel_path, "archive/a.md");
        assert!(root.join("archive/a.md").is_file());
        assert!(!root.join("inbox/a.md").exists());

        let folder = move_in(&root, "inbox/sub", "").unwrap();
        assert_eq!(folder.rel_path, "sub");
        assert!(folder.is_dir);
        assert!(root.join("sub").is_dir());

        // 拖回原目录是空操作；同名目标要被拦下。
        assert_eq!(
            move_in(&root, "archive/a.md", "archive").unwrap().rel_path,
            "archive/a.md"
        );
        fs::write(root.join("inbox/a.md"), "again").unwrap();
        assert!(matches!(
            move_in(&root, "inbox/a.md", "archive"),
            Err(AppError::AlreadyExists(_))
        ));
        // 目录不能移进它自己或子目录，也不能移出工作区。
        fs::create_dir(root.join("sub/child")).unwrap();
        assert!(move_in(&root, "sub", "sub").is_err());
        assert!(move_in(&root, "sub", "sub/child").is_err());
        assert!(move_in(&root, "sub", "../outside").is_err());
        assert!(move_in(&root, "missing.md", "archive").is_err());
    }

    #[test]
    fn rejects_operations_outside_workspace() {
        let (_temp, root) = workspace();
        assert!(read_file_path(&root, "../a.md").is_err());
        assert!(write_file_path(&root, "../a.md").is_err());
    }

    #[test]
    fn exports_html_inside_workspace_only() {
        let (_temp, root) = workspace();
        let meta = export_to(&root, "笔记.html", "<p>hi</p>").unwrap();
        assert!(meta.size > 0);
        assert_eq!(
            fs::read_to_string(root.join("笔记.html")).unwrap(),
            "<p>hi</p>"
        );
        // 只允许 .html。
        assert!(export_to(&root, "笔记.md", "x").is_err());
        assert!(export_to(&root, "笔记", "x").is_err());
        // 不允许逃出工作区。
        assert!(export_to(&root, "../逃逸.html", "x").is_err());
        // 已有文件不覆盖。
        assert!(matches!(
            export_to(&root, "笔记.html", "y"),
            Err(AppError::AlreadyExists(_))
        ));
        assert_eq!(
            fs::read_to_string(root.join("笔记.html")).unwrap(),
            "<p>hi</p>"
        );
        // 子目录内可写，目录不存在则拒绝。
        fs::create_dir(root.join("导出")).unwrap();
        assert!(export_to(&root, "导出/a.html", "z").is_ok());
        assert!(export_to(&root, "缺失/a.html", "z").is_err());
    }

    fn read_file_path(root: &Path, rel: &str) -> Result<FileContent, AppError> {
        let path = fs_path::resolve_in_workspace(root, rel)?;
        read_path(&path)
    }

    fn write_file_path(root: &Path, rel: &str) -> Result<FileMeta, AppError> {
        let path = fs_path::resolve_in_workspace(root, rel)?;
        write_path(&path, "x", None)
    }
}
