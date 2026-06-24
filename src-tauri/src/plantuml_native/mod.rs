//! 纯 Rust PlantUML 渲染路径：解析 → IR → 布局 → SVG（渐进覆盖；JAR 路径见 `plantuml_runtime`）。
//!
//! - **语法子集与验证门禁**：仓库根目录 `docs/plans/2026-04-05-001-feat-rust-plantuml-engine-plan.md` 附录 A、C。
//! - **契约样例**：crate 内 `tests/fixtures/plantuml_sequence/*.puml`（由 `plan_fixture_tests` 加载）。
//! - **新图表类型**：见同计划附录 B；在 `ir::DiagramKind` 登记意图后，增加 `parse/<kind>/` 与布局/SVG 子模块，再接通入口分发。

mod diagnostics;
mod limits;

#[cfg(test)]
mod plan_fixture_tests;

pub mod ir;
pub mod layout;
pub mod parse;
pub mod svg;

/// Rust 引擎侧错误；在 Tauri 边界可 `format!("{e}")` 与现有 `Result<_, String>` 对齐。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeError {
    InputTooLong {
        max_bytes: usize,
        actual_bytes: usize,
    },
    ForbiddenDirective {
        detail: String,
    },
    /// 子集外语法或后续里程碑能力。
    #[allow(dead_code)]
    Unsupported {
        detail: String,
    },
    /// 解析失败（行号为 1-based，与编辑器一致）。
    Parse {
        line: usize,
        detail: String,
    },
    /// 布局资源超限或其它几何错误。
    Layout {
        detail: String,
    },
    /// 已立项但尚未实现的图表类型或能力。
    #[allow(dead_code)]
    NotImplemented {
        message: &'static str,
    },
}

impl std::fmt::Display for NativeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NativeError::InputTooLong {
                max_bytes,
                actual_bytes,
            } => write!(
                f,
                "PlantUML 源码过长（{actual_bytes} 字节，上限 {max_bytes}）"
            ),
            NativeError::ForbiddenDirective { detail } => write!(f, "{detail}"),
            NativeError::Unsupported { detail } => write!(f, "{detail}"),
            NativeError::Parse { line, detail } => {
                write!(f, "第 {line} 行: {detail}")
            }
            NativeError::Layout { detail } => write!(f, "{detail}"),
            NativeError::NotImplemented { message } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for NativeError {}

/// 稳定文案：未来支持多图类型时，非序列图可走此分支。
#[allow(dead_code)]
pub const NOT_IMPLEMENTED_SEQUENCE_MSG: &str =
    "Rust 引擎尚未实现序列图渲染；请改用 JAR 后端或等待后续版本。";

fn check_render_budget(start: std::time::Instant) -> Result<(), NativeError> {
    let ms = start.elapsed().as_millis() as u64;
    if ms > limits::RUST_RENDER_BUDGET_MS {
        return Err(NativeError::Layout {
            detail: format!(
                "Rust 渲染超过时间预算（{ms} ms，上限 {} ms）",
                limits::RUST_RENDER_BUDGET_MS
            ),
        });
    }
    Ok(())
}

/// Rust 渲染产物（可选告警，供 IDE / Tauri 后续接线）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustRenderReport {
    pub svg: String,
    pub warnings: Vec<String>,
}

/// 探测 PlantUML 图类型（与前端 PlantUMLParser.ts 对齐的启发式规则）。
/// 注意：此为初步实现，未来可扩展更完善的探测逻辑。
pub fn detect_diagram_kind(source: &str) -> ir::DiagramKind {
    let body = extract_body(source);

    // 序列图与组件图混用（如 participant + `[A]-->[B]`）：优先组件图，避免误判为序列图。
    let body_lower = body.to_lowercase();
    let has_sequence_kw =
        body_lower.contains("participant ") || body_lower.contains("actor ");
    let looks_component_edge =
        body.contains('[') && body.contains(']') && (body.contains("-->") || body.contains("->"));
    if has_sequence_kw && looks_component_edge {
        return ir::DiagramKind::Component;
    }

    // 组件图检测：必须放在序列图之前（都含关键字如 component）
    // [Component] 语法（包括 [Component] { 块语法）
    if body.contains('[') && body.contains(']') {
        // 如果包含方括号，检查是否有箭头或组件关键字
        if body.contains("-->") || body.contains("..") || body.contains("component ") || body.contains("database ") {
            return ir::DiagramKind::Component;
        }
        // 即使没有箭头，如果行中有 [Name] { 也是组件图
        if body.contains("] {") || body.contains("]\n") {
            return ir::DiagramKind::Component;
        }
    }
    if body.contains("component ") || body.contains("database ") {
        return ir::DiagramKind::Component;
    }

    // 序列图检测
    if body.contains("participant ") || body.contains("actor ") {
        return ir::DiagramKind::Sequence;
    }
    if body.contains("->") && body.contains(':') {
        return ir::DiagramKind::Sequence;
    }

    // 默认按序列图处理（向后兼容）
    ir::DiagramKind::Sequence
}

/// 提取 @startuml 与 @enduml 之间的内容。
fn extract_body(source: &str) -> String {
    let mut in_body = false;
    let mut result = String::new();
    for line in source.lines() {
        let t = line.trim();
        if t.eq_ignore_ascii_case("@startuml") {
            in_body = true;
            continue;
        }
        if t.eq_ignore_ascii_case("@enduml") {
            break;
        }
        if in_body {
            if !result.is_empty() {
                result.push('\n');
            }
            result.push_str(line);
        }
    }
    result
}

/// 入口：限额与预扫描 → 图类型探测 → 相应解析 → 布局 → SVG。
pub fn try_render_rust(source: &str) -> Result<String, NativeError> {
    let r = try_render_rust_with_report(source)?;
    for w in &r.warnings {
        eprintln!("{w}");
    }
    Ok(r.svg)
}

/// 与 [`try_render_rust`] 相同渲染路径，但额外返回组件图解析阶段的告警（序列图路径告警为空）。
pub fn try_render_rust_with_report(source: &str) -> Result<RustRenderReport, NativeError> {
    let start = std::time::Instant::now();
    limits::enforce_input_limits(source)?;
    limits::enforce_line_byte_limits(source)?;
    limits::prescan_source(source)?;
    check_render_budget(start)?;

    let kind = detect_diagram_kind(source);

    match kind {
        ir::DiagramKind::Sequence => {
            let ir = parse::parse_sequence_diagram(source)?;
            check_render_budget(start)?;
            let geom = layout::plan_sequence(&ir)?;
            check_render_budget(start)?;
            let svg = svg::render_sequence_svg(&ir, &geom);
            check_render_budget(start)?;
            Ok(RustRenderReport {
                svg,
                warnings: Vec::new(),
            })
        }
        ir::DiagramKind::Component => {
            let mut warnings = Vec::new();
            let ir = parse::parse_component_diagram_with_warnings(source, &mut warnings)?;
            check_render_budget(start)?;
            let geom = layout::plan_component(&ir)?;
            check_render_budget(start)?;
            let svg = svg::render_component_svg(&ir, &geom);
            check_render_budget(start)?;
            Ok(RustRenderReport { svg, warnings })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::limits::MAX_SOURCE_BYTES;
    use super::*;

    #[test]
    fn minimal_empty_diagram_renders_svg() {
        let src = "@startuml\n@enduml";
        let svg = try_render_rust(src).expect("svg");
        assert!(svg.contains("<svg"));
        assert!(svg.contains("xmlns="));
    }

    #[test]
    fn simple_sequence_renders_message_text() {
        let src = "@startuml\nA -> B : hi\n@enduml";
        let svg = try_render_rust(src).expect("svg");
        assert!(svg.contains("<svg"));
        assert!(svg.contains("hi"), "{svg}");
    }

    #[test]
    fn sequence_with_frontend_theme_line_renders() {
        let src = "@startuml\n!theme mars\nAlice -> Bob : ping\n@enduml";
        let svg = try_render_rust(src).expect("svg");
        assert!(svg.contains("ping"), "{svg}");
    }

    #[test]
    fn oversize_fails_at_limits_not_not_implemented() {
        let s = "x".repeat(MAX_SOURCE_BYTES + 1);
        let e = try_render_rust(&s).unwrap_err();
        assert!(matches!(e, NativeError::InputTooLong { .. }));
    }

    #[test]
    fn include_fails_before_not_implemented() {
        let e = try_render_rust("!include a\n@startuml\n@enduml").unwrap_err();
        assert!(matches!(e, NativeError::ForbiddenDirective { .. }));
    }

    #[test]
    fn component_diagram_renders_svg() {
        let src = "@startuml\n[Web] --> [DB]\n@enduml";
        let svg = try_render_rust(src).expect("svg");
        assert!(svg.contains("<svg"), "{svg}");
        assert!(svg.contains("Web"), "{svg}");
        assert!(svg.contains("DB"), "{svg}");
    }

    #[test]
    fn component_block_renders_with_edges() {
        let src = "@startuml\n[日历应用] {\n[数据层]\n[业务层]\n}\n@enduml";
        let svg = try_render_rust(src).expect("svg");
        // 嵌套容器不显示边,通过嵌套表示父子关系
        assert!(svg.contains("日历应用"), "{}", svg);
        assert!(svg.contains("数据层"), "{}", svg);
        assert!(svg.contains("业务层"), "{}", svg);
    }

    #[test]
    fn component_diagram_with_interface_renders() {
        let src = "@startuml\n(API) --> [Server]\n@enduml";
        let svg = try_render_rust(src).expect("svg");
        assert!(svg.contains("<svg"), "{svg}");
        assert!(svg.contains("API"), "{svg}");
        assert!(svg.contains("Server"), "{svg}");
    }

    #[test]
    fn detect_diagram_kind_component() {
        use crate::plantuml_native::ir::DiagramKind;
        let src = "@startuml\n[A] --> [B]\n@enduml";
        assert_eq!(detect_diagram_kind(src), DiagramKind::Component);
    }

    #[test]
    fn detect_diagram_kind_sequence() {
        use crate::plantuml_native::ir::DiagramKind;
        let src = "@startuml\nA -> B : msg\n@enduml";
        assert_eq!(detect_diagram_kind(src), DiagramKind::Sequence);
    }

    #[test]
    fn detect_diagram_kind_mixed_prefers_component() {
        use crate::plantuml_native::ir::DiagramKind;
        let src = "@startuml\nparticipant P\n[B] --> [C]\n@enduml";
        assert_eq!(detect_diagram_kind(src), DiagramKind::Component);
    }

    #[test]
    fn try_render_rust_with_report_collects_component_warnings() {
        let src = "@startuml\n[Z]\nfoo unknown line\n@enduml";
        let r = try_render_rust_with_report(src).expect("ok");
        assert!(r.warnings.iter().any(|w| w.contains("未识别")));
        assert!(r.svg.contains("<svg"));
    }
}
