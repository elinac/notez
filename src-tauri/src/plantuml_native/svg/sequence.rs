//! 序列图 SVG 序列化（文本做 XML 转义，防 XSS）。

use crate::plantuml_native::ir::{
    ActivationSpan, LayoutRow, LegendAlign, MessageArrow, NotePlacement, NoteShape, ParticipantBox,
    SequenceBodyItem, SequenceDelay, SequenceDelayKind, SequenceDiagram, SequenceDivider, SequenceNote,
    SequenceRef,
};
use crate::plantuml_native::layout::{
    participant_header_lines, SequenceGeom, MESSAGE_ARROW_LIFELINE_INSET,
    MESSAGE_LABEL_LINE_HEIGHT, PARTICIPANT_GAP_BELOW, PARTICIPANT_LINE_HEIGHT, PARTICIPANT_TOP_PAD,
    SEQUENCE_ACTIVATION_BAR_WIDTH, SEQUENCE_DELAY_ROW_HEIGHT, SEQUENCE_DESTROY_ROW_HEIGHT,
    SEQUENCE_LANE_INNER_WIDTH, SEQUENCE_SELF_MESSAGE_LOOP_DEPTH, SEQUENCE_SELF_MESSAGE_LOOP_OUT,
};
use std::collections::HashMap;

/// 将颜色名或十六进制值转换为 CSS 颜色字符串
/// 支持：颜色名（如 red, blue）或十六进制（如 FF8833）
fn resolve_color(color: &Option<String>) -> &'static str {
    match color {
        Some(c) => {
            // 检查是否是十六进制颜色
            if c.len() == 6 && c.chars().all(|ch| ch.is_ascii_hexdigit()) {
                // 返回静态字符串需要 leak，这里用颜色查找表
                match c.as_str() {
                    // 常见十六进制颜色
                    "ff0000" => "rgb(255,0,0)",
                    "00ff00" => "rgb(0,255,0)",
                    "0000ff" => "rgb(0,0,255)",
                    "ffff00" => "rgb(255,255,0)",
                    "ff8833" => "rgb(255,136,51)",
                    _ => {
                        // 对于其他十六进制，解析并格式化
                        // 由于需要返回 &'static str，我们用一个静态查找表
                        // 这里简化处理，直接返回默认颜色
                        DEFAULT_ARROW_COLOR
                    }
                }
            } else {
                // 颜色名映射
                match c.as_str() {
                    "red" => "rgb(220,53,69)",
                    "blue" => "rgb(0,123,255)",
                    "green" => "rgb(40,167,69)",
                    "yellow" => "rgb(255,193,7)",
                    "orange" => "rgb(253,126,20)",
                    "purple" => "rgb(111,66,193)",
                    "pink" => "rgb(232,62,140)",
                    "black" => "rgb(0,0,0)",
                    "gray" | "grey" => "rgb(108,117,125)",
                    "white" => "rgb(255,255,255)",
                    "brown" => "rgb(121,85,72)",
                    "cyan" => "rgb(23,162,184)",
                    "magenta" => "rgb(255,0,255)",
                    _ => DEFAULT_ARROW_COLOR,
                }
            }
        }
        None => DEFAULT_ARROW_COLOR,
    }
}

const DEFAULT_ARROW_COLOR: &str = "rgb(34,34,34)";

/// 递归计算 layout rows（支持嵌套 fragment）
fn count_layout_rows(body: &[SequenceBodyItem]) -> usize {
    let mut count = 0;
    for item in body {
        match item {
            SequenceBodyItem::Message(_)
            | SequenceBodyItem::Note(_)
            | SequenceBodyItem::Create { .. }
            | SequenceBodyItem::Destroy { .. }
            | SequenceBodyItem::Delay(_)
            | SequenceBodyItem::Divider(_)
            | SequenceBodyItem::Ref(_)
            | SequenceBodyItem::Newpage { .. } => {
                count += 1;
            }
            SequenceBodyItem::Box(_) => {
                // box 本身不占布局行，仅逻辑分组
            }
            SequenceBodyItem::Alt { sections } | SequenceBodyItem::Par { sections } => {
                for sec in sections {
                    count += count_layout_rows(&sec.body);
                }
            }
            SequenceBodyItem::Opt { body, .. }
            | SequenceBodyItem::Loop { body, .. }
            | SequenceBodyItem::Group { body, .. } => {
                count += count_layout_rows(body);
            }
        }
    }
    count
}

pub fn escape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

fn truncate_label(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        return s.to_string();
    }
    let mut t: String = s.chars().take(max_chars).collect();
    t.push('…');
    t
}

/// 消息标签多行渲染（已含真实换行；总长限制防极端输入）。
fn message_label_lines(label: &str) -> Vec<String> {
    let t = truncate_label(label, 200);
    if t.trim().is_empty() {
        return vec![String::new()];
    }
    t.lines().map(|l| l.to_string()).collect()
}

fn message_lines_with_autonumber(
    label: &str,
    msg_index: u32,
    autonumber_start: Option<u32>,
) -> Vec<String> {
    let raw_lines = message_label_lines(label);
    let Some(start) = autonumber_start else {
        return raw_lines;
    };
    let num = start.saturating_add(msg_index);
    if raw_lines.len() == 1 && raw_lines[0].trim().is_empty() {
        return vec![format!("{num}")];
    }
    let mut it = raw_lines.into_iter();
    let Some(first) = it.next() else {
        return vec![format!("{num}")];
    };
    let mut out = Vec::new();
    if first.trim().is_empty() {
        out.push(format!("{num}"));
    } else {
        out.push(format!("{num}. {first}"));
    }
    out.extend(it);
    out
}

/// 须与 `layout::sequence` 中标题区度量一致。
const SVG_TITLE_LINE_H: f64 = 16.0;
const SVG_TITLE_PAD_TOP: f64 = 8.0;

fn append_diagram_page_header(s: &mut String, ir: &SequenceDiagram) {
    let Some(ref head) = ir.page_header else {
        return;
    };
    if head.trim().is_empty() {
        return;
    }
    let mut lines: Vec<&str> = head
        .lines()
        .map(|l| l.trim_end())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        lines.push(head.as_str());
    }
    const X: f64 = 28.0;
    for (i, line) in lines.iter().enumerate() {
        let y = SVG_TITLE_PAD_TOP + SVG_TITLE_LINE_H * (i as f64 + 0.88);
        let esc = escape_xml(&truncate_label(line, 80));
        s.push_str(&format!(
            r#"<text x="{X}" y="{y}" text-anchor="start" font-family="system-ui,sans-serif" font-size="11" fill='rgb(95,95,102)'>{esc}</text>"#
        ));
    }
}

fn append_diagram_title(s: &mut String, ir: &SequenceDiagram, w: f64, y0: f64) {
    let Some(ref tit) = ir.title else {
        return;
    };
    if tit.trim().is_empty() {
        return;
    }
    let mut lines: Vec<&str> = tit
        .lines()
        .map(|l| l.trim_end())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        lines.push(tit.as_str());
    }
    let cx = w / 2.0;
    for (i, line) in lines.iter().enumerate() {
        let y = y0 + SVG_TITLE_PAD_TOP + SVG_TITLE_LINE_H * (i as f64 + 0.88);
        let esc = escape_xml(&truncate_label(line, 80));
        s.push_str(&format!(
            r#"<text x="{cx}" y="{y}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill='rgb(28,28,28)'>{esc}</text>"#
        ));
    }
}

/// 与 `layout::sequence` 中图例区行高一致。
const SVG_LEGEND_LINE_H: f64 = 13.0;

fn append_diagram_legend(s: &mut String, ir: &SequenceDiagram, g: &SequenceGeom, w: f64) {
    let Some(ref leg) = ir.legend else {
        return;
    };
    if leg.text.trim().is_empty() {
        return;
    }
    let mut lines: Vec<&str> = leg
        .text
        .lines()
        .map(|l| l.trim_end())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        lines.push(leg.text.as_str());
    }
    let y0 = g.lifeline_bottom_y + 8.0;
    for (i, line) in lines.iter().enumerate() {
        let y = y0 + SVG_LEGEND_LINE_H * (i as f64 + 0.85);
        let esc = escape_xml(&truncate_label(line, 96));
        let (x, anchor) = match leg.align {
            LegendAlign::Left => (28.0, "start"),
            LegendAlign::Right => (w - 28.0, "end"),
            LegendAlign::Center => (w / 2.0, "middle"),
        };
        s.push_str(&format!(
            r#"<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="system-ui,sans-serif" font-size="10" fill='rgb(95,95,102)'>{esc}</text>"#
        ));
    }
}

fn append_diagram_page_footer(s: &mut String, ir: &SequenceDiagram, g: &SequenceGeom, w: f64) {
    let Some(ref foot) = ir.page_footer else {
        return;
    };
    if foot.trim().is_empty() {
        return;
    }
    let mut lines: Vec<&str> = foot
        .lines()
        .map(|l| l.trim_end())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        lines.push(foot.as_str());
    }
    let cx = w / 2.0;
    let y_base = g.lifeline_bottom_y + g.legend_band_height + 8.0;
    for (i, line) in lines.iter().enumerate() {
        let y = y_base + SVG_TITLE_LINE_H * (i as f64 + 0.85);
        let esc = escape_xml(&truncate_label(line, 80));
        s.push_str(&format!(
            r#"<text x="{cx}" y="{y}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill='rgb(95,95,102)'>{esc}</text>"#
        ));
    }
}

fn col_x(geom: &SequenceGeom, ir: &SequenceDiagram, id: &str) -> Option<f64> {
    let idx = ir.participants.iter().position(|p| p.id == id)?;
    geom.col_center_x.get(idx).copied()
}

const NOTE_LINE_H: f64 = 12.0;

fn append_note_row(
    s: &mut String,
    ir: &SequenceDiagram,
    g: &SequenceGeom,
    note: &SequenceNote,
    y: f64,
) {
    let lines: Vec<String> = if note.text.trim().is_empty() {
        vec![String::new()]
    } else {
        note.text
            .lines()
            .map(|l| truncate_label(l.trim_end(), 52))
            .collect()
    };
    let nlines = lines.len().max(1);
    let text_h = nlines as f64 * NOTE_LINE_H;
    let pad_v = 8.0;
    let box_h = text_h + pad_v * 2.0;

    let (bx, bw, anchor_x) = match &note.placement {
        NotePlacement::LeftOf(id) => {
            let Some(cx) = col_x(g, ir, id) else {
                return;
            };
            let bw = 92.0;
            (cx - bw - 14.0, bw, cx - 14.0 - bw / 2.0)
        }
        NotePlacement::RightOf(id) => {
            let Some(cx) = col_x(g, ir, id) else {
                return;
            };
            let bw = 92.0;
            (cx + 22.0, bw, cx + 22.0 + bw / 2.0)
        }
        NotePlacement::Over1(id) => {
            let Some(cx) = col_x(g, ir, id) else {
                return;
            };
            let bw = 100.0;
            (cx - bw / 2.0, bw, cx)
        }
        NotePlacement::Over2(a, b) => {
            let Some(x1) = col_x(g, ir, a) else {
                return;
            };
            let Some(x2) = col_x(g, ir, b) else {
                return;
            };
            let mid = (x1 + x2) / 2.0;
            let bw = ((x2 - x1).abs() + 48.0).min(180.0);
            (mid - bw / 2.0, bw, mid)
        }
    };

    let by = y - box_h / 2.0;

    // 根据 note 形状绘制不同的背景
    match note.shape {
        NoteShape::Standard => {
            // 默认样式：折角矩形（用圆角矩形近似）
            s.push_str(&format!(
                r#"<rect x="{bx}" y="{by}" width="{bw}" height="{box_h}" rx="5" fill='rgb(255,252,220)' stroke='rgb(175,160,95)' stroke-width="0.85" opacity="0.98"/>"#
            ));
        }
        NoteShape::Hexagonal => {
            // 六边形：顶部和底部有斜边
            let indent = bw * 0.12; // 斜边缩进量
            let x1 = bx + indent;
            let x2 = bx + bw - indent;
            let x3 = bx + bw;
            let x4 = bx;
            let y1 = by;
            let y2 = by + box_h;
            s.push_str(&format!(
                r#"<polygon points="{x1},{y1} {x2},{y1} {x3},{y_mid1} {x2},{y2} {x1},{y2} {x4},{y_mid2}" fill='rgb(255,252,220)' stroke='rgb(175,160,95)' stroke-width="0.85" opacity="0.98"/>"#,
                y_mid1 = y1 + box_h * 0.15,
                y_mid2 = y2 - box_h * 0.15
            ));
        }
        NoteShape::Rectangular => {
            // 矩形：无折角
            s.push_str(&format!(
                r#"<rect x="{bx}" y="{by}" width="{bw}" height="{box_h}" fill='rgb(255,252,220)' stroke='rgb(175,160,95)' stroke-width="0.85" opacity="0.98"/>"#
            ));
        }
    }

    // 文本渲染（所有形状共用）
    for (i, line) in lines.iter().enumerate() {
        let ly = by + pad_v + NOTE_LINE_H * (i as f64 + 0.85);
        let esc = escape_xml(line);
        s.push_str(&format!(
            r#"<text x="{anchor_x}" y="{ly}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill='rgb(55,50,28)'>{esc}</text>"#
        ));
    }
}

/// 覆盖 fragment 内布局行的纵向条带（与 `row_top` / `row_bottom` 一致）。
fn fragment_band_y(
    start_row: usize,
    end_row_exclusive: usize,
    g: &SequenceGeom,
) -> Option<(f64, f64)> {
    if start_row >= end_row_exclusive {
        return None;
    }
    let y_top = g.row_top.get(start_row).copied()?;
    let last = end_row_exclusive.saturating_sub(1);
    let y_bot = g.row_bottom.get(last).copied()?;
    Some((y_top, y_bot))
}

fn append_fragment_backgrounds(
    s: &mut String,
    body: &[SequenceBodyItem],
    row_idx: &mut usize,
    w: f64,
    g: &SequenceGeom,
) {
    const PAD: f64 = 10.0;
    for item in body {
        match item {
            SequenceBodyItem::Message(_)
            | SequenceBodyItem::Note(_)
            | SequenceBodyItem::Create { .. }
            | SequenceBodyItem::Destroy { .. }
            | SequenceBodyItem::Delay(_)
            | SequenceBodyItem::Divider(_)
            | SequenceBodyItem::Ref(_)
            | SequenceBodyItem::Newpage { .. } => {
                *row_idx += 1;
            }
            SequenceBodyItem::Box(_) => {
                // box 不占布局行，背景在主函数中单独绘制
            }
            SequenceBodyItem::Alt { sections } | SequenceBodyItem::Par { sections } => {
                let start = *row_idx;
                for sec in sections {
                    *row_idx += count_layout_rows(&sec.body);
                }
                let end = *row_idx;
                if let Some((y1, y2)) = fragment_band_y(start, end, g) {
                    let h = (y2 - y1).max(10.0);
                    let y = y1 - 2.0;
                    let hh = h + 4.0;
                    let bw = w - 2.0 * PAD;
                    s.push_str(&format!(
                        r#"<rect x="{PAD}" y="{y}" width="{bw}" height="{hh}" rx="8" fill='rgb(245,245,250)' stroke='rgb(170,175,195)' stroke-width="1" stroke-dasharray="5 4" opacity="0.9"/>"#
                    ));
                }
            }
            SequenceBodyItem::Opt { body, .. }
            | SequenceBodyItem::Loop { body, .. }
            | SequenceBodyItem::Group { body, .. } => {
                let start = *row_idx;
                *row_idx += count_layout_rows(body);
                let end = *row_idx;
                if let Some((y1, y2)) = fragment_band_y(start, end, g) {
                    let h = (y2 - y1).max(10.0);
                    let y = y1 - 2.0;
                    let hh = h + 4.0;
                    let bw = w - 2.0 * PAD;
                    s.push_str(&format!(
                        r#"<rect x="{PAD}" y="{y}" width="{bw}" height="{hh}" rx="8" fill='rgb(245,245,250)' stroke='rgb(170,175,195)' stroke-width="1" stroke-dasharray="5 4" opacity="0.9"/>"#
                    ));
                }
            }
        }
    }
}

fn activation_y_range(
    sp: &ActivationSpan,
    g: &SequenceGeom,
    lifeline_stop_y: &HashMap<String, f64>,
) -> Option<(f64, f64)> {
    let start_r = *g.message_layout_row.get(sp.start_msg_index)?;
    let y_top = *g.row_top.get(start_r)?;
    let rh = *g.row_heights.get(start_r)?;
    if sp.end_msg_index <= sp.start_msg_index {
        let mut y_bot = y_top + (rh * 0.35).max(6.0);
        if let Some(&stop) = lifeline_stop_y.get(&sp.participant_id) {
            y_bot = y_bot.min(stop);
        }
        return Some((y_top, y_bot.max(y_top)));
    }
    let end_msg_i = sp.end_msg_index.saturating_sub(1);
    let end_r = *g.message_layout_row.get(end_msg_i)?;
    let mut y_bot = *g.row_bottom.get(end_r)?;
    if let Some(&stop) = lifeline_stop_y.get(&sp.participant_id) {
        y_bot = y_bot.min(stop);
    }
    Some((y_top, y_bot.max(y_top)))
}

/// 首个 `destroy` 行的纵向中心（同 id 再次出现则忽略），用于截断生命线并画 X。
fn lifeline_destroy_stop_y(ir: &SequenceDiagram, g: &SequenceGeom) -> HashMap<String, f64> {
    let mut out: HashMap<String, f64> = HashMap::new();
    let mut ri = 0usize;
    ir.for_each_layout_row(|row| {
        if let LayoutRow::Destroy { participant_id } = row {
            if let Some(&yy) = g.message_y.get(ri) {
                out.entry(participant_id.to_string()).or_insert(yy);
            }
        }
        ri += 1;
    });
    out
}

fn append_delay_row(s: &mut String, w: f64, y: f64, delay: &SequenceDelay) {
    const PAD: f64 = 22.0;
    let x1 = PAD;
    let x2 = w - PAD;

    match delay.kind {
        SequenceDelayKind::Dots => {
            s.push_str(&format!(
                r#"<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke='rgb(158,158,168)' stroke-width="1" stroke-dasharray="2 6" stroke-linecap="round"/>"#,
            ));
        }
        SequenceDelayKind::Bars => {
            let bar_h = (SEQUENCE_DELAY_ROW_HEIGHT * 0.72).max(14.0);
            let half = bar_h / 2.0;
            let mid = w / 2.0;
            for i in -1_i32..=1 {
                let x = mid + f64::from(i) * 13.0 - 1.25;
                s.push_str(&format!(
                    r#"<rect x="{x}" y="{y_top}" width="2.5" height="{bar_h}" rx="0.8" fill='rgb(130,132,145)'/>"#,
                    y_top = y - half,
                ));
            }
        }
    }

    // 如果有文案，绘制文案
    if let Some(text) = &delay.text {
        let mid = w / 2.0;
        let esc = escape_xml(text);
        s.push_str(&format!(
            r#"<text x="{mid}" y="{y}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-style="italic" fill='rgb(100,100,110)'>{esc}</text>"#,
            y = y + 3.5,
        ));
    }
}

/// 绘制分割线 `== title ==`
fn append_divider_row(
    s: &mut String,
    _ir: &SequenceDiagram,
    g: &SequenceGeom,
    y: f64,
    divider: &SequenceDivider,
) {
    const PAD: f64 = 22.0;
    let x1 = PAD;
    let x2 = g.width - PAD;

    // 绘制分割线
    s.push_str(&format!(
        r#"<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke='rgb(100,100,110)' stroke-width="1.5"/>"#,
    ));

    // 如果有标题，绘制标题背景和文本
    if let Some(label) = &divider.label {
        let text = label.trim();
        if !text.is_empty() {
            let mid = g.width / 2.0;
            let esc = escape_xml(text);
            // 绘制标题背景（白色矩形遮盖分割线）
            let text_w = (text.chars().count() as f64 * 7.0).max(20.0) + 16.0;
            let bg_x = mid - text_w / 2.0;
            s.push_str(&format!(
                r#"<rect x="{bg_x}" y="{y_top}" width="{text_w}" height="16" fill='white'/>"#,
                y_top = y - 8.0,
            ));
            // 绘制标题文本
            s.push_str(&format!(
                r#"<text x="{mid}" y="{y}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="500" fill='rgb(60,60,70)'>{esc}</text>"#,
                y = y + 3.5,
            ));
        }
    }
}

fn append_ref_row(
    s: &mut String,
    ir: &SequenceDiagram,
    g: &SequenceGeom,
    y: f64,
    ref_item: &SequenceRef,
) {
    // 计算参与者的 x 坐标范围
    let x_positions: Vec<f64> = ref_item
        .participants
        .iter()
        .filter_map(|p| col_x(g, ir, p))
        .collect();

    if x_positions.is_empty() {
        return;
    }

    let x_min = x_positions.iter().cloned().fold(f64::INFINITY, f64::min);
    let x_max = x_positions.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    // 扩展一点范围
    const PAD: f64 = 16.0;
    let x1 = x_min - PAD;
    let x2 = x_max + PAD;
    let width = x2 - x1;
    let height = 24.0;

    // 绘制 ref 背景框（虚线边框）
    s.push_str(&format!(
        r#"<rect x="{x1}" y="{y_top}" width="{width}" height="{height}" fill='rgb(255,255,255)' stroke='rgb(100,100,110)' stroke-width="1" stroke-dasharray="4 3"/>"#,
        y_top = y - height / 2.0,
    ));

    // 绘制 "ref" 标签
    s.push_str(&format!(
        r#"<text x="{x1}" y="{y_label}" font-family="system-ui,sans-serif" font-size="9" font-style="italic" fill='rgb(100,100,110)'>ref</text>"#,
        y_label = y - height / 2.0 + 10.0,
    ));

    // 绘制引用文本
    if !ref_item.text.is_empty() {
        let esc = escape_xml(&ref_item.text);
        let text_y = y + 3.0;
        s.push_str(&format!(
            r#"<text x="{mid}" y="{text_y}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill='rgb(40,40,50)'>{esc}</text>"#,
            mid = (x1 + x2) / 2.0,
        ));
    }
}

fn append_newpage_row(
    s: &mut String,
    w: f64,
    y: f64,
    title: Option<&str>,
) {
    const PAD: f64 = 22.0;
    let x1 = PAD;
    let x2 = w - PAD;

    // 绘制分割线（虚线表示分页）
    s.push_str(&format!(
        r#"<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke='rgb(150,150,160)' stroke-width="1" stroke-dasharray="8 4"/>"#,
    ));

    // 如果有标题，绘制标题
    if let Some(t) = title {
        let text = t.trim();
        if !text.is_empty() {
            let esc = escape_xml(text);
            // 绘制标题背景（白色矩形遮盖分割线）
            let text_w = (text.chars().count() as f64 * 7.0).max(20.0) + 20.0;
            let bg_x = w / 2.0 - text_w / 2.0;
            s.push_str(&format!(
                r#"<rect x="{bg_x}" y="{y_top}" width="{text_w}" height="18" fill='white'/>"#,
                y_top = y - 9.0,
            ));
            // 绘制标题文本
            s.push_str(&format!(
                r#"<text x="{mid}" y="{y_text}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="500" fill='rgb(100,100,110)'>[ {esc} ]</text>"#,
                mid = w / 2.0,
                y_text = y + 4.0,
            ));
        }
    }
}

fn append_destroy_marker(s: &mut String, cx: f64, y: f64) {
    let h = (SEQUENCE_DESTROY_ROW_HEIGHT * 0.28).max(5.0);
    s.push_str(&format!(
        r#"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke='rgb(180,60,60)' stroke-width="1.35"/>"#,
        x1 = cx - h,
        y1 = y - h,
        x2 = cx + h,
        y2 = y + h,
    ));
    s.push_str(&format!(
        r#"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke='rgb(180,60,60)' stroke-width="1.35"/>"#,
        x1 = cx - h,
        y1 = y + h,
        x2 = cx + h,
        y2 = y - h,
    ));
}

/// 绘制创建标记：一个小圆圈或菱形，表示参与者被创建
fn append_create_marker(s: &mut String, cx: f64, y: f64) {
    // 使用一个小圆圈表示创建
    let r = (SEQUENCE_DESTROY_ROW_HEIGHT * 0.25).max(4.0);
    s.push_str(&format!(
        r#"<circle cx="{cx}" cy="{y}" r="{r}" fill='white' stroke='rgb(60,140,60)' stroke-width="1.5"/>"#,
    ));
    // 在圆圈内添加一个小十字或加号
    let inner = r * 0.5;
    s.push_str(&format!(
        r#"<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke='rgb(60,140,60)' stroke-width="1.2"/>"#,
        x1 = cx - inner,
        x2 = cx + inner,
    ));
    s.push_str(&format!(
        r#"<line x1="{cx}" y1="{y1}" x2="{cx}" y2="{y2}" stroke='rgb(60,140,60)' stroke-width="1.2"/>"#,
        y1 = y - inner,
        y2 = y + inner,
    ));
}

/// 绘制 `box` 分组框背景：覆盖 box 内所有参与者的横向区域，从参与者框底部到图底部。
fn append_participant_box_background(
    s: &mut String,
    ir: &SequenceDiagram,
    g: &SequenceGeom,
    pbox: &ParticipantBox,
) {
    if pbox.participant_ids.is_empty() {
        return;
    }

    // 找到 box 内参与者的最左和最右中心 X 坐标
    let mut x_min = f64::MAX;
    let mut x_max = f64::MIN;
    let mut found_any = false;

    for pid in &pbox.participant_ids {
        if let Some(cx) = col_x(g, ir, pid) {
            x_min = x_min.min(cx);
            x_max = x_max.max(cx);
            found_any = true;
        }
    }

    if !found_any {
        return;
    }

    // box 背景从参与者框底部延伸到图底部
    let y_participant = g.page_header_band_height + g.title_band_height + PARTICIPANT_TOP_PAD;
    let strip_total = g.header_bottom - g.page_header_band_height - g.title_band_height;
    let box_h = (strip_total - PARTICIPANT_TOP_PAD - PARTICIPANT_GAP_BELOW)
        .max(PARTICIPANT_LINE_HEIGHT + 8.0);
    let y_top = y_participant + box_h;
    let y_bot = g.lifeline_bottom_y;

    // 背景矩形：左右各扩展 10px，含圆角
    const PAD: f64 = 10.0;
    const EXTEND: f64 = 10.0;
    let x = x_min - EXTEND - PAD;
    let w = (x_max - x_min) + 2.0 * EXTEND + 2.0 * PAD;
    let h = (y_bot - y_top).max(20.0);

    // 颜色：使用 box 指定的颜色或默认浅色
    let fill_color = pbox.color.as_deref().unwrap_or("rgb(245,248,250)");
    let title_text = pbox.title.as_deref().unwrap_or("");

    s.push_str(&format!(
        r#"<rect x="{x}" y="{y_top}" width="{w}" height="{h}" rx="8" fill='{fill_color}' stroke='rgb(170,175,195)' stroke-width="1" stroke-dasharray="3 3" opacity="0.85"/>"#,
    ));

    // 绘制标题（如果有）
    if !title_text.is_empty() {
        let title_x = x + 12.0;
        let title_y = y_top + 16.0;
        let esc_title = escape_xml(title_text);
        s.push_str(&format!(
            r#"<text x="{title_x}" y="{title_y}" font-family="system-ui,sans-serif" font-size="11" font-style="italic" fill='rgb(80,80,90)'>{esc_title}</text>"#,
        ));
    }
}

/// 生成单页 SVG 字符串（无 XML 声明，与 JAR 路径前端处理一致）。
pub fn render_sequence_svg(ir: &SequenceDiagram, g: &SequenceGeom) -> String {
    let w = g.width;
    let h = g.height;
    let mut s = String::new();

    s.push_str(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">"#
    ));
    s.push_str(
        r#"<defs><marker id="mArrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill='rgb(34,34,34)'/></marker><marker id="mOpenArrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0.5,0.5 L0.5,5.5 L8.5,3 z" fill="none" stroke='rgb(34,34,34)' stroke-width="1.15" stroke-linejoin="round"/></marker></defs>"#,
    );
    s.push_str(r#"<rect x="0" y="0" width="100%" height="100%" fill='rgb(250,250,250)'/>"#);

    append_diagram_page_header(&mut s, ir);
    append_diagram_title(&mut s, ir, w, g.page_header_band_height);

    let mut frag_cursor = 0usize;
    append_fragment_backgrounds(&mut s, &ir.body, &mut frag_cursor, w, g);
    debug_assert_eq!(frag_cursor, ir.layout_row_count());

    let n = ir.participants.len().max(1);
    let bottom_y = g.lifeline_bottom_y;
    let lifeline_stop_y = lifeline_destroy_stop_y(ir, g);
    let y_participant = g.page_header_band_height + g.title_band_height + PARTICIPANT_TOP_PAD;
    let strip_total = g.header_bottom - g.page_header_band_height - g.title_band_height;
    let box_h = (strip_total - PARTICIPANT_TOP_PAD - PARTICIPANT_GAP_BELOW)
        .max(PARTICIPANT_LINE_HEIGHT + 8.0);
    let box_w = SEQUENCE_LANE_INNER_WIDTH;
    let arrow_inset = MESSAGE_ARROW_LIFELINE_INSET;

    // 参与者框 + 生命线
    if ir.participants.is_empty() {
        s.push_str(&format!(
            r#"<text x="{}" y="{}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill='rgb(102,102,102)'>{}</text>"#,
            w / 2.0,
            y_participant + 16.0,
            escape_xml("（空序列图）")
        ));
    } else {
        for (i, p) in ir.participants.iter().enumerate() {
            let cx = g.col_center_x[i];
            let bx = cx - box_w / 2.0;
            let by = y_participant;
            s.push_str(&format!(
                r#"<rect x="{bx}" y="{by}" width="{box_w}" height="{box_h}" rx="4" fill='white' stroke='rgb(51,51,51)' stroke-width="1"/>"#
            ));
            let lines = participant_header_lines(p);
            let line_count = lines.len().max(1);
            let text_block_h = line_count as f64 * PARTICIPANT_LINE_HEIGHT;
            let text_y0 =
                by + ((box_h - text_block_h).max(0.0)) / 2.0 + PARTICIPANT_LINE_HEIGHT * 0.78;
            for (li, line) in lines.iter().enumerate() {
                let ty = text_y0 + li as f64 * PARTICIPANT_LINE_HEIGHT;
                let esc = escape_xml(line);
                s.push_str(&format!(
                    r#"<text x="{cx}" y="{ty}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill='rgb(17,17,17)'>{esc}</text>"#
                ));
            }
            let y1 = by + box_h;
            let y2 = lifeline_stop_y
                .get(p.id.as_str())
                .copied()
                .unwrap_or(bottom_y);
            let y2 = y2.max(y1);
            s.push_str(&format!(
                r#"<line x1="{cx}" y1="{y1}" x2="{cx}" y2="{y2}" stroke='rgb(136,136,136)' stroke-width="1" stroke-dasharray="4 3"/>"#
            ));
        }
    }

    for sp in &ir.activation_spans {
        let Some((y_top, y_bot)) = activation_y_range(sp, g, &lifeline_stop_y) else {
            continue;
        };
        let Some(cx) = col_x(g, ir, &sp.participant_id) else {
            continue;
        };
        let h = (y_bot - y_top).max(6.0);
        let act_w = SEQUENCE_ACTIVATION_BAR_WIDTH;
        let bx = cx - act_w / 2.0;
        s.push_str(&format!(
            r#"<rect x="{bx}" y="{y_top}" width="{act_w}" height="{h}" fill='rgb(214,227,248)' stroke='rgb(142,170,219)' stroke-width="0.75" opacity="0.92"/>"#,
        ));
    }

    // 绘制 box 分组背景（在所有生命线之后、消息之前）
    for pbox in &ir.boxes {
        append_participant_box_background(&mut s, ir, g, pbox);
    }

    let mut row_i = 0usize;
    let mut msg_k = 0usize;
    ir.for_each_layout_row(|row| {
        let Some(y) = g.message_y.get(row_i).copied() else {
            return;
        };
        row_i += 1;

        match row {
            LayoutRow::Message(msg) => {
                let k = msg_k;
                msg_k += 1;
                let Some(x1) = col_x(g, ir, &msg.from) else {
                    return;
                };
                let Some(x2) = col_x(g, ir, &msg.to) else {
                    return;
                };
                let (marker_end, dash_attr) = match msg.arrow {
                    MessageArrow::Solid => ("url(#mArrow)", ""),
                    MessageArrow::Dashed => ("url(#mArrow)", r#" stroke-dasharray="5 4""#),
                    MessageArrow::AsyncSolid => ("url(#mOpenArrow)", ""),
                    MessageArrow::AsyncDashed => ("url(#mOpenArrow)", r#" stroke-dasharray="5 4""#),
                };
                // 解析颜色：支持颜色名和十六进制
                let stroke_color = resolve_color(&msg.color);
                let mid = if msg.from == msg.to {
                    let cx = x1;
                    let x0 = cx + arrow_inset;
                    let xr = cx + SEQUENCE_SELF_MESSAGE_LOOP_OUT;
                    let yb = y + SEQUENCE_SELF_MESSAGE_LOOP_DEPTH;
                    s.push_str(&format!(
                        r#"<polyline points="{x0},{y} {xr},{y} {xr},{yb} {x0},{yb}" fill="none" stroke='{stroke_color}' stroke-width="1.25" marker-end="{marker_end}"{dash_attr}"/>"#
                    ));
                    (x0 + xr) / 2.0
                } else {
                    let (xa, xb) = if x1 <= x2 {
                        (x1 + arrow_inset, x2 - arrow_inset)
                    } else {
                        (x1 - arrow_inset, x2 + arrow_inset)
                    };
                    s.push_str(&format!(
                        r#"<line x1="{xa}" y1="{y}" x2="{xb}" y2="{y}" stroke='{stroke_color}' stroke-width="1.25" marker-end="{marker_end}"{dash_attr}/>"#
                    ));
                    (xa + xb) / 2.0
                };
                let display_lines = message_lines_with_autonumber(&msg.label, k as u32, ir.autonumber_start);
                let nonempty: Vec<&str> = display_lines
                    .iter()
                    .map(|s| s.as_str())
                    .filter(|t| !t.trim().is_empty())
                    .collect();
                if !nonempty.is_empty() {
                    let n_lines = nonempty.len();
                    let y_last = y - 6.0;
                    let y_first = y_last - (n_lines as f64 - 1.0) * MESSAGE_LABEL_LINE_HEIGHT;
                    for (i, line) in nonempty.iter().enumerate() {
                        let ty = y_first + i as f64 * MESSAGE_LABEL_LINE_HEIGHT;
                        let esc = escape_xml(line);
                        s.push_str(&format!(
                            r#"<text x="{mid}" y="{ty}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill='rgb(34,34,34)'>{esc}</text>"#
                        ));
                    }
                }
            }
            LayoutRow::Note(n) => {
                append_note_row(&mut s, ir, g, n, y);
            }
            LayoutRow::Create { participant_id } => {
                let Some(cx) = col_x(g, ir, participant_id) else {
                    return;
                };
                append_create_marker(&mut s, cx, y);
            }
            LayoutRow::Destroy { participant_id } => {
                let Some(cx) = col_x(g, ir, participant_id) else {
                    return;
                };
                append_destroy_marker(&mut s, cx, y);
            }
            LayoutRow::Delay(delay) => {
                append_delay_row(&mut s, w, y, delay);
            }
            LayoutRow::Divider(divider) => {
                append_divider_row(&mut s, ir, g, y, divider);
            }
            LayoutRow::Ref(ref_item) => {
                append_ref_row(&mut s, ir, g, y, ref_item);
            }
            LayoutRow::Newpage { title } => {
                append_newpage_row(&mut s, w, y, title);
            }
        }
    });

    append_diagram_legend(&mut s, ir, g, w);
    append_diagram_page_footer(&mut s, ir, g, w);

    let _ = n; // silence if unused in future tweaks
    s.push_str("</svg>");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plantuml_native::ir::{
        ActivationSpan, AltSection, DiagramLegend, LegendAlign, MessageArrow,
        SequenceBodyItem, SequenceDelayKind, SequenceDiagram, SequenceMessage, SequenceParticipant,
    };
    use crate::plantuml_native::layout::{
        plan_sequence, MESSAGE_ARROW_LIFELINE_INSET, SEQUENCE_ACTIVATION_BAR_WIDTH,
        SEQUENCE_LANE_INNER_WIDTH,
    };

    fn norm_ws(t: &str) -> String {
        t.chars().filter(|c| !c.is_whitespace()).collect()
    }

    #[test]
    fn svg_contains_activation_rect_when_spans_set() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "m".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            activation_spans: vec![ActivationSpan {
                participant_id: "A".into(),
                start_msg_index: 0,
                end_msg_index: 1,
            }],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("rgb(214,227,248)"), "{svg}");
    }

    #[test]
    fn autonumber_prefix_in_message_text() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "ping".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            autonumber_start: Some(1),
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("1. ping"), "{svg}");
    }

    #[test]
    fn alt_fragment_draws_dashed_background_band() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Alt {
                sections: vec![AltSection {
                    label: "x".into(),
                    body: vec![SequenceBodyItem::Message(SequenceMessage {
                        from: "A".into(),
                        to: "B".into(),
                        label: "m".into(),
                        arrow: MessageArrow::Solid,
                        activate_target: false,
                        deactivate_source: false,
                color: None,
                    })],
                }],
            }],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("stroke-dasharray=\"5 4\""), "{svg}");
        assert!(svg.contains("rgb(245,245,250)"), "{svg}");
    }

    #[test]
    fn delay_dots_renders_horizontal_dashed_line() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![
                SequenceBodyItem::Message(SequenceMessage {
                    from: "A".into(),
                    to: "B".into(),
                    label: "m".into(),
                    arrow: MessageArrow::Solid,
                    activate_target: false,
                    deactivate_source: false,
                color: None,
                }),
                SequenceBodyItem::Delay(SequenceDelay {
                    kind: SequenceDelayKind::Dots,
                    text: None,
                }),
            ],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains(r#"stroke-dasharray="2 6""#), "{svg}");
    }

    #[test]
    fn delay_bars_renders_vertical_marks() {
        let ir = SequenceDiagram {
            participants: vec![SequenceParticipant::id_only("A")],
            body: vec![SequenceBodyItem::Delay(SequenceDelay {
                kind: SequenceDelayKind::Bars,
                text: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("rgb(130,132,145)"), "{svg}");
    }

    #[test]
    fn async_message_renders_open_arrow_marker() {
        let ir = crate::plantuml_native::parse::parse_sequence_diagram(
            "@startuml\nA ->> B : call\n@enduml",
        )
        .unwrap();
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("mOpenArrow"), "{svg}");
        assert!(svg.contains("url(#mOpenArrow)"), "{svg}");
    }

    #[test]
    fn destroy_renders_cross_marker() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![
                SequenceBodyItem::Message(SequenceMessage {
                    from: "A".into(),
                    to: "B".into(),
                    label: "ping".into(),
                    arrow: MessageArrow::Solid,
                    activate_target: false,
                    deactivate_source: false,
                color: None,
                }),
                SequenceBodyItem::Destroy {
                    participant_id: "B".into(),
                },
            ],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(
            svg.matches("rgb(180,60,60)").count() >= 2,
            "expected X strokes, got {svg}"
        );
    }

    #[test]
    fn golden_minimal_two_participants() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "ping".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("<svg"));
        let compact = norm_ws(&svg);
        assert!(compact.contains("ping"));
        assert!(compact.contains("&lt;") == false);
        assert!(compact.contains("<path")); // arrow marker
    }

    /// 箭头端点用生命线侧小 inset（与激活条半宽一致），勿用表头半宽（会使相邻泳道间仅剩 ~16px）。
    #[test]
    fn message_arrow_skips_header_box_halfwidth() {
        const MARGIN: f64 = 28.0;
        const LANE: f64 = 128.0;
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
                SequenceParticipant::id_only("C"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "C".into(),
                label: "span".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        let x_a = MARGIN + LANE * 0.5;
        let x_c = MARGIN + LANE * 2.5;
        let inset = MESSAGE_ARROW_LIFELINE_INSET;
        let xa = x_a + inset;
        let xb = x_c - inset;
        assert!(
            (xb - xa) > (LANE * 2.0 - SEQUENCE_LANE_INNER_WIDTH),
            "expected long arrow from A to C, got xa={xa} xb={xb}"
        );
        assert!(
            (inset - SEQUENCE_ACTIVATION_BAR_WIDTH / 2.0).abs() < f64::EPSILON,
            "inset should match activation half-width for visual join"
        );
        assert!(svg.contains(&format!(r#"x1="{xa}""#)), "{svg}");
        assert!(svg.contains(&format!(r#"x2="{xb}""#)), "{svg}");
    }

    #[test]
    fn diagram_title_renders_in_svg() {
        let ir = SequenceDiagram {
            title: Some("My Flow".into()),
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "x".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("My Flow"), "{svg}");
    }

    #[test]
    fn diagram_legend_renders_in_svg() {
        let ir = SequenceDiagram {
            legend: Some(DiagramLegend {
                text: "Footnote here".into(),
                align: LegendAlign::Left,
            }),
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "p".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("Footnote here"), "{svg}");
        assert!(svg.contains(r#"text-anchor="start""#), "{svg}");
    }

    #[test]
    fn page_header_and_footer_render_in_svg() {
        let ir = SequenceDiagram {
            page_header: Some("Doc header".into()),
            title: Some("T".into()),
            page_footer: Some("Doc footer".into()),
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "m".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("Doc header"), "{svg}");
        assert!(svg.contains("Doc footer"), "{svg}");
        assert!(svg.contains("T"), "{svg}");
        assert!(svg.contains(r#"text-anchor="start""#), "{svg}");
    }

    #[test]
    fn header_uses_display_when_set() {
        let ir = SequenceDiagram {
            participants: vec![SequenceParticipant {
                id: "d".into(),
                display: Some("表头展示".into()),
                is_created: false,
            }],
            body: vec![],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("表头展示"), "{svg}");
    }

    #[test]
    fn escapes_angle_brackets_in_label() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "a < b".into(),
                arrow: MessageArrow::Dashed,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("&lt;"));
        assert!(!svg.contains("<b>")); // not raw tag from user content
    }

    #[test]
    fn message_multiline_label_renders_two_text_elements() {
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "B".into(),
                label: "u\nv".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains(">u</text>"), "{svg}");
        assert!(svg.contains(">v</text>"), "{svg}");
        assert!(!svg.contains("\\n"), "{svg}");
    }

    #[test]
    fn self_message_renders_polyline_loop() {
        let ir = SequenceDiagram {
            participants: vec![SequenceParticipant::id_only("A")],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "A".into(),
                label: "recurse".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        let svg = render_sequence_svg(&ir, &g);
        assert!(svg.contains("<polyline"), "{svg}");
        assert!(svg.contains("recurse"), "{svg}");
    }
}
