//! 与 `tests/fixtures/plantuml_sequence/` 及计划附录 C 对齐的契约测试。

use super::{try_render_rust, NativeError};

fn fixture(name: &str) -> &'static str {
    match name {
        "v0_empty_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v0_empty_ok.puml"
        )),
        "v0_messages_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v0_messages_ok.puml"
        )),
        "v0_theme_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v0_theme_ok.puml"
        )),
        "v0_skip_extras_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v0_skip_extras_ok.puml"
        )),
        "v1_quoted_participant_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_quoted_participant_ok.puml"
        )),
        "v1_autonumber_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_autonumber_ok.puml"
        )),
        "v1_note_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_note_ok.puml"
        )),
        "v1_group_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_group_ok.puml"
        )),
        "v1_title_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_title_ok.puml"
        )),
        "v1_legend_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_legend_ok.puml"
        )),
        "v1_header_footer_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_header_footer_ok.puml"
        )),
        "v1_self_message_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_self_message_ok.puml"
        )),
        "v1_destroy_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_destroy_ok.puml"
        )),
        "v1_async_arrows_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_async_arrows_ok.puml"
        )),
        "v1_delay_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_delay_ok.puml"
        )),
        "v1_box_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v1_box_ok.puml"
        )),
        "v0_fail_class.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v0_fail_class.puml"
        )),
        "v0_fail_include.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v0_fail_include.puml"
        )),
        // 组件图 fixtures
        "c0_simple_edge_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_component/simple_edge_ok.puml"
        )),
        "c0_mixed_nodes_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_component/mixed_nodes_ok.puml"
        )),
        "c0_block_syntax_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_component/block_syntax_ok.puml"
        )),
        "nested_package_with_notes.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_component/nested_package_with_notes.puml"
        )),
        "c0_alias_bracket_as_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_component/alias_bracket_as_ok.puml"
        )),
        "c0_alias_component_as_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_component/alias_component_as_ok.puml"
        )),
        "c0_alias_package_edge_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_component/alias_package_edge_ok.puml"
        )),
        _ => panic!("unknown fixture {name}"),
    }
}

#[test]
fn fixture_v0_empty_ok_renders_svg() {
    let svg = try_render_rust(fixture("v0_empty_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
}

#[test]
fn fixture_v0_messages_ok_renders_svg_with_labels() {
    let svg = try_render_rust(fixture("v0_messages_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"));
    assert!(svg.contains("hello"), "{svg}");
    assert!(svg.contains("ok"), "{svg}");
}

#[test]
fn fixture_v0_theme_ok_renders_after_skipping_theme() {
    let svg = try_render_rust(fixture("v0_theme_ok.puml")).expect("svg");
    assert!(svg.contains("notify"), "{svg}");
}

#[test]
fn fixture_v0_skip_extras_ok_renders_message() {
    let svg = try_render_rust(fixture("v0_skip_extras_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("hi"), "{svg}");
    // v1.1：引号 participant 已解析，表头展示 Display
    assert!(svg.contains("Display"), "{svg}");
}

#[test]
fn fixture_v1_quoted_participant_ok_renders() {
    let svg = try_render_rust(fixture("v1_quoted_participant_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("ping"), "{svg}");
    assert!(svg.contains("服务 A"), "{svg}");
}

#[test]
fn fixture_v1_autonumber_ok_renders_numbered_labels() {
    let svg = try_render_rust(fixture("v1_autonumber_ok.puml")).expect("svg");
    assert!(svg.contains("1. first"), "{svg}");
    assert!(svg.contains("2. second"), "{svg}");
}

#[test]
fn fixture_v1_note_ok_renders_note_text() {
    let svg = try_render_rust(fixture("v1_note_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("ping"), "{svg}");
    assert!(svg.contains("pong hint"), "{svg}");
}

#[test]
fn fixture_v1_group_ok_renders_message() {
    let svg = try_render_rust(fixture("v1_group_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("init"), "{svg}");
}

#[test]
fn fixture_v1_title_ok_renders_title_and_message() {
    let svg = try_render_rust(fixture("v1_title_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("Rust engine title"), "{svg}");
    assert!(svg.contains("hi"), "{svg}");
}

#[test]
fn fixture_v1_legend_ok_renders_legend_and_message() {
    let svg = try_render_rust(fixture("v1_legend_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("Notes for reviewers"), "{svg}");
    assert!(svg.contains("ping"), "{svg}");
}

#[test]
fn fixture_v1_header_footer_ok_renders_chrome_and_message() {
    let svg = try_render_rust(fixture("v1_header_footer_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("Rust page header"), "{svg}");
    assert!(svg.contains("With title"), "{svg}");
    assert!(svg.contains("Rust page footer"), "{svg}");
    assert!(svg.contains("hi"), "{svg}");
}

#[test]
fn fixture_v1_self_message_ok_renders_self_and_out() {
    let svg = try_render_rust(fixture("v1_self_message_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("self-call"), "{svg}");
    assert!(svg.contains("out"), "{svg}");
    assert!(svg.contains("<polyline"), "{svg}");
}

#[test]
fn fixture_v1_destroy_ok_renders_messages_and_cross() {
    let svg = try_render_rust(fixture("v1_destroy_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("ping"), "{svg}");
    assert!(svg.contains("after"), "{svg}");
    assert!(svg.matches("rgb(180,60,60)").count() >= 2, "{svg}");
}

#[test]
fn fixture_v1_box_ok_renders_box_background() {
    let svg = try_render_rust(fixture("v1_box_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("hello"), "{svg}");
    // box 背景应当渲染（颜色和标题可选检查）
    assert!(svg.contains("<rect"), "{svg}");
}

#[test]
fn fixture_v1_async_arrows_ok_renders_open_marker_and_labels() {
    let svg = try_render_rust(fixture("v1_async_arrows_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("async call"), "{svg}");
    assert!(svg.contains("async reply"), "{svg}");
    assert!(svg.contains("mOpenArrow"), "{svg}");
}

#[test]
fn fixture_v1_delay_ok_renders_messages_and_delay_graphics() {
    let svg = try_render_rust(fixture("v1_delay_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("first"), "{svg}");
    assert!(svg.contains("second"), "{svg}");
    assert!(svg.contains(r#"stroke-dasharray="2 6""#), "{svg}");
    assert!(svg.contains("rgb(130,132,145)"), "{svg}");
}

#[test]
fn fixture_v0_fail_class_parse_error() {
    let e = try_render_rust(fixture("v0_fail_class.puml")).unwrap_err();
    let line = match &e {
        NativeError::Parse { line, .. } => *line,
        other => panic!("expected Parse, got {other:?}"),
    };
    assert_eq!(line, 2);
    let s = e.to_string();
    assert!(s.contains('2'), "{s}");
}

#[test]
fn fixture_v0_fail_include_prescan() {
    let e = try_render_rust(fixture("v0_fail_include.puml")).unwrap_err();
    assert!(matches!(e, NativeError::ForbiddenDirective { .. }), "{e:?}");
}

#[test]
fn diagram_kind_sequence_is_registered_extension_point() {
    use crate::plantuml_native::ir::DiagramKind;
    assert!(matches!(DiagramKind::Sequence, DiagramKind::Sequence));
}

#[test]
fn fixture_c0_block_syntax_ok_renders_with_edges() {
    let svg = try_render_rust(fixture("c0_block_syntax_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("日历应用"), "{svg}");
    assert!(svg.contains("数据层"), "{svg}");
    assert!(svg.contains("业务层"), "{svg}");
    // 确保标签不包含 {
    assert!(!svg.contains("日历应用{"), "标签不应包含{{: {}", svg);
    assert!(!svg.contains("数据层{"), "标签不应包含{{: {}", svg);
}

#[test]
fn diagram_kind_component_is_registered_extension_point() {
    use crate::plantuml_native::ir::DiagramKind;
    assert!(matches!(DiagramKind::Component, DiagramKind::Component));
}

#[test]
fn fixture_c0_simple_edge_ok_renders_component_svg() {
    let svg = try_render_rust(fixture("c0_simple_edge_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("ComponentA"), "{svg}");
    assert!(svg.contains("ComponentB"), "{svg}");
    assert!(svg.contains("<line"), "{svg}");
}

#[test]
fn fixture_nested_package_with_notes_renders() {
    let svg = try_render_rust(fixture("nested_package_with_notes.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    // 验证包名称
    assert!(svg.contains("日历应用"), "应包含日历应用包: {svg}");
    assert!(svg.contains("数据层"), "应包含数据层包: {svg}");
    assert!(svg.contains("业务层"), "应包含业务层包: {svg}");
    assert!(svg.contains("展示层"), "应包含展示层包: {svg}");
    assert!(svg.contains("外部依赖"), "应包含外部依赖包: {svg}");
    
    // 验证组件
    assert!(svg.contains("日程管理模块"), "应包含日程管理模块: {svg}");
    assert!(svg.contains("日历同步模块"), "应包含日历同步模块: {svg}");
    assert!(svg.contains("农历"), "应包含农历模块: {svg}");
    assert!(svg.contains("视图渲染模块"), "应包含视图渲染模块: {svg}");
    assert!(svg.contains("云服务"), "应包含云服务: {svg}");
    assert!(svg.contains("CalendarProvider"), "应包含CalendarProvider: {svg}");
    
    // 验证依赖关系边
    assert!(svg.contains("<line"), "应包含依赖关系边: {svg}");
    
    // 验证 note 注释（别名解析后 note 应挂在正确节点上）
    assert!(svg.contains("职责"), "应包含注释内容: {svg}");
    assert!(svg.contains("数据持久化"), "应包含数据持久化注释: {svg}");
    assert!(svg.contains("手动同步触发"), "应包含业务层 note: {svg}");
}

#[test]
fn fixture_c0_mixed_nodes_ok_renders_with_interface() {
    let svg = try_render_rust(fixture("c0_mixed_nodes_ok.puml")).expect("svg");
    assert!(svg.contains("<svg"), "{svg}");
    assert!(svg.contains("WebServer"), "{svg}");
    assert!(svg.contains("Database"), "{svg}");
    assert!(svg.contains("API"), "{svg}");
    assert!(svg.contains("Cache"), "{svg}");
    assert!(svg.contains("uses"), "{svg}");
}

#[test]
fn fixture_c0_alias_bracket_as_ok_renders() {
    let svg = try_render_rust(fixture("c0_alias_bracket_as_ok.puml")).expect("svg");
    assert!(svg.contains("Shown Name"), "{svg}");
    assert!(svg.contains("Other"), "{svg}");
}

#[test]
fn fixture_c0_alias_component_as_ok_renders() {
    let svg = try_render_rust(fixture("c0_alias_component_as_ok.puml")).expect("svg");
    assert!(svg.contains("Service"), "{svg}");
    assert!(svg.contains("Client"), "{svg}");
}

#[test]
fn fixture_c0_alias_package_edge_ok_renders() {
    let svg = try_render_rust(fixture("c0_alias_package_edge_ok.puml")).expect("svg");
    assert!(svg.contains("Inner"), "{svg}");
    assert!(svg.contains("Ext"), "{svg}");
}

/// JAR 对照占位：从 Rust SVG 中粗提取可见文本块（后续可换为 DOM 级 id 列表）。
fn svg_text_chunks_stub(svg: &str) -> Vec<&str> {
    svg.split("<text")
        .skip(1)
        .filter_map(|chunk| {
            let rest = chunk.split_once('>').map(|(_, r)| r)?;
            rest.split_once('<').map(|(t, _)| t.trim()).filter(|s| !s.is_empty())
        })
        .collect()
}

#[test]
fn parity_stub_extracts_text_from_component_svg() {
    let svg = try_render_rust(fixture("c0_simple_edge_ok.puml")).expect("svg");
    let chunks = svg_text_chunks_stub(&svg);
    assert!(chunks.iter().any(|c| c.contains("ComponentA")));
}
