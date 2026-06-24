//! 输入长度与预扫描策略（`!include`、危险片段等）。
//!
//! 数值与计划 `Deferred 定案` 一致：`MAX_SOURCE_BYTES`、`MAX_LINE_BYTES`、`RUST_RENDER_BUDGET_MS`。

use super::NativeError;

/// 单段 PlantUML 源码最大字节数（UTF-8）；与 IPC 载荷及解析预算对齐，可调。
pub const MAX_SOURCE_BYTES: usize = 1_048_576;

/// 单行最大字节数（UTF-8），防止极端长行拖慢解析与 IPC。
pub const MAX_LINE_BYTES: usize = 16_384;

/// `try_render_rust` _wall-clock_ 总预算（毫秒）；超时返回 [`NativeError::Layout`]。
pub const RUST_RENDER_BUDGET_MS: u64 = 2_000;

/// 去掉行内 `'` 起头的 PlantUML 注释后缀后，再用于指令扫描。
fn strip_line_comment_prefix(line: &str) -> &str {
    line.split('\'').next().unwrap_or("").trim()
}

/// 拒绝 `!include` / `!import`、嵌入 `<img>` 等（与计划 R4 一致；宁可误报不误放行）。
pub fn prescan_source(source: &str) -> Result<(), NativeError> {
    for line in source.lines() {
        let probe = strip_line_comment_prefix(line);
        if probe.is_empty() {
            continue;
        }
        let lower = probe.to_ascii_lowercase();
        if lower.contains("!include") {
            return Err(NativeError::ForbiddenDirective {
                detail: "不支持 !include / !includeurl（安全策略）".into(),
            });
        }
        if lower.contains("!import") {
            return Err(NativeError::ForbiddenDirective {
                detail: "不支持 !import（安全策略）".into(),
            });
        }
        if lower.contains("<img") {
            return Err(NativeError::ForbiddenDirective {
                detail: "不支持嵌入 <img>（安全策略）".into(),
            });
        }
    }
    Ok(())
}

pub fn enforce_input_limits(source: &str) -> Result<(), NativeError> {
    let len = source.len();
    if len > MAX_SOURCE_BYTES {
        return Err(NativeError::InputTooLong {
            max_bytes: MAX_SOURCE_BYTES,
            actual_bytes: len,
        });
    }
    Ok(())
}

/// 单行 UTF-8 字节数上限（与 `Deferred 定案` 一致）。
pub fn enforce_line_byte_limits(source: &str) -> Result<(), NativeError> {
    for (idx, line) in source.lines().enumerate() {
        let n = line.len();
        if n > MAX_LINE_BYTES {
            return Err(NativeError::Parse {
                line: idx + 1,
                detail: format!("单行过长（{n} 字节，上限 {MAX_LINE_BYTES}）"),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_input_rejected_without_partial_render() {
        let s = "a".repeat(MAX_SOURCE_BYTES + 1);
        let e = enforce_input_limits(&s).unwrap_err();
        match e {
            NativeError::InputTooLong { .. } => {}
            other => panic!("expected InputTooLong, got {other:?}"),
        }
    }

    #[test]
    fn include_rejected() {
        let err = prescan_source("@startuml\n!include foo.puml\n@enduml").unwrap_err();
        match err {
            NativeError::ForbiddenDirective { detail } => {
                assert!(detail.contains("!include"), "{detail}");
            }
            other => panic!("expected ForbiddenDirective, got {other:?}"),
        }
    }

    #[test]
    fn import_rejected() {
        let err = prescan_source("!import x").unwrap_err();
        assert!(matches!(err, NativeError::ForbiddenDirective { .. }));
    }

    #[test]
    fn img_rejected() {
        let err = prescan_source("A -> B : <img src=x>").unwrap_err();
        assert!(matches!(err, NativeError::ForbiddenDirective { .. }));
    }

    #[test]
    fn comment_line_skipped_for_include_token() {
        // 整行注释中的字面量不应触发（行首 ' 注释常见）
        assert!(prescan_source("' !include fake\n@startuml\n@enduml").is_ok());
    }

    #[test]
    fn line_too_long_errors_with_line_number() {
        let long = "x".repeat(MAX_LINE_BYTES + 1);
        let src = format!("@startuml\n{long}\n@enduml");
        let e = enforce_line_byte_limits(&src).unwrap_err();
        match e {
            NativeError::Parse { line, .. } => assert_eq!(line, 2),
            other => panic!("expected Parse, got {other:?}"),
        }
    }
}
