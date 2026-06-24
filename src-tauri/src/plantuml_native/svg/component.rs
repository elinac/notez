//! 组件图 SVG 渲染（支持嵌套容器和 note 注释）。

use crate::plantuml_native::ir::{
    ComponentArrowStyle, ComponentDiagram, ComponentEdge, ComponentNote, ComponentShape, NotePosition,
};
use crate::plantuml_native::layout::ComponentGeom;
use crate::plantuml_native::svg::sequence::escape_xml;

const TITLE_PAD_BASE: f64 = 28.0;
const TITLE_LINE_HEIGHT: f64 = 16.0;
const CAPTION_PAD_BASE: f64 = 22.0;
const CAPTION_LINE_HEIGHT: f64 = 14.0;

fn diagram_font_sans(ir: &ComponentDiagram) -> String {
    ir.skinparam_default_font_name.as_ref().map_or_else(
        || "Microsoft YaHei, Helvetica, Arial, sans-serif".to_string(),
        |f| format!("{f}, Helvetica, Arial, sans-serif"),
    )
}

/// 自根 package 向下的嵌套深度（用于先画外层再画内层，避免内层框被盖住）。
fn package_depth_from_root(ir: &ComponentDiagram, id: &str) -> usize {
    let mut depth = 0usize;
    let mut cur = id.to_string();
    loop {
        let Some(n) = ir.nodes.iter().find(|n| n.id == cur) else {
            return depth;
        };
        match &n.parent_id {
            Some(p) => {
                depth += 1;
                cur = p.clone();
            }
            None => return depth,
        }
    }
}

/// 渲染组件图为 SVG。
pub fn render_component_svg(ir: &ComponentDiagram, geom: &ComponentGeom) -> String {
    let width = geom.width.ceil() as i32;
    let title_line_count = ir
        .title
        .as_ref()
        .map(|t| t.lines().count().max(1))
        .unwrap_or(0);
    let title_pad = if ir.title.as_ref().map_or(false, |t| !t.is_empty()) {
        TITLE_PAD_BASE + (title_line_count.saturating_sub(1) as f64) * TITLE_LINE_HEIGHT
    } else {
        0.0
    };
    let caption_line_count = ir
        .caption
        .as_ref()
        .map(|c| c.lines().count().max(1))
        .unwrap_or(0);
    let caption_pad = if ir.caption.as_ref().map_or(false, |c| !c.is_empty()) {
        CAPTION_PAD_BASE + (caption_line_count.saturating_sub(1) as f64) * CAPTION_LINE_HEIGHT
    } else {
        0.0
    };
    let height = (geom.height + title_pad + caption_pad).ceil() as i32;

    let mut parts: Vec<String> = Vec::new();

    // XML 声明与根元素
    parts.push(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">"#
    ));

    // 背景
    parts.push(format!(
        r#"<rect width="100%" height="100%" fill="white"/>"#
    ));

    let title_font_esc = escape_xml(&diagram_font_sans(ir));
    if let Some(ref t) = ir.title {
        if !t.is_empty() {
            let cx = (width as f64 / 2.0).max(1.0);
            let mut y = 18.0_f64;
            for line in t.lines() {
                let escaped = escape_xml(line);
                parts.push(format!(
                    r#"<text x="{cx}" y="{y}" text-anchor="middle" font-size="15" font-weight="bold" font-family="{title_font_esc}" fill="rgb(20,20,20)">{escaped}</text>"#
                ));
                y += TITLE_LINE_HEIGHT;
            }
        }
    }

    if title_pad > 0.0 {
        parts.push(format!(
            r#"<g transform="translate(0, {title_pad})">"#,
            title_pad = title_pad
        ));
    }

    // 凡有子元素的 package 均绘制浅色框（含顶层并列 package）；按自根向叶顺序绘制，避免遮挡。
    let mut parents_with_children: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    for n in &ir.nodes {
        if let Some(p) = &n.parent_id {
            parents_with_children.insert(p.clone());
        }
    }

    let mut containers_to_draw: Vec<&crate::plantuml_native::ir::ComponentNode> = ir
        .nodes
        .iter()
        .filter(|n| parents_with_children.contains(&n.id))
        .collect();
    containers_to_draw.sort_by_key(|n| package_depth_from_root(ir, &n.id));

    for node in containers_to_draw {
        if let Some(node_geom) = geom.nodes.get(&node.id) {
            append_container_background(&mut parts, node, node_geom);
        }
    }

    // 绘制边（在节点下方；与 layout 一致跳过 hidden）
    for (edge, edge_geom) in ir
        .edges
        .iter()
        .filter(|e| !e.hidden)
        .zip(geom.edges.iter())
    {
        append_edge(&mut parts, edge, edge_geom);
    }

    // 绘制节点
    for node in &ir.nodes {
        if let Some(node_geom) = geom.nodes.get(&node.id) {
            // 跳过已作为 package 框绘制的容器节点（标签在 append_container_background 中）
            if !parents_with_children.contains(&node.id) {
                append_node(&mut parts, node, node_geom, ir);
            }
        }
    }

    // 绘制 note 注释
    for note in &ir.notes {
        if note.position == NotePosition::Over && note.target_id_secondary.is_some() {
            let g1 = geom.nodes.get(&note.target_id);
            let g2 = note
                .target_id_secondary
                .as_ref()
                .and_then(|id| geom.nodes.get(id));
            match (g1, g2) {
                (Some(ga), Some(gb)) => append_note_over_two(&mut parts, note, ga, gb),
                (Some(g), None) | (None, Some(g)) => append_note(&mut parts, note, g),
                (None, None) => {}
            }
        } else if let Some(g) = geom.nodes.get(&note.target_id) {
            append_note(&mut parts, note, g);
        } else if let Some(id) = &note.target_id_secondary {
            if let Some(g) = geom.nodes.get(id) {
                append_note(&mut parts, note, g);
            }
        }
    }

    if title_pad > 0.0 {
        parts.push("</g>".to_string());
    }

    if let Some(ref c) = ir.caption {
        if !c.is_empty() {
            let cx = (width as f64 / 2.0).max(1.0);
            let lines: Vec<&str> = c.lines().collect();
            let block_top = height as f64 - caption_pad + 12.0;
            for (i, line) in lines.iter().enumerate() {
                let escaped = escape_xml(line);
                let y = block_top + (i as f64) * CAPTION_LINE_HEIGHT;
                parts.push(format!(
                    r#"<text x="{cx}" y="{y}" text-anchor="middle" font-size="11" font-family="Microsoft YaHei, Helvetica, Arial, sans-serif" fill="rgb(70,70,75)">{escaped}</text>"#
                ));
            }
        }
    }

    parts.push("</svg>".to_string());

    parts.join("\n")
}

fn append_node(
    parts: &mut Vec<String>,
    node: &crate::plantuml_native::ir::ComponentNode,
    geom: &crate::plantuml_native::layout::NodeGeom,
    ir: &ComponentDiagram,
) {
    let x = geom.x;
    let y = geom.y;
    let w = geom.w;
    let h = geom.h;
    let font_esc = escape_xml(&diagram_font_sans(ir));

    let fill_color = node
        .color
        .as_ref()
        .map(|c| resolve_color(c))
        .unwrap_or_else(|| match node.shape {
            ComponentShape::Ellipse => "rgb(230,247,255)",
            ComponentShape::Cylinder => "rgb(240,240,240)",
            ComponentShape::Folder => "rgb(255,250,230)",
            _ => "rgb(255,248,220)",
        });

    let stroke_color = "rgb(100,100,100)";
    let stroke_width = 1.5;

    match node.shape {
        ComponentShape::Rectangle => {
            parts.push(format!(
                r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" ry="3" fill="{fill_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
            ));
        }
        ComponentShape::Ellipse => {
            let cx = x + w / 2.0;
            let cy = y + h / 2.0;
            let rx = w / 2.0;
            let ry = h / 2.0;
            parts.push(format!(
                r#"<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
            ));
        }
        ComponentShape::Cylinder => {
            // 圆柱形：主体 + 顶部椭圆
            let body_h = h * 0.75;
            let top_h = h * 0.25;
            parts.push(format!(
                r#"<rect x="{x}" y="{y}" width="{w}" height="{body_h}" fill="{fill_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
            ));
            let cx = x + w / 2.0;
            let top_y = y;
            let rx = w / 2.0;
            parts.push(format!(
                r#"<ellipse cx="{cx}" cy="{top_y}" rx="{rx}" ry="{top_h}" fill="{fill_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
            ));
            // 底部椭圆（半圆）
            let bottom_y = y + body_h;
            parts.push(format!(
                r#"<path d="M{x},{bottom_y} A{rx},{top_h} 0 0,0 {},{bottom_y}" fill="none" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#,
                x + w
            ));
        }
        ComponentShape::Diamond => {
            let cx = x + w / 2.0;
            let cy = y + h / 2.0;
            let half_w = w / 2.0;
            let points = format!(
                "{cx},{y} {cx2},{cy} {cx},{y2} {cx3},{cy}",
                cx = cx,
                y = y,
                cx2 = cx + half_w,
                cy = cy,
                y2 = y + h,
                cx3 = cx - half_w,
            );
            parts.push(format!(
                r#"<polygon points="{points}" fill="{fill_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
            ));
        }
        ComponentShape::Folder => {
            let tab_h = h * 0.15;
            let body_y = y + tab_h;
            let body_h = h - tab_h;
            let tab_w = w * 0.35;
            let tab_right = x + tab_w;
            parts.push(format!(
                r#"<path d="M{x},{body_y} L{x},{y} L{tab_right},{y} L{tab_right},{body_y} Z" fill="{fill_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
            ));
            parts.push(format!(
                r#"<rect x="{x}" y="{body_y}" width="{w}" height="{body_h}" fill="{fill_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
            ));
        }
    }

    if let Some(ref st) = node.stereotype {
        let st_x = x + w / 2.0;
        let st_y = y + h * 0.32;
        let escaped_st = escape_xml(st);
        parts.push(format!(
            r#"<text x="{st_x}" y="{st_y}" text-anchor="middle" font-size="9" font-style="italic" font-family="Helvetica, Arial, sans-serif" fill="rgb(80,80,95)">«{escaped_st}»</text>"#
        ));
    }

    // 标签文字
    let label_x = x + w / 2.0;
    let label_y = if node.stereotype.is_some() {
        y + h / 2.0 + 10.0
    } else {
        y + h / 2.0 + 5.0
    };
    let escaped_label = escape_xml(&node.label);
    parts.push(format!(
        r#"<text x="{label_x}" y="{label_y}" text-anchor="middle" font-size="12" font-family="{font_esc}" fill="rgb(30,30,30)">{escaped_label}</text>"#
    ));
}

fn append_edge(
    parts: &mut Vec<String>,
    edge: &ComponentEdge,
    geom: &crate::plantuml_native::layout::EdgeGeom,
) {
    let (x1, y1) = geom.from;
    let (x2, y2) = geom.to;

    let stroke_color = edge_stroke_css(edge);
    let stroke_width = 1.5;
    let stroke_dash = if edge.arrow == ComponentArrowStyle::Dashed {
        r#" stroke-dasharray="5,5""#
    } else {
        ""
    };

    // 绘制线
    parts.push(format!(
        r#"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke='{stroke_color}' stroke-width="{stroke_width}"{stroke_dash}/>"#
    ));

    // 箭头标记（简单三角形）
    if (x2 - x1).abs() > 1.0 || (y2 - y1).abs() > 1.0 {
        let angle = (y2 - y1).atan2(x2 - x1);
        let arrow_len = 10.0;
        let arrow_angle = std::f64::consts::PI / 6.0;

        let ax1 = x2 - arrow_len * (angle - arrow_angle).cos();
        let ay1 = y2 - arrow_len * (angle - arrow_angle).sin();
        let ax2 = x2 - arrow_len * (angle + arrow_angle).cos();
        let ay2 = y2 - arrow_len * (angle + arrow_angle).sin();

        parts.push(format!(
            r#"<polygon points="{x2},{y2} {ax1},{ay1} {ax2},{ay2}" fill='{stroke_color}'/>"#
        ));
    }

    // 标签
    if let (Some(lx), Some(ly)) = (geom.label_x, geom.label_y) {
        if let Some(label) = &edge.label {
            let escaped = escape_xml(label);
            parts.push(format!(
                r#"<text x="{lx}" y="{ly}" text-anchor="middle" font-size="10" font-family="Helvetica, Arial, sans-serif" fill="rgb(80,80,80)">{escaped}</text>"#
            ));
        }
    }
}

fn edge_stroke_css(edge: &ComponentEdge) -> String {
    edge.color.as_ref().map_or_else(
        || "rgb(80,80,80)".to_string(),
        |c| {
            if c.len() == 6 && c.chars().all(|ch| ch.is_ascii_hexdigit()) {
                let r = u8::from_str_radix(&c[0..2], 16).unwrap_or(128);
                let g = u8::from_str_radix(&c[2..4], 16).unwrap_or(128);
                let b = u8::from_str_radix(&c[4..6], 16).unwrap_or(128);
                format!("rgb({},{},{})", r, g, b)
            } else {
                resolve_color(c.as_str()).to_string()
            }
        },
    )
}

fn resolve_color(name: &str) -> &'static str {
    match name.to_ascii_lowercase().as_str() {
        "red" => "rgb(255,200,200)",
        "green" => "rgb(200,255,200)",
        "blue" => "rgb(200,220,255)",
        "yellow" => "rgb(255,255,200)",
        "orange" => "rgb(255,220,180)",
        "purple" => "rgb(230,200,255)",
        "lightblue" => "rgb(230,247,255)",
        "lightgray" => "rgb(240,240,240)",
        _ => "rgb(255,248,220)",
    }
}

/// 渲染容器背景框（package）
fn append_container_background(
    parts: &mut Vec<String>,
    node: &crate::plantuml_native::ir::ComponentNode,
    geom: &crate::plantuml_native::layout::NodeGeom,
) {
    let x = geom.x;
    let y = geom.y;
    let w = geom.w;
    let h = geom.h;

    // 容器背景色（浅蓝灰色）
    let bg_color = "rgb(245,245,250)";
    let stroke_color = "rgb(100,100,100)";
    let stroke_width = 1.5;

    // 绘制容器矩形
    parts.push(format!(
        r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" ry="5" fill="{bg_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
    ));

    // Package 名称显示在左上角外部
    let label_x = x - 5.0;  // 左边外部
    let label_y = y - 8.0;  // 上边外部
    let escaped_label = escape_xml(&node.label);
    parts.push(format!(
        r#"<text x="{label_x}" y="{label_y}" text-anchor="start" font-size="13" font-weight="bold" font-family="Microsoft YaHei, Helvetica, Arial, sans-serif" fill="rgb(30,30,30)">{escaped_label}</text>"#
    ));
}

fn note_box_metrics(note: &ComponentNote) -> (f64, f64) {
    const NOTE_WIDTH: f64 = 180.0;
    let note_padding = 8.0;
    let line_height = 16.0;
    let line_count = note.text.lines().count().max(1);
    let note_height = (line_count as f64 * line_height) + (note_padding * 2.0);
    (NOTE_WIDTH, note_height)
}

/// `note over A, B`：置于两节点水平并集上方，虚线连至各节点顶边中点
fn append_note_over_two(
    parts: &mut Vec<String>,
    note: &ComponentNote,
    g1: &crate::plantuml_native::layout::NodeGeom,
    g2: &crate::plantuml_native::layout::NodeGeom,
) {
    let (note_width, note_height) = note_box_metrics(note);
    let note_padding = 8.0;
    let line_height = 16.0;

    let min_left = g1.x.min(g2.x);
    let max_right = (g1.x + g1.w).max(g2.x + g2.w);
    let center_x = (min_left + max_right) / 2.0;
    let top_y = g1.y.min(g2.y);
    let note_x = center_x - note_width / 2.0;
    let note_y = top_y - note_height - 10.0;

    let bg_color = "rgb(255,255,200)";
    let stroke_color = "rgb(150,150,100)";
    let stroke_width = 1.0;

    parts.push(format!(
        r#"<rect x="{note_x}" y="{note_y}" width="{note_width}" height="{note_height}" rx="3" ry="3" fill="{bg_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
    ));

    let text_x = note_x + note_padding;
    let mut text_y = note_y + note_padding + 12.0;
    for line in note.text.lines() {
        let escaped = escape_xml(line);
        parts.push(format!(
            r#"<text x="{text_x}" y="{text_y}" font-size="11" font-family="Microsoft YaHei, Helvetica, Arial, sans-serif" fill="rgb(60,60,60)">{escaped}</text>"#
        ));
        text_y += line_height;
    }

    let note_anchor_x = note_x + note_width / 2.0;
    let note_anchor_y = note_y + note_height;
    for g in [g1, g2] {
        let target_x = g.x + g.w / 2.0;
        let target_y = g.y;
        parts.push(format!(
            r#"<line x1="{target_x}" y1="{target_y}" x2="{note_anchor_x}" y2="{note_anchor_y}" stroke="{stroke_color}" stroke-width="{stroke_width}" stroke-dasharray="3,3"/>"#
        ));
    }
}

/// 渲染 note 注释
fn append_note(
    parts: &mut Vec<String>,
    note: &ComponentNote,
    target_geom: &crate::plantuml_native::layout::NodeGeom,
) {
    let (note_width, note_height) = note_box_metrics(note);
    let note_padding = 8.0;
    let line_height = 16.0;
    
    // 根据位置计算注释坐标
    let (note_x, note_y) = match note.position {
        NotePosition::Right => (target_geom.x + target_geom.w + 20.0, target_geom.y),
        NotePosition::Left => (target_geom.x - note_width - 20.0, target_geom.y),
        NotePosition::Over => (target_geom.x, target_geom.y - note_height - 10.0),
    };
    
    // 注释背景色（浅黄色）
    let bg_color = "rgb(255,255,200)";
    let stroke_color = "rgb(150,150,100)";
    let stroke_width = 1.0;
    
    // 绘制注释矩形
    parts.push(format!(
        r#"<rect x="{note_x}" y="{note_y}" width="{note_width}" height="{note_height}" rx="3" ry="3" fill="{bg_color}" stroke="{stroke_color}" stroke-width="{stroke_width}"/>"#
    ));
    
    // 绘制注释文本（多行）
    let text_x = note_x + note_padding;
    let mut text_y = note_y + note_padding + 12.0;
    
    for line in note.text.lines() {
        let escaped = escape_xml(line);
        parts.push(format!(
            r#"<text x="{text_x}" y="{text_y}" font-size="11" font-family="Microsoft YaHei, Helvetica, Arial, sans-serif" fill="rgb(60,60,60)">{escaped}</text>"#
        ));
        text_y += line_height;
    }
    
    // 绘制连接到目标组件的虚线
    let (target_x, target_y) = match note.position {
        NotePosition::Right => (target_geom.x + target_geom.w, target_geom.y + target_geom.h / 2.0),
        NotePosition::Left => (target_geom.x, target_geom.y + target_geom.h / 2.0),
        NotePosition::Over => (target_geom.x + target_geom.w / 2.0, target_geom.y),
    };
    
    let (note_anchor_x, note_anchor_y) = match note.position {
        NotePosition::Right => (note_x, note_y + note_height / 2.0),
        NotePosition::Left => (note_x + note_width, note_y + note_height / 2.0),
        NotePosition::Over => (note_x + note_width / 2.0, note_y + note_height),
    };
    
    parts.push(format!(
        r#"<line x1="{target_x}" y1="{target_y}" x2="{note_anchor_x}" y2="{note_anchor_y}" stroke="{stroke_color}" stroke-width="{stroke_width}" stroke-dasharray="3,3"/>"#
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plantuml_native::ir::{
        ComponentDiagram, ComponentEdge, ComponentNode, ComponentNote, ComponentShape,
        ComponentArrowStyle, NotePosition,
    };

    #[test]
    fn render_empty_diagram() {
        let ir = ComponentDiagram::default();
        let geom = ComponentGeom {
            nodes: std::collections::HashMap::new(),
            edges: Vec::new(),
            width: 100.0,
            height: 100.0,
        };
        let svg = render_component_svg(&ir, &geom);
        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>"));
        assert!(svg.contains("white"));
    }

    #[test]
    fn render_single_node() {
        let ir = ComponentDiagram {
            title: None,
            caption: None,
            skinparam_default_font_name: None,
            nodes: vec![ComponentNode {
                id: "A".to_string(),
                label: "Service A".to_string(),
                shape: ComponentShape::Rectangle,
                color: None,
                stereotype: None,
                parent_id: None,
            }],
            edges: vec![],
            notes: vec![],
        };
        let geom = ComponentGeom {
            nodes: {
                let mut m = std::collections::HashMap::new();
                m.insert("A".to_string(), crate::plantuml_native::layout::NodeGeom {
                    x: 50.0,
                    y: 50.0,
                    w: 120.0,
                    h: 60.0,
                });
                m
            },
            edges: Vec::new(),
            width: 200.0,
            height: 150.0,
        };
        let svg = render_component_svg(&ir, &geom);
        assert!(svg.contains("Service A"));
        assert!(svg.contains("<rect"));
    }

    #[test]
    fn render_edge_with_label() {
        let ir = ComponentDiagram {
            title: None,
            caption: None,
            skinparam_default_font_name: None,
            nodes: vec![
                ComponentNode {
                    id: "A".to_string(),
                    label: "A".to_string(),
                    shape: ComponentShape::Rectangle,
                    color: None,
                    stereotype: None,
                    parent_id: None,
                },
                ComponentNode {
                    id: "B".to_string(),
                    label: "B".to_string(),
                    shape: ComponentShape::Rectangle,
                    color: None,
                    stereotype: None,
                    parent_id: None,
                },
            ],
            edges: vec![ComponentEdge {
                from: "A".to_string(),
                to: "B".to_string(),
                label: Some("uses".to_string()),
                arrow: ComponentArrowStyle::Solid,
                color: None,
                hidden: false,
            }],
            notes: vec![],
        };
        let geom = ComponentGeom {
            nodes: {
                let mut m = std::collections::HashMap::new();
                m.insert("A".to_string(), crate::plantuml_native::layout::NodeGeom {
                    x: 50.0,
                    y: 50.0,
                    w: 100.0,
                    h: 60.0,
                });
                m.insert("B".to_string(), crate::plantuml_native::layout::NodeGeom {
                    x: 200.0,
                    y: 50.0,
                    w: 100.0,
                    h: 60.0,
                });
                m
            },
            edges: vec![crate::plantuml_native::layout::EdgeGeom {
                from: (100.0, 80.0),
                to: (200.0, 80.0),
                label_x: Some(150.0),
                label_y: Some(70.0),
            }],
            width: 350.0,
            height: 150.0,
        };
        let svg = render_component_svg(&ir, &geom);
        assert!(svg.contains("uses"));
        assert!(svg.contains("<line"));
        assert!(svg.contains("<polygon")); // 箭头
    }

    #[test]
    fn note_over_two_targets_renders_union_and_connectors() {
        let ir = ComponentDiagram {
            title: None,
            caption: None,
            skinparam_default_font_name: None,
            nodes: vec![
                ComponentNode {
                    id: "A".to_string(),
                    label: "A".to_string(),
                    shape: ComponentShape::Rectangle,
                    color: None,
                    stereotype: None,
                    parent_id: None,
                },
                ComponentNode {
                    id: "B".to_string(),
                    label: "B".to_string(),
                    shape: ComponentShape::Rectangle,
                    color: None,
                    stereotype: None,
                    parent_id: None,
                },
            ],
            edges: vec![],
            notes: vec![ComponentNote {
                target_id: "A".to_string(),
                target_id_secondary: Some("B".to_string()),
                position: NotePosition::Over,
                text: "hello".to_string(),
            }],
        };
        let geom = ComponentGeom {
            nodes: {
                let mut m = std::collections::HashMap::new();
                m.insert(
                    "A".to_string(),
                    crate::plantuml_native::layout::NodeGeom {
                        x: 50.0,
                        y: 80.0,
                        w: 100.0,
                        h: 50.0,
                    },
                );
                m.insert(
                    "B".to_string(),
                    crate::plantuml_native::layout::NodeGeom {
                        x: 220.0,
                        y: 80.0,
                        w: 100.0,
                        h: 50.0,
                    },
                );
                m
            },
            edges: Vec::new(),
            width: 400.0,
            height: 200.0,
        };
        let svg = render_component_svg(&ir, &geom);
        assert!(svg.contains("hello"));
        assert_eq!(svg.matches("stroke-dasharray=\"3,3\"").count(), 2);
    }
}
