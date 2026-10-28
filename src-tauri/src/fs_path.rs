use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

/// 文件树中展示的 Markdown 扩展名（小写）。
pub const MARKDOWN_EXTENSIONS: [&str; 3] = ["md", "markdown", "mdx"];

/// 扫描文件树时直接跳过的目录。
pub const IGNORED_DIRS: [&str; 4] = [".git", "node_modules", "target", "dist"];

/// Windows 保留设备名，不能作为文件名。
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 把前端传来的相对路径规范化为 `/` 分隔、无 `..`、无绝对前缀的形式。
/// 根目录返回空字符串。
pub fn normalize_rel(rel: &str) -> Result<String, AppError> {
    if rel.contains('\0') {
        return Err(AppError::InvalidPath("路径包含非法字符".into()));
    }

    let unified = rel.replace('\\', "/");
    let path = Path::new(&unified);
    let mut parts: Vec<String> = Vec::new();

    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_string_lossy();
                if part.is_empty() {
                    continue;
                }
                parts.push(part.into_owned());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::InvalidPath("路径不能包含 ..".into()));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::InvalidPath("不允许使用绝对路径".into()));
            }
        }
    }

    Ok(parts.join("/"))
}

/// 把相对路径拼到工作区根目录，并确认解析后的真实路径仍在工作区内。
pub fn resolve_in_workspace(root: &Path, rel: &str) -> Result<PathBuf, AppError> {
    let clean = normalize_rel(rel)?;
    let joined = if clean.is_empty() {
        root.to_path_buf()
    } else {
        root.join(&clean)
    };

    // 目标可能尚不存在（新建），因此对最近的已存在祖先做规范化，
    // 这样既能阻止符号链接逃逸，也不会因为目标不存在而失败。
    let mut probe: &Path = joined.as_path();
    loop {
        if probe.exists() {
            break;
        }
        probe = probe
            .parent()
            .ok_or_else(|| AppError::InvalidPath("无法解析路径".into()))?;
    }

    let canonical = dunce::canonicalize(probe)
        .map_err(|err| AppError::InvalidPath(format!("无法解析路径：{err}")))?;

    if !canonical.starts_with(root) {
        return Err(AppError::OutsideWorkspace);
    }

    Ok(joined)
}

/// 校验用户输入的文件/目录名。
pub fn validate_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::InvalidPath("名称不能为空".into()));
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(AppError::InvalidPath("名称不能包含路径分隔符".into()));
    }
    if name == "." || name == ".." {
        return Err(AppError::InvalidPath("名称不合法".into()));
    }
    if name.starts_with('.') {
        return Err(AppError::InvalidPath("名称不能以 . 开头".into()));
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err(AppError::InvalidPath(
            "名称不能以空格或句点结尾".into(),
        ));
    }

    let stem = name.split('.').next().unwrap_or_default().to_ascii_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(AppError::InvalidPath("名称是系统保留名".into()));
    }

    Ok(())
}

pub fn is_markdown(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 拼接子项的相对路径，统一使用 `/`。
pub fn join_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// 取父目录的相对路径；根目录的父目录仍为空。
pub fn parent_rel(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_relative_paths() {
        assert_eq!(normalize_rel("").unwrap(), "");
        assert_eq!(normalize_rel(".").unwrap(), "");
        assert_eq!(normalize_rel("./notes/a.md").unwrap(), "notes/a.md");
        assert_eq!(normalize_rel("notes\\a.md").unwrap(), "notes/a.md");
        assert_eq!(normalize_rel("notes//a.md").unwrap(), "notes/a.md");
    }

    #[test]
    fn rejects_escapes() {
        assert!(normalize_rel("../secret.md").is_err());
        assert!(normalize_rel("notes/../../secret.md").is_err());
        assert!(normalize_rel("C:\\Windows\\a.md").is_err());
        assert!(normalize_rel("\\\\server\\share\\a.md").is_err());
        assert!(normalize_rel("/etc/passwd").is_err());
    }

    #[test]
    fn validates_names() {
        assert!(validate_name("a.md").is_ok());
        assert!(validate_name("未命名.md").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("a/b.md").is_err());
        assert!(validate_name(".hidden.md").is_err());
        assert!(validate_name("CON.md").is_err());
        assert!(validate_name("a.md.").is_err());
    }

    #[test]
    fn detects_markdown() {
        assert!(is_markdown("a.md"));
        assert!(is_markdown("a.MD"));
        assert!(is_markdown("a.markdown"));
        assert!(is_markdown("a.mdx"));
        assert!(!is_markdown("a.txt"));
        assert!(!is_markdown("md"));
    }

    #[test]
    fn joins_and_splits_relative_paths() {
        assert_eq!(join_rel("", "a.md"), "a.md");
        assert_eq!(join_rel("notes", "a.md"), "notes/a.md");
        assert_eq!(parent_rel("notes/a.md"), "notes");
        assert_eq!(parent_rel("a.md"), "");
    }

    #[test]
    fn resolve_rejects_parent_dir_escape() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        assert!(resolve_in_workspace(&root, "../x.md").is_err());
        assert!(resolve_in_workspace(&root, "a/../../x.md").is_err());
        assert!(resolve_in_workspace(&root, "a.md").is_ok());
    }
}
