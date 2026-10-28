use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use percent_encoding::percent_decode_str;
use tauri::http::header::{CACHE_CONTROL, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use tauri::http::{Request, Response, StatusCode};

/// 单张图片上限，避免误把大文件读进内存。
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

/// 只开放常见位图格式；SVG 可携带脚本，暂不开放。
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageError {
    BadRequest,
    Forbidden,
    NotFound,
    TooLarge,
    Unsupported,
}

impl ImageError {
    fn status(self) -> StatusCode {
        match self {
            ImageError::BadRequest => StatusCode::BAD_REQUEST,
            ImageError::Forbidden => StatusCode::FORBIDDEN,
            ImageError::NotFound => StatusCode::NOT_FOUND,
            ImageError::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            ImageError::Unsupported => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        }
    }
}

#[derive(Debug)]
pub struct ImageFile {
    pub path: PathBuf,
    pub content_type: &'static str,
    pub etag: String,
}

fn content_type(extension: &str) -> Option<&'static str> {
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

/// 解析请求路径并做完整的安全校验。
///
/// `raw_path` 是 URI 中未解码的路径片段；解码后必须是工作区内的绝对路径，
/// 扩展名在白名单内，且不超过大小上限。
pub fn load_image(root: Option<&Path>, raw_path: &str) -> Result<ImageFile, ImageError> {
    let root = root.ok_or(ImageError::Forbidden)?;
    let root = dunce::canonicalize(root).map_err(|_| ImageError::Forbidden)?;

    let decoded = percent_decode_str(raw_path)
        .decode_utf8()
        .map_err(|_| ImageError::BadRequest)?;
    let decoded = decoded.as_ref();

    if decoded.is_empty() || decoded.contains('\0') {
        return Err(ImageError::BadRequest);
    }

    let requested = Path::new(decoded);
    if !requested.is_absolute() {
        return Err(ImageError::BadRequest);
    }

    let extension = requested
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(ImageError::Unsupported)?;

    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(ImageError::Unsupported);
    }

    let canonical = dunce::canonicalize(requested).map_err(|_| ImageError::NotFound)?;
    if !canonical.starts_with(&root) {
        return Err(ImageError::Forbidden);
    }

    let metadata = fs::metadata(&canonical).map_err(|_| ImageError::NotFound)?;
    if !metadata.is_file() {
        return Err(ImageError::NotFound);
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(ImageError::TooLarge);
    }

    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    Ok(ImageFile {
        path: canonical,
        content_type: content_type(&extension).ok_or(ImageError::Unsupported)?,
        etag: format!("\"{modified}-{}\"", metadata.len()),
    })
}

pub fn respond(root: Option<PathBuf>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let raw = request.uri().path().trim_start_matches('/');

    let image = match load_image(root.as_deref(), raw) {
        Ok(image) => image,
        Err(error) => return error_response(error),
    };

    let not_modified = request
        .headers()
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == image.etag);

    if not_modified {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(ETAG, &image.etag)
            .header(CACHE_CONTROL, "no-cache")
            .body(Vec::new())
            .expect("valid 304 response");
    }

    let bytes = match fs::read(&image.path) {
        Ok(bytes) => bytes,
        Err(_) => return error_response(ImageError::NotFound),
    };

    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return error_response(ImageError::TooLarge);
    }

    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, image.content_type)
        .header("X-Content-Type-Options", "nosniff")
        .header(CACHE_CONTROL, "no-cache")
        .header(ETAG, &image.etag)
        .header("Content-Length", bytes.len())
        .body(bytes)
        .expect("valid image response")
}

fn error_response(error: ImageError) -> Response<Vec<u8>> {
    let message = match error {
        ImageError::BadRequest => "bad request",
        ImageError::Forbidden => "forbidden",
        ImageError::NotFound => "not found",
        ImageError::TooLarge => "too large",
        ImageError::Unsupported => "unsupported media type",
    };

    Response::builder()
        .status(error.status())
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header("X-Content-Type-Options", "nosniff")
        .body(message.as_bytes().to_vec())
        .expect("valid error response")
}

#[cfg(test)]
mod tests {
    use super::*;
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};

    fn encode(path: &Path) -> String {
        utf8_percent_encode(&path.to_string_lossy(), NON_ALPHANUMERIC).to_string()
    }

    #[test]
    fn serves_an_image_inside_the_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        let file = root.join("photo.png");
        fs::write(&file, [0x89, b'P', b'N', b'G']).unwrap();

        let image = load_image(Some(&root), &encode(&file)).unwrap();
        assert_eq!(image.content_type, "image/png");
        assert!(image.etag.starts_with('"'));
    }

    #[test]
    fn accepts_chinese_and_space_in_names() {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        let file = root.join("我的 图 片.JPG");
        fs::write(&file, [0xff, 0xd8, 0xff]).unwrap();

        let image = load_image(Some(&root), &encode(&file)).unwrap();
        assert_eq!(image.content_type, "image/jpeg");
    }

    #[test]
    fn rejects_paths_outside_the_workspace() {
        let root_dir = tempfile::tempdir().unwrap();
        let other_dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(root_dir.path()).unwrap();
        let outside = dunce::canonicalize(other_dir.path()).unwrap().join("a.png");
        fs::write(&outside, [1, 2, 3]).unwrap();

        assert_eq!(
            load_image(Some(&root), &encode(&outside)).unwrap_err(),
            ImageError::Forbidden
        );
    }

    #[test]
    fn rejects_unsupported_extensions() {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        let file = root.join("notes.txt");
        fs::write(&file, b"x").unwrap();

        assert_eq!(
            load_image(Some(&root), &encode(&file)).unwrap_err(),
            ImageError::Unsupported
        );
    }

    #[test]
    fn rejects_oversized_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        let file = root.join("huge.png");
        let handle = fs::File::create(&file).unwrap();
        handle.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        drop(handle);

        assert_eq!(
            load_image(Some(&root), &encode(&file)).unwrap_err(),
            ImageError::TooLarge
        );
    }

    #[test]
    fn rejects_requests_without_a_workspace() {
        assert_eq!(
            load_image(None, "C%3A%5Cphoto.png").unwrap_err(),
            ImageError::Forbidden
        );
    }

    #[test]
    fn rejects_relative_and_missing_paths() {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();

        assert_eq!(
            load_image(Some(&root), "photo.png").unwrap_err(),
            ImageError::BadRequest
        );

        let missing = root.join("missing.png");
        assert_eq!(
            load_image(Some(&root), &encode(&missing)).unwrap_err(),
            ImageError::NotFound
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let root_dir = tempfile::tempdir().unwrap();
        let other_dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(root_dir.path()).unwrap();
        let outside = dunce::canonicalize(other_dir.path()).unwrap().join("a.png");
        fs::write(&outside, [1, 2, 3]).unwrap();

        let link = root.join("link.png");
        symlink(&outside, &link).unwrap();

        assert_eq!(
            load_image(Some(&root), &encode(&link)).unwrap_err(),
            ImageError::Forbidden
        );
    }
}
