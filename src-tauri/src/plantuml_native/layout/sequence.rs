//! 序列图泳道几何（简单网格）。

use crate::plantuml_native::ir::{DiagramLegend, LayoutRow, SequenceDiagram, SequenceParticipant};
use crate::plantuml_native::NativeError;

/// 参与者列数上限（防极端笔记拖垮布局）。
pub const MAX_SEQUENCE_PARTICIPANTS: usize = 64;
/// 消息条数上限。
pub const MAX_SEQUENCE_MESSAGES: usize = 400;

const LANE_WIDTH: f64 = 128.0;
/// 参与者框可用宽度（泳道左右各留 8px）。
pub const SEQUENCE_LANE_INNER_WIDTH: f64 = LANE_WIDTH - 16.0;
const MARGIN: f64 = 28.0;
const HEADER_HEIGHT: f64 = 42.0;
/// 参与者名折行后每行高度（须与 SVG 一致）。
pub const PARTICIPANT_LINE_HEIGHT: f64 = 14.0;
/// 标题带与参与者框之间的留白。
pub const PARTICIPANT_TOP_PAD: f64 = 8.0;
/// 参与者框底到首条消息行的间距。
pub const PARTICIPANT_GAP_BELOW: f64 = 6.0;
/// 消息标签每多一行增加的布局行高（须与 SVG 多行标签匹配）。
pub const MESSAGE_LABEL_LINE_HEIGHT: f64 = 14.0;
/// 激活条宽度（须与 `svg/sequence.rs` 中矩形一致）。
pub const SEQUENCE_ACTIVATION_BAR_WIDTH: f64 = 5.0;
/// 箭头端点距泳道中心的水平距离：取 **激活条半宽**，使消息线与蓝色激活块外缘相接；勿用表头半宽（~56），亦勿过大（会与激活块脱节）。
pub const MESSAGE_ARROW_LIFELINE_INSET: f64 = SEQUENCE_ACTIVATION_BAR_WIDTH / 2.0;
/// 自调用消息 `A -> A`：回环线向右伸出（从泳道中心计）。
pub const SEQUENCE_SELF_MESSAGE_LOOP_OUT: f64 = 52.0;
/// 自调用回环竖边深度（自消息锚点 `y` 向下）。
pub const SEQUENCE_SELF_MESSAGE_LOOP_DEPTH: f64 = 26.0;
const TITLE_LINE_HEIGHT: f64 = 16.0;
const TITLE_PAD_TOP: f64 = 8.0;
const TITLE_PAD_BOTTOM: f64 = 6.0;
/// 每条消息行高（与 SVG 中激活条纵向范围一致）。
pub const SEQUENCE_ROW_HEIGHT: f64 = 42.0;
/// `destroy` 占位行高（须与 SVG 中终止标记纵向范围一致）。
pub const SEQUENCE_DESTROY_ROW_HEIGHT: f64 = 28.0;
/// `...` / `|||` 延迟行占位高度（须与 SVG 一致）。
pub const SEQUENCE_DELAY_ROW_HEIGHT: f64 = 26.0;
const ROW_HEIGHT: f64 = SEQUENCE_ROW_HEIGHT;
const DESTROY_ROW_HEIGHT: f64 = SEQUENCE_DESTROY_ROW_HEIGHT;
const DELAY_ROW_HEIGHT: f64 = SEQUENCE_DELAY_ROW_HEIGHT;
const FOOTER_MARGIN: f64 = 28.0;
const LEGEND_LINE_HEIGHT: f64 = 13.0;
const LEGEND_PAD: f64 = 10.0;

/// 列中心 x、每行消息基线 y 等。
#[derive(Debug, Clone)]
pub struct SequenceGeom {
    pub width: f64,
    pub height: f64,
    /// 页眉文本区高度（无页眉时为 0）。
    pub page_header_band_height: f64,
    /// 顶部标题区高度（无标题时为 0）。
    pub title_band_height: f64,
    /// 页脚文本区高度（无页脚时为 0）；与总高度公式一致，供测试或外部读取。
    #[allow(dead_code)]
    pub page_footer_band_height: f64,
    /// 每个参与者的列中心 x
    pub col_center_x: Vec<f64>,
    #[allow(dead_code)]
    pub header_bottom: f64,
    /// 每条消息箭头的 y（自上而下）
    pub message_y: Vec<f64>,
    /// 历史字段：默认行高：仍暴露为 `SEQUENCE_ROW_HEIGHT`，新代码请用 `row_heights`。
    #[allow(dead_code)]
    pub row_height: f64,
    /// 底部图例区高度（无图例时为 0）；与布局公式一致，供调用方或测试断言。
    #[allow(dead_code)]
    pub legend_band_height: f64,
    /// 生命线终点 y（图例区上方，与 SVG 一致）。
    pub lifeline_bottom_y: f64,
    /// 每条布局行（消息或注释）的高度，与 `message_y` 一一对应。
    pub row_heights: Vec<f64>,
    /// 每条布局行顶边 y。
    pub row_top: Vec<f64>,
    /// 每条布局行底边 y。
    pub row_bottom: Vec<f64>,
    /// 第 i 条消息（`all_messages` 顺序）对应的布局行下标（注释不占消息下标）。
    pub message_layout_row: Vec<usize>,
}

fn layout_err(detail: impl Into<String>) -> NativeError {
    NativeError::Layout {
        detail: detail.into(),
    }
}

fn title_band_height(title: Option<&String>) -> f64 {
    let Some(t) = title else {
        return 0.0;
    };
    if t.trim().is_empty() {
        return 0.0;
    }
    let n = t.lines().filter(|l| !l.trim().is_empty()).count().max(1);
    TITLE_PAD_TOP + n as f64 * TITLE_LINE_HEIGHT + TITLE_PAD_BOTTOM
}

fn legend_band_height(legend: Option<&DiagramLegend>) -> f64 {
    let Some(l) = legend else {
        return 0.0;
    };
    if l.text.trim().is_empty() {
        return 0.0;
    }
    let n = l
        .text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
        .max(1);
    LEGEND_PAD + n as f64 * LEGEND_LINE_HEIGHT + LEGEND_PAD
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let n = s.chars().count();
    if n <= max_chars {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max_chars).collect();
        t.push('…');
        t
    }
}

/// 纯 ASCII 类名（如 `CalendarProvider`）按字符折行上限（与 12px 比例体粗估）。
const PARTICIPANT_CHARS_PER_LINE_ASCII: usize = 22;
const PARTICIPANT_MAX_TOTAL_CHARS: usize = 80;
/// 含非 ASCII 时按「显示宽度」折行：CJK 等宽约为拉丁的 2 倍；上限与 `SEQUENCE_LANE_INNER_WIDTH` 上 12px 字体匹配（约 9 个汉字宽）。
const PARTICIPANT_LINE_MAX_DISPLAY_UNITS: usize = 18;

#[inline]
fn char_display_units(c: char) -> usize {
    if c.is_ascii() {
        1
    } else {
        2
    }
}

fn wrap_by_char_width(s: &str, line_max_chars: usize) -> Vec<String> {
    let s = s.trim();
    if s.is_empty() {
        return vec![String::new()];
    }
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if cur.chars().count() >= line_max_chars {
            out.push(std::mem::take(&mut cur));
        }
        cur.push(ch);
    }
    if !cur.is_empty() || out.is_empty() {
        out.push(cur);
    }
    out
}

fn wrap_by_display_units(s: &str, max_units: usize) -> Vec<String> {
    let s = s.trim();
    if s.is_empty() {
        return vec![String::new()];
    }
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_units = 0usize;
    for ch in s.chars() {
        let u = char_display_units(ch);
        if !cur.is_empty() && cur_units + u > max_units {
            out.push(std::mem::take(&mut cur));
            cur_units = 0;
        }
        cur.push(ch);
        cur_units += u;
    }
    if !cur.is_empty() || out.is_empty() {
        out.push(cur);
    }
    out
}

/// 参与者表头折行（布局高度与 SVG 绘制须共用此函数）。
pub fn participant_header_lines(p: &SequenceParticipant) -> Vec<String> {
    let raw = p.display.as_deref().unwrap_or(p.id.as_str());
    let t = truncate_chars(raw, PARTICIPANT_MAX_TOTAL_CHARS);
    if t.chars().all(|c| c.is_ascii()) {
        wrap_by_char_width(&t, PARTICIPANT_CHARS_PER_LINE_ASCII)
    } else {
        wrap_by_display_units(&t, PARTICIPANT_LINE_MAX_DISPLAY_UNITS)
    }
}

fn participant_strip_height(ir: &SequenceDiagram) -> f64 {
    if ir.participants.is_empty() {
        return HEADER_HEIGHT;
    }
    let max_lines = ir
        .participants
        .iter()
        .map(|p| participant_header_lines(p).len().max(1))
        .max()
        .unwrap_or(1);
    let box_h = max_lines as f64 * PARTICIPANT_LINE_HEIGHT + 8.0;
    PARTICIPANT_TOP_PAD + box_h + PARTICIPANT_GAP_BELOW
}

fn layout_row_height(row: LayoutRow<'_>) -> f64 {
    match row {
        LayoutRow::Message(m) => {
            let nl = m.label.lines().count().max(1);
            let mut h = ROW_HEIGHT + (nl.saturating_sub(1)) as f64 * MESSAGE_LABEL_LINE_HEIGHT;
            if m.from == m.to {
                h += SEQUENCE_SELF_MESSAGE_LOOP_DEPTH + 10.0;
            }
            h
        }
        LayoutRow::Note(_) => ROW_HEIGHT,
        LayoutRow::Create { .. } => DESTROY_ROW_HEIGHT, // 创建标记高度与销毁标记相同
        LayoutRow::Destroy { .. } => DESTROY_ROW_HEIGHT,
        LayoutRow::Delay(d) => {
            // 带文案的延迟行需要额外高度
            if d.text.is_some() {
                ROW_HEIGHT
            } else {
                DELAY_ROW_HEIGHT
            }
        }
        LayoutRow::Divider(_) => DELAY_ROW_HEIGHT, // 分割线高度与延迟行类似
        LayoutRow::Ref(_) => ROW_HEIGHT, // ref 高度与消息行类似
        LayoutRow::Newpage { .. } => ROW_HEIGHT * 1.5, // newpage 分页标记需要稍高空间
    }
}

pub fn plan_sequence(ir: &SequenceDiagram) -> Result<SequenceGeom, NativeError> {
    if ir.participants.len() > MAX_SEQUENCE_PARTICIPANTS {
        return Err(layout_err(format!(
            "参与者过多（{}，上限 {MAX_SEQUENCE_PARTICIPANTS}）",
            ir.participants.len()
        )));
    }
    let msg_count = ir.all_messages().len();
    if msg_count > MAX_SEQUENCE_MESSAGES {
        return Err(layout_err(format!(
            "消息过多（{}，上限 {MAX_SEQUENCE_MESSAGES}）",
            msg_count
        )));
    }

    let row_count = ir.layout_row_count();
    let n = ir.participants.len().max(1);
    let width = MARGIN * 2.0 + LANE_WIDTH * n as f64;
    let page_header_band = title_band_height(ir.page_header.as_ref());
    let title_band = title_band_height(ir.title.as_ref());
    let page_footer_band = title_band_height(ir.page_footer.as_ref());
    let participant_band = participant_strip_height(ir);
    let header_bottom = page_header_band + title_band + participant_band;

    let mut row_heights: Vec<f64> = Vec::new();
    let mut row_top: Vec<f64> = Vec::new();
    let mut row_bottom: Vec<f64> = Vec::new();
    let mut message_y: Vec<f64> = Vec::new();
    let mut message_layout_row: Vec<usize> = Vec::new();

    let mut y_cursor = header_bottom;
    ir.for_each_layout_row(|row| {
        let h = layout_row_height(row);
        row_top.push(y_cursor);
        row_bottom.push(y_cursor + h);
        message_y.push(y_cursor + h / 2.0);
        if matches!(row, LayoutRow::Message(_)) {
            message_layout_row.push(row_heights.len());
        }
        row_heights.push(h);
        y_cursor += h;
    });

    let body_h = if row_count == 0 {
        ROW_HEIGHT
    } else {
        y_cursor - header_bottom
    };
    let lifeline_bottom_y = header_bottom + body_h;
    let legend_band = legend_band_height(ir.legend.as_ref());
    let height = lifeline_bottom_y + legend_band + page_footer_band + FOOTER_MARGIN;

    let col_center_x: Vec<f64> = (0..ir.participants.len().max(1))
        .map(|i| MARGIN + LANE_WIDTH * (i as f64 + 0.5))
        .collect();

    Ok(SequenceGeom {
        width,
        height,
        page_header_band_height: page_header_band,
        title_band_height: title_band,
        page_footer_band_height: page_footer_band,
        col_center_x,
        header_bottom,
        message_y,
        row_height: ROW_HEIGHT,
        legend_band_height: legend_band,
        lifeline_bottom_y,
        row_heights,
        row_top,
        row_bottom,
        message_layout_row,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plantuml_native::ir::{
        MessageArrow, NotePlacement, NoteShape, SequenceBodyItem, SequenceDelay, SequenceDiagram, SequenceMessage,
        SequenceParticipant,
    };

    #[test]
    fn too_many_participants_fails() {
        let p: Vec<SequenceParticipant> = (0..65)
            .map(|i| SequenceParticipant::id_only(format!("P{i}")))
            .collect();
        let ir = SequenceDiagram {
            participants: p,
            body: vec![],
            ..Default::default()
        };
        assert!(matches!(
            plan_sequence(&ir),
            Err(NativeError::Layout { .. })
        ));
    }

    #[test]
    fn empty_diagram_has_geometry() {
        let ir = SequenceDiagram {
            participants: vec![],
            body: vec![],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        assert!(g.width >= 180.0);
        assert!(g.height >= 80.0);
        assert_eq!(g.col_center_x.len(), 1);
    }

    #[test]
    fn message_rows_match_count() {
        let one = SequenceMessage {
            from: "A".into(),
            to: "B".into(),
            label: "x".into(),
            arrow: MessageArrow::Solid,
            activate_target: false,
            deactivate_source: false,
                color: None,
        };
        let ir = SequenceDiagram {
            participants: vec![
                SequenceParticipant::id_only("A"),
                SequenceParticipant::id_only("B"),
            ],
            body: vec![
                SequenceBodyItem::Message(one.clone()),
                SequenceBodyItem::Message(one.clone()),
                SequenceBodyItem::Message(one),
            ],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        assert_eq!(g.message_y.len(), 3);
    }

    #[test]
    fn note_adds_layout_row() {
        use crate::plantuml_native::ir::{NotePlacement, SequenceNote};
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
                SequenceBodyItem::Note(SequenceNote {
                    placement: NotePlacement::Over1("A".into()),
                    text: "n".into(),
                    shape: NoteShape::Standard,
                }),
            ],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        assert_eq!(g.message_y.len(), 2);
    }

    #[test]
    fn destroy_adds_compact_layout_row() {
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
                SequenceBodyItem::Destroy {
                    participant_id: "B".into(),
                },
            ],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        assert_eq!(g.row_heights.len(), 2);
        assert!(
            g.row_heights[1] < super::ROW_HEIGHT - 1.0,
            "destroy row should be shorter than message row"
        );
    }

    #[test]
    fn delay_adds_layout_row() {
        use crate::plantuml_native::ir::SequenceDelayKind;
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
        assert_eq!(g.message_y.len(), 2);
        assert_eq!(g.row_heights[1], super::SEQUENCE_DELAY_ROW_HEIGHT);
    }

    #[test]
    fn title_increases_header_bottom() {
        let ir = SequenceDiagram {
            title: Some("T1\nT2".into()),
            participants: vec![],
            body: vec![],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        assert!(g.title_band_height > 0.0);
        assert!(g.header_bottom > super::HEADER_HEIGHT);
    }

    #[test]
    fn legend_adds_height_and_lifeline_stops_above() {
        use crate::plantuml_native::ir::{DiagramLegend, LegendAlign};
        let ir = SequenceDiagram {
            legend: Some(DiagramLegend {
                text: "L1\nL2".into(),
                align: LegendAlign::Center,
            }),
            participants: vec![],
            body: vec![],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        assert!(g.legend_band_height > 0.0);
        let h_no_legend = super::HEADER_HEIGHT + super::ROW_HEIGHT + super::FOOTER_MARGIN;
        assert!(g.height > h_no_legend);
        assert_eq!(g.lifeline_bottom_y, g.header_bottom + super::ROW_HEIGHT);
    }

    #[test]
    fn participant_header_cjk_wraps_by_display_units() {
        let p = SequenceParticipant {
            id: "x".into(),
            display: Some("日历-日历视图渲染模块".into()),
            is_created: false,
        };
        let lines = participant_header_lines(&p);
        assert!(lines.len() >= 2, "{lines:?}");
        let cap = super::PARTICIPANT_LINE_MAX_DISPLAY_UNITS;
        for line in &lines {
            let u: usize = line.chars().map(super::char_display_units).sum();
            assert!(
                u <= cap,
                "line exceeds display width budget: {line:?} units={u} cap={cap}"
            );
        }
    }

    #[test]
    fn self_message_taller_layout_row() {
        let ir = SequenceDiagram {
            participants: vec![SequenceParticipant::id_only("A")],
            body: vec![SequenceBodyItem::Message(SequenceMessage {
                from: "A".into(),
                to: "A".into(),
                label: "s".into(),
                arrow: MessageArrow::Solid,
                activate_target: false,
                deactivate_source: false,
                color: None,
            })],
            ..Default::default()
        };
        let g = plan_sequence(&ir).unwrap();
        assert_eq!(g.row_heights.len(), 1);
        assert!(
            g.row_heights[0] > super::ROW_HEIGHT + 1.0,
            "self row should reserve loop depth, got {}",
            g.row_heights[0]
        );
    }
}
