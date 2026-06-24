//! 结构化诊断（行号、片段等）；解析器落地后在此集中输出。
#![allow(dead_code)]

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub message: String,
}

impl Diagnostic {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}
