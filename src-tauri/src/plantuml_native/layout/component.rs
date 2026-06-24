//! 组件图几何布局：计算节点坐标与边路径（支持嵌套 package）。
//!
//! 簇内若存在 **子节点之间的有向边**，优先使用 [`rust_sugiyama`]（Sugiyama 分层布局）排布同级子节点；
//! 否则回退为原有网格/带状布局。

use crate::plantuml_native::ir::{
    ComponentDiagram, ComponentNode, ComponentNote, ComponentShape, NotePosition,
};
use crate::plantuml_native::NativeError;
use rust_sugiyama::configure::Config;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// 节点几何信息。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NodeGeom {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl NodeGeom {
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
}

/// 边几何信息。
#[derive(Debug, Clone, PartialEq)]
pub struct EdgeGeom {
    pub from: (f64, f64), // 起点坐标
    pub to: (f64, f64),   // 终点坐标
    pub label_x: Option<f64>,
    pub label_y: Option<f64>,
}

/// 组件图布局结果。
#[derive(Debug, Clone, PartialEq)]
pub struct ComponentGeom {
    pub nodes: std::collections::HashMap<String, NodeGeom>,
    pub edges: Vec<EdgeGeom>,
    pub width: f64,
    pub height: f64,
}

const NODE_MIN_WIDTH: f64 = 120.0;
const NODE_MIN_HEIGHT: f64 = 60.0;
const NODE_GAP_H: f64 = 80.0;
const NODE_GAP_V: f64 = 60.0;
const MARGIN: f64 = 40.0;
const CONTAINER_PADDING: f64 = 30.0; // 容器内边距
const CONTAINER_HEADER_HEIGHT: f64 = 25.0; // 容器标题栏高度
const CHAR_WIDTH: f64 = 7.0; // 近似字符宽度

/// 同级子节点一项：最终外接矩形尺寸 + 可选嵌套布局（package 内子图）。
#[derive(Debug)]
struct ChildPayload {
    id: String,
    w: f64,
    h: f64,
    nested: Option<HashMap<String, NodeGeom>>,
}

fn sugiyama_cluster_config() -> Config {
    let mut c = Config::default();
    // 与 NODE_GAP_* 同量级，避免层内/层间距过密
    c.vertex_spacing = NODE_GAP_V.max(24.0);
    c.minimum_length = 2;
    // 避免 dummy 顶点路径在部分图上触发库内部整数下溢（rust-sugiyama 0.4）
    c.dummy_vertices = false;
    c
}

/// 若簇内至少有一条边连接 **两个同级子节点**，用 Sugiyama 计算各子节点外接矩形左上角（相对本簇 0,0）。
/// 若图不连通或库未覆盖全部顶点，返回 `None` 由调用方回退网格。
fn try_layout_cluster_sugiyama(
    ir: &ComponentDiagram,
    payloads: &[ChildPayload],
) -> Option<HashMap<String, NodeGeom>> {
    let n = payloads.len();
    if n < 2 {
        return None;
    }

    let id_to_idx: HashMap<String, u32> = payloads
        .iter()
        .enumerate()
        .map(|(i, p)| (p.id.clone(), i as u32))
        .collect();

    let mut edge_pairs: Vec<(u32, u32)> = Vec::new();
    for e in &ir.edges {
        if e.hidden {
            continue;
        }
        let (Some(&a), Some(&b)) = (id_to_idx.get(&e.from), id_to_idx.get(&e.to)) else {
            continue;
        };
        if a == b {
            continue;
        }
        edge_pairs.push((a, b));
    }
    edge_pairs.sort_unstable();
    edge_pairs.dedup();
    if edge_pairs.is_empty() {
        return None;
    }

    let vertices: Vec<(u32, (f64, f64))> = (0u32..n as u32)
        .map(|i| {
            let p = &payloads[i as usize];
            (i, (p.w, p.h))
        })
        .collect();

    let config = sugiyama_cluster_config();
    // rust-sugiyama 在少数边上/秩组合下可能 debug panic（attempt to subtract with overflow）；
    // 捕获后回退网格，避免整图渲染失败。
    let subgraphs = match catch_unwind(AssertUnwindSafe(|| {
        rust_sugiyama::from_vertices_and_edges(&vertices, &edge_pairs, &config)
    })) {
        Ok(s) => s,
        Err(_) => return None,
    };
    if subgraphs.is_empty() {
        return None;
    }

    let mut out: HashMap<String, NodeGeom> = HashMap::new();
    let mut cursor_x = 0.0_f64;

    for (sub_layout, sub_w, _sub_h) in subgraphs {
        if sub_layout.is_empty() {
            continue;
        }
        let min_x = sub_layout
            .iter()
            .map(|(_, (x, _))| *x)
            .fold(f64::INFINITY, f64::min);
        let min_y = sub_layout
            .iter()
            .map(|(_, (_, y))| *y)
            .fold(f64::INFINITY, f64::min);

        for (v, (x, y)) in &sub_layout {
            // 库返回的 id 为构图时的顶点序号（与本簇 0..n-1 一致）；越界则跳过，最终触发回退。
            let idx = *v;
            let Some(p) = payloads.get(idx) else {
                continue;
            };
            out.insert(
                p.id.clone(),
                NodeGeom {
                    x: x - min_x + cursor_x,
                    y: y - min_y,
                    w: p.w,
                    h: p.h,
                },
            );
        }
        cursor_x += sub_w + NODE_GAP_H;
    }

    if out.len() != n {
        return None;
    }
    Some(out)
}

/// 原网格策略：按 cols×rows 与列宽行高放置同级子节点外接矩形。
fn place_cluster_grid(
    payloads: &[ChildPayload],
    cols: usize,
    _rows: usize,
    col_widths: &[f64],
    row_heights: &[f64],
    x_base: f64,
    y_base: f64,
) -> HashMap<String, NodeGeom> {
    let mut m = HashMap::new();
    for (idx, p) in payloads.iter().enumerate() {
        let col = idx % cols;
        let row = idx / cols;
        let mut x = x_base;
        let mut y = y_base;
        for c in 0..col {
            x += col_widths[c] + NODE_GAP_H;
        }
        for r in 0..row {
            y += row_heights[r] + NODE_GAP_V;
        }
        m.insert(
            p.id.clone(),
            NodeGeom {
                x,
                y,
                w: p.w,
                h: p.h,
            },
        );
    }
    m
}

/// 计算组件图布局：使用递归布局算法支持嵌套 package。
pub fn plan_component(ir: &ComponentDiagram) -> Result<ComponentGeom, NativeError> {
    if ir.nodes.is_empty() {
        return Ok(ComponentGeom {
            nodes: HashMap::new(),
            edges: Vec::new(),
            width: MARGIN * 2.0,
            height: MARGIN * 2.0,
        });
    }

    // 构建节点尺寸映射
    let node_sizes: HashMap<String, (f64, f64)> = ir
        .nodes
        .iter()
        .map(|n| {
            let (w, h) = calc_node_size(n);
            (n.id.clone(), (w, h))
        })
        .collect();

    // 递归布局
    let mut nodes = HashMap::new();
    let mut x_offset = MARGIN;
    let mut y_offset = MARGIN;
    
    // 先布局顶级节点（无 parent_id 的节点）
    let top_level_nodes: Vec<&ComponentNode> = ir.nodes.iter()
        .filter(|n| n.parent_id.is_none())
        .collect();
    
    // 为顶级节点布局
    let mut container_map: HashMap<String, Vec<String>> = HashMap::new();
    for node in &ir.nodes {
        if let Some(ref parent) = node.parent_id {
            container_map.entry(parent.clone()).or_insert_with(Vec::new).push(node.id.clone());
        }
    }
    
    // 递归布局顶级节点及其子容器
    let all_nodes_ref: Vec<&ComponentNode> = ir.nodes.iter().collect();
    layout_nodes_recursive(
        ir,
        &top_level_nodes,
        &all_nodes_ref, // 传递全局节点引用
        &container_map,
        &node_sizes,
        &mut nodes,
        &mut x_offset,
        &mut y_offset,
        true, // 标记为顶层调用,需要添加到最终布局
    )?;

    // 计算边几何（hidden 边不参与布局连线）
    let edges: Vec<EdgeGeom> = ir
        .edges
        .iter()
        .filter(|e| !e.hidden)
        .filter_map(|e| {
            let from_geom = nodes.get(&e.from)?;
            let to_geom = nodes.get(&e.to)?;

            let (from_cx, from_cy) = from_geom.center();
            let (to_cx, to_cy) = to_geom.center();

            let (from_x, from_y) = intersect_node_boundary(from_geom, from_cx, from_cy, to_cx, to_cy);
            let (to_x, to_y) = intersect_node_boundary(to_geom, to_cx, to_cy, from_cx, from_cy);

            let label_x = (from_x + to_x) / 2.0;
            let label_y = (from_y + to_y) / 2.0 - 10.0;

            Some(EdgeGeom {
                from: (from_x, from_y),
                to: (to_x, to_y),
                label_x: e.label.as_ref().map(|_| label_x),
                label_y: e.label.as_ref().map(|_| label_y),
            })
        })
        .collect();

    // 计算总尺寸
    let total_width = nodes.values().map(|n| n.x + n.w).fold(0.0, f64::max) + MARGIN;
    let total_height = nodes.values().map(|n| n.y + n.h).fold(0.0, f64::max) + MARGIN;

    let mut geom = ComponentGeom {
        nodes,
        edges,
        width: total_width,
        height: total_height,
    };
    inflate_component_geom_for_notes(ir, &mut geom);
    Ok(geom)
}

const NOTE_BOX_WIDTH: f64 = 180.0;
const NOTE_GAP_FROM_NODE: f64 = 20.0;
const NOTE_OVER_GAP: f64 = 10.0;

fn note_text_box_size(note: &ComponentNote) -> (f64, f64) {
    let pad = 8.0_f64;
    let line_h = 16.0_f64;
    let lines = note.text.lines().count().max(1);
    let h = lines as f64 * line_h + pad * 2.0;
    (NOTE_BOX_WIDTH, h)
}

/// 将 `note right of` / `note over` 等便签占用的空间并入画布，避免 SVG 右侧/下方被裁切。
fn inflate_component_geom_for_notes(ir: &ComponentDiagram, geom: &mut ComponentGeom) {
    let mut max_rx = geom.width;
    let mut max_by = geom.height;

    for note in &ir.notes {
        let (nw, nh) = note_text_box_size(note);

        if note.position == NotePosition::Over && note.target_id_secondary.is_some() {
            let g1 = geom.nodes.get(&note.target_id);
            let g2 = note
                .target_id_secondary
                .as_ref()
                .and_then(|id| geom.nodes.get(id));
            if let (Some(g1), Some(g2)) = (g1, g2) {
                let min_left = g1.x.min(g2.x);
                let max_right = (g1.x + g1.w).max(g2.x + g2.w);
                let cx = (min_left + max_right) / 2.0;
                let top_y = g1.y.min(g2.y);
                let nx = cx - nw / 2.0;
                let ny = top_y - nh - NOTE_OVER_GAP;
                max_rx = max_rx.max(nx + nw);
                max_by = max_by.max(ny + nh);
            }
            continue;
        }

        let g = geom
            .nodes
            .get(&note.target_id)
            .or_else(|| note.target_id_secondary.as_ref().and_then(|id| geom.nodes.get(id)));
        let Some(g) = g else { continue };

        let (nx, ny) = match note.position {
            NotePosition::Right => (g.x + g.w + NOTE_GAP_FROM_NODE, g.y),
            NotePosition::Left => (g.x - nw - NOTE_GAP_FROM_NODE, g.y),
            NotePosition::Over => (
                g.x + g.w / 2.0 - nw / 2.0,
                g.y - nh - NOTE_OVER_GAP,
            ),
        };
        max_rx = max_rx.max(nx + nw);
        max_by = max_by.max(ny + nh);
    }

    geom.width = geom.width.max(max_rx + MARGIN * 0.5);
    geom.height = geom.height.max(max_by + MARGIN * 0.5);
}

/// 递归布局节点及其子容器
fn layout_nodes_recursive(
    ir: &ComponentDiagram,
    nodes: &[&ComponentNode],
    all_nodes: &[&ComponentNode], // 添加全局节点列表
    container_map: &HashMap<String, Vec<String>>,
    node_sizes: &HashMap<String, (f64, f64)>,
    layout: &mut HashMap<String, NodeGeom>,
    x_offset: &mut f64,
    y_offset: &mut f64,
    is_top_level: bool, // 是否顶层调用
) -> Result<(), NativeError> {
    if nodes.is_empty() {
        return Ok(());
    }
    
    // 对当前层级的节点进行智能布局
    let node_count = nodes.len();
    
    // 顶层两个并列 package（如「应用」与「外部依赖」）与 PlantUML JAR/Graphviz 常见左右分栏对齐。
    let (cols, rows): (usize, usize) = if is_top_level && node_count == 2 {
        (2, 1)
    } else if is_top_level && node_count <= 3 && node_count > 1 {
        (1, node_count)
    } else {
        // 计算所有节点的总宽度（包括间距）
        let total_width_with_gaps: f64 = nodes.iter()
            .map(|n| node_sizes[&n.id].0)
            .sum::<f64>() + (node_count as f64 - 1.0) * NODE_GAP_H;
        
        // 如果横向总宽度超过阈值，则使用垂直布局
        const MAX_HORIZONTAL_WIDTH: f64 = 1200.0;
        
        if total_width_with_gaps > MAX_HORIZONTAL_WIDTH && node_count > 1 {
            (1, node_count)
        } else {
            let cols = ((node_count as f64).sqrt().ceil() as usize).max(1);
            let rows = ((node_count + cols - 1) / cols).max(1);
            (cols, rows)
        }
    };
    
    let mut col_widths: Vec<f64> = vec![0.0; cols];
    let mut row_heights: Vec<f64> = vec![0.0; rows];
    
    // 计算每个子 payload 的尺寸（含嵌套 package 内容）
    let mut payloads: Vec<ChildPayload> = Vec::new();

    for (idx, node) in nodes.iter().enumerate() {
        let col = idx % cols;
        let row = idx / cols;

        let (base_w, base_h) = node_sizes[&node.id];
        let mut total_w = base_w;
        let mut total_h = base_h;

        let mut nested_layout: Option<HashMap<String, NodeGeom>> = None;

        if let Some(children_ids) = container_map.get(&node.id) {
            let children: Vec<&ComponentNode> = children_ids
                .iter()
                .filter_map(|id| all_nodes.iter().find(|n| &n.id == id))
                .copied()
                .collect();

            if !children.is_empty() {
                let mut child_layout = HashMap::new();
                let mut child_x = 0.0;
                let mut child_y = 0.0;
                layout_nodes_recursive(
                    ir,
                    &children,
                    all_nodes,
                    container_map,
                    node_sizes,
                    &mut child_layout,
                    &mut child_x,
                    &mut child_y,
                    false,
                )?;

                let child_bounds: Option<(f64, f64, f64, f64)> = child_layout.values().fold(
                    None,
                    |acc: Option<(f64, f64, f64, f64)>, geom| {
                        Some(match acc {
                            None => (geom.x, geom.y, geom.x + geom.w, geom.y + geom.h),
                            Some((min_x, min_y, max_x, max_y)) => (
                                min_x.min(geom.x),
                                min_y.min(geom.y),
                                max_x.max(geom.x + geom.w),
                                max_y.max(geom.y + geom.h),
                            ),
                        })
                    },
                );

                if let Some((min_x, min_y, max_x, max_y)) = child_bounds {
                    let content_width = max_x - min_x + CONTAINER_PADDING * 2.0;
                    let content_height =
                        max_y - min_y + CONTAINER_PADDING * 2.0 + CONTAINER_HEADER_HEIGHT;
                    total_w = total_w.max(content_width);
                    total_h = total_h.max(content_height);
                }
                nested_layout = Some(child_layout);
            }
        }

        payloads.push(ChildPayload {
            id: node.id.clone(),
            w: total_w,
            h: total_h,
            nested: nested_layout,
        });

        col_widths[col] = col_widths[col].max(total_w);
        row_heights[row] = row_heights[row].max(total_h);
    }

    let direct_layout: HashMap<String, NodeGeom> =
        try_layout_cluster_sugiyama(ir, &payloads).unwrap_or_else(|| {
            place_cluster_grid(
                &payloads,
                cols,
                rows,
                &col_widths,
                &row_heights,
                *x_offset,
                *y_offset,
            )
        });

    let x0 = *x_offset;
    let y0 = *y_offset;

    for p in &payloads {
        let g = direct_layout[&p.id];
        let geom = NodeGeom {
            x: g.x + x0,
            y: g.y + y0,
            w: g.w,
            h: g.h,
        };
        layout.insert(p.id.clone(), geom);
        if let Some(ref child_layout) = p.nested {
            for (child_id, child_geom) in child_layout {
                layout.insert(
                    child_id.clone(),
                    NodeGeom {
                        x: geom.x + CONTAINER_PADDING + child_geom.x,
                        y: geom.y + CONTAINER_PADDING + CONTAINER_HEADER_HEIGHT + child_geom.y,
                        w: child_geom.w,
                        h: child_geom.h,
                    },
                );
            }
        }
    }

    Ok(())
}

/// 计算节点尺寸。
fn calc_node_size(node: &ComponentNode) -> (f64, f64) {
    let label_len = node.label.len() as f64;
    let text_width = label_len * CHAR_WIDTH;

    let (min_w, min_h) = match node.shape {
        ComponentShape::Rectangle => (NODE_MIN_WIDTH, NODE_MIN_HEIGHT),
        ComponentShape::Ellipse => (NODE_MIN_WIDTH.max(text_width + 40.0), NODE_MIN_HEIGHT),
        ComponentShape::Cylinder => (NODE_MIN_WIDTH, NODE_MIN_HEIGHT + 20.0),
        ComponentShape::Diamond => (
            NODE_MIN_WIDTH.max(text_width + 60.0),
            NODE_MIN_HEIGHT + 20.0,
        ),
        ComponentShape::Folder => (NODE_MIN_WIDTH, NODE_MIN_HEIGHT + 15.0),
    };

    let w = min_w.max(text_width + 40.0);
    (w, min_h)
}

/// 计算从中心到外边界与某方向的交点。
fn intersect_node_boundary(
    geom: &NodeGeom,
    cx: f64,
    cy: f64,
    target_x: f64,
    target_y: f64,
) -> (f64, f64) {
    let dx = target_x - cx;
    let dy = target_y - cy;

    if dx == 0.0 && dy == 0.0 {
        return (cx + geom.w / 2.0, cy);
    }

    let half_w = geom.w / 2.0;
    let half_h = geom.h / 2.0;

    // 计算与矩形边界的交点
    let t_x = if dx != 0.0 {
        half_w / dx.abs()
    } else {
        f64::INFINITY
    };
    let t_y = if dy != 0.0 {
        half_h / dy.abs()
    } else {
        f64::INFINITY
    };

    let t = t_x.min(t_y);

    (cx + dx * t, cy + dy * t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plantuml_native::ir::{ComponentArrowStyle, ComponentDiagram, ComponentEdge, ComponentNode, ComponentShape};
    use crate::plantuml_native::parse::parse_component_diagram;

    #[test]
    fn empty_diagram_plan() {
        let ir = ComponentDiagram::default();
        let geom = plan_component(&ir).unwrap();
        assert_eq!(geom.nodes.len(), 0);
        assert_eq!(geom.edges.len(), 0);
    }

    #[test]
    fn single_node_plan() {
        let ir = ComponentDiagram {
            title: None,
            caption: None,
            skinparam_default_font_name: None,
            nodes: vec![ComponentNode {
                id: "A".to_string(),
                label: "A".to_string(),
                shape: ComponentShape::Rectangle,
                color: None,
                stereotype: None,
                parent_id: None,
            }],
            edges: vec![],
            notes: vec![],
        };
        let geom = plan_component(&ir).unwrap();
        assert_eq!(geom.nodes.len(), 1);
        assert!(geom.nodes.contains_key("A"));
    }

    #[test]
    fn two_nodes_with_edge_plan() {
        let ir = ComponentDiagram {
            title: None,
            caption: None,
            skinparam_default_font_name: None,
            nodes: vec![
                ComponentNode {
                    id: "A".to_string(),
                    label: "Component A".to_string(),
                    shape: ComponentShape::Rectangle,
                    color: None,
                    stereotype: None,
                    parent_id: None,
                },
                ComponentNode {
                    id: "B".to_string(),
                    label: "Component B".to_string(),
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
        let geom = plan_component(&ir).unwrap();
        assert_eq!(geom.nodes.len(), 2);
        assert_eq!(geom.edges.len(), 1);
        assert!(geom.edges[0].label_x.is_some());
    }

    #[test]
    fn top_level_two_packages_placed_horizontally() {
        let ir = ComponentDiagram {
            title: None,
            caption: None,
            skinparam_default_font_name: None,
            nodes: vec![
                ComponentNode {
                    id: "PkgA".into(),
                    label: "PkgA".into(),
                    shape: ComponentShape::Folder,
                    color: None,
                    stereotype: None,
                    parent_id: None,
                },
                ComponentNode {
                    id: "PkgB".into(),
                    label: "PkgB".into(),
                    shape: ComponentShape::Folder,
                    color: None,
                    stereotype: None,
                    parent_id: None,
                },
                ComponentNode {
                    id: "a1".into(),
                    label: "a1".into(),
                    shape: ComponentShape::Rectangle,
                    color: None,
                    stereotype: None,
                    parent_id: Some("PkgA".into()),
                },
                ComponentNode {
                    id: "b1".into(),
                    label: "b1".into(),
                    shape: ComponentShape::Rectangle,
                    color: None,
                    stereotype: None,
                    parent_id: Some("PkgB".into()),
                },
            ],
            edges: vec![],
            notes: vec![],
        };
        let g = plan_component(&ir).unwrap();
        assert!(g.nodes["PkgB"].x > g.nodes["PkgA"].x, "与 JAR 常见布局一致：并列顶层 package 左右排布");
    }

    /// 簇内存在 A-->B 时走 Sugiyama 路径（与无边时的网格区分）。
    #[test]
    fn package_inner_two_components_with_edge_plans() {
        let src = "@startuml\npackage P {\n[A]\n[B]\n}\nA --> B\n@enduml";
        let d = parse_component_diagram(src).expect("parse");
        let g = plan_component(&d).expect("plan");
        assert!(g.nodes.contains_key("P"));
        assert!(g.nodes.contains_key("A"));
        assert!(g.nodes.contains_key("B"));
    }
}
