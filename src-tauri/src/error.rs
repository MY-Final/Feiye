use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// 面向前端的错误：序列化为 `{ code, message }`。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("尚未打开工作区")]
    NoWorkspace,
    #[error("路径不合法：{0}")]
    InvalidPath(String),
    #[error("路径超出工作区范围")]
    OutsideWorkspace,
    #[error("文件或目录不存在：{0}")]
    NotFound(String),
    #[error("目标已存在：{0}")]
    AlreadyExists(String),
    #[error("文件已被其他程序修改，未写入")]
    Conflict,
    #[error("文件不是有效的 UTF-8 文本")]
    NotUtf8,
    #[error("{0}")]
    Io(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NoWorkspace => "no-workspace",
            AppError::InvalidPath(_) => "invalid-path",
            AppError::OutsideWorkspace => "outside-workspace",
            AppError::NotFound(_) => "not-found",
            AppError::AlreadyExists(_) => "already-exists",
            AppError::Conflict => "conflict",
            AppError::NotUtf8 => "not-utf8",
            AppError::Io(_) => "io",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}
