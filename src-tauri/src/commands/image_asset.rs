use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::commands::workspace::WorkspaceState;
use crate::error::AppError;
use crate::fs_path;

/// 与图片读取通道保持一致的单张图片上限。
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

/// 复制 HTML 时内联单张图片的上限；超过则保留原地址，避免剪贴板过大。
const INLINE_MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAsset {
    /// 工作区相对路径，用于文件树/调试。
    pub rel_path: String,
    /// 相对当前文档目录的 Markdown 图片地址。
    pub markdown_path: String,
}

fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if brand == b"avif" || brand == b"avis" {
            return Some("avif");
        }
    }
    None
}

fn sanitize_base_name(raw: &str) -> String {
    let mut name: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(64)
        .collect();
    if name.is_empty() {
        name.push_str("image");
    }
    name
}

fn unique_path(dir: &Path, base: &str, extension: &str) -> Result<PathBuf, AppError> {
    for index in 0..10_000u32 {
        let name = if index == 0 {
            format!("{base}.{extension}")
        } else {
            format!("{base}-{index}.{extension}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::AlreadyExists("无法为图片生成唯一文件名".into()))
}

fn save_asset_in(
    root: &Path,
    doc_rel: &str,
    data: &str,
    base_name: &str,
) -> Result<ImageAsset, AppError> {
    let clean = fs_path::normalize_rel(doc_rel)?;
    if clean.is_empty() || !fs_path::is_markdown(&clean) {
        return Err(AppError::InvalidPath("当前文档不是 Markdown 文件".into()));
    }

    let encoded = data.trim();
    // base64 约为原始字节的 4/3；先按长度拒绝，避免解码超大内容。
    if encoded.len() > MAX_IMAGE_BYTES / 3 * 4 + 8 {
        return Err(AppError::InvalidPath("图片超过 16 MB 上限".into()));
    }

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| AppError::InvalidPath("图片数据不合法".into()))?;
    if decoded.is_empty() {
        return Err(AppError::InvalidPath("图片内容为空".into()));
    }
    if decoded.len() > MAX_IMAGE_BYTES {
        return Err(AppError::InvalidPath("图片超过 16 MB 上限".into()));
    }

    let extension = sniff_extension(&decoded).ok_or_else(|| {
        AppError::InvalidPath("只支持 PNG、JPEG、GIF、WebP、AVIF 与 BMP 图片".into())
    })?;

    let doc_path = fs_path::resolve_in_workspace(root, &clean)?;
    let parent = doc_path
        .parent()
        .ok_or_else(|| AppError::InvalidPath("无法确定文档所在目录".into()))?;

    let assets_dir = parent.join("assets");
    fs::create_dir_all(&assets_dir)?;
    let canonical_assets = dunce::canonicalize(&assets_dir)
        .map_err(|error| AppError::Io(format!("无法创建图片目录：{error}")))?;
    if !canonical_assets.starts_with(root) {
        return Err(AppError::OutsideWorkspace);
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let base = sanitize_base_name(base_name);
    let base = if base == "image" {
        format!("{base}-{now}")
    } else {
        base
    };

    let path = unique_path(&canonical_assets, &base, extension)?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::InvalidPath("无法确定图片文件名".into()))?;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    if let Err(error) = file.write_all(&decoded).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(AppError::Io(format!("写入图片失败：{error}")));
    }

    let parent_rel = fs_path::parent_rel(&clean);
    Ok(ImageAsset {
        rel_path: fs_path::join_rel(&fs_path::join_rel(parent_rel, "assets"), &file_name),
        markdown_path: format!("assets/{file_name}"),
    })
}

#[tauri::command]
pub fn save_image_asset(
    rel_path: String,
    data: String,
    base_name: String,
    state: State<'_, WorkspaceState>,
) -> Result<ImageAsset, AppError> {
    let root = state.root()?;
    save_asset_in(&root, &rel_path, &data, &base_name)
}

fn inline_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

/// 读取工作区内的一张图片并编码成 data URL；不存在、格式不支持或超过 4 MB 时返回 None。
fn data_url_in(root: &Path, rel: &str) -> Result<Option<String>, AppError> {
    let clean = fs_path::normalize_rel(rel)?;
    let path = fs_path::resolve_in_workspace(root, &clean)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let mime = match extension.as_deref().and_then(inline_mime) {
        Some(mime) => mime,
        None => return Ok(None),
    };
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(None),
    };
    if !metadata.is_file() || metadata.len() > INLINE_MAX_BYTES {
        return Ok(None);
    }
    let bytes = fs::read(&path)?;
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )))
}

/// 把工作区内的图片读成 data URL，供「复制 HTML」内联，应用外也能显示。
#[tauri::command]
pub fn read_image_data_url(
    rel_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<Option<String>, AppError> {
    let root = state.root()?;
    data_url_in(&root, &rel_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;

    fn workspace() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        (temp, root)
    }

    #[test]
    fn stores_png_next_to_document_and_returns_relative_path() {
        let (_temp, root) = workspace();
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/a.md"), "# a").unwrap();

        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        let asset = save_asset_in(&root, "notes/a.md", &STANDARD.encode(png), "image-1").unwrap();

        assert_eq!(asset.markdown_path, "assets/image-1.png");
        assert_eq!(asset.rel_path, "notes/assets/image-1.png");
        assert!(root.join("notes/assets/image-1.png").is_file());
    }

    #[test]
    fn never_overwrites_an_existing_image() {
        let (_temp, root) = workspace();
        fs::write(root.join("a.md"), "# a").unwrap();

        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1];
        let first = save_asset_in(&root, "a.md", &STANDARD.encode(png), "image-1").unwrap();
        let second = save_asset_in(&root, "a.md", &STANDARD.encode(png), "image-1").unwrap();

        assert_eq!(first.markdown_path, "assets/image-1.png");
        assert_eq!(second.markdown_path, "assets/image-1-1.png");
    }

    #[test]
    fn inlines_small_images_and_skips_large_or_unsupported() {
        let (_temp, root) = workspace();
        fs::write(root.join("pic.png"), [0x89, b'P', b'N', b'G', 1, 2]).unwrap();
        let url = data_url_in(&root, "pic.png").unwrap().unwrap();
        assert!(url.starts_with("data:image/png;base64,"));

        fs::write(root.join("note.txt"), b"text").unwrap();
        assert!(data_url_in(&root, "note.txt").unwrap().is_none());
        assert!(data_url_in(&root, "missing.png").unwrap().is_none());

        fs::write(root.join("big.png"), vec![0u8; INLINE_MAX_BYTES as usize + 1]).unwrap();
        assert!(data_url_in(&root, "big.png").unwrap().is_none());
        assert!(data_url_in(&root, "../pic.png").is_err());
    }

    #[test]
    fn rejects_invalid_data_and_paths() {
        let (_temp, root) = workspace();
        assert!(save_asset_in(&root, "a.md", "not base64!", "x").is_err());
        assert!(save_asset_in(&root, "../a.md", &STANDARD.encode(b"x"), "x").is_err());
        assert!(save_asset_in(&root, "a.txt", &STANDARD.encode(b"x"), "x").is_err());
        assert!(save_asset_in(&root, "a.md", &STANDARD.encode(b"not an image"), "x").is_err());
    }
}
