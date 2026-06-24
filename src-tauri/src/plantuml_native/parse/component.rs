//! 组件图文本 → IR。

use crate::plantuml_native::ir::{
    ComponentArrowStyle, ComponentDiagram, ComponentEdge, ComponentNode, ComponentNote, ComponentShape, NotePosition,
};
use crate::plantuml_native::parse::color::{
    is_valid_color_payload, normalize_color_token, peel_trailing_stereotype_and_color,
    strip_suffix_color, take_leading_hash_color,
};
use crate::plantuml_native::NativeError;

fn parse_err(line: usize, detail: impl Into<String>) -> NativeError {
    NativeError::Parse {
        line,
        detail: detail.into(),
    }
}

fn logical_line(line: &str) -> Option<&str> {
    let t = line.trim();
    if t.is_empty() || t.starts_with('\'') {
        return None;
    }
    Some(t)
}

fn eq_startuml(s: &str) -> bool {
    s.eq_ignore_ascii_case("@startuml")
}

fn eq_enduml(s: &str) -> bool {
    s.eq_ignore_ascii_case("@enduml")
}

/// 行内容仅为关键字（大小写不敏感），无其它非空白字符。
fn is_keyword_only_line(line: &str, keyword: &str) -> bool {
    let line = line.trim();
    let kw_len = keyword.chars().count();
    let mut ch = line.chars();
    let head: String = ch.by_ref().take(kw_len).collect();
    if head.len() < kw_len || !head.eq_ignore_ascii_case(keyword) {
        return false;
    }
    ch.as_str().trim().is_empty()
}

fn is_end_title_line(t: &str) -> bool {
    let mut w = t.trim().split_whitespace();
    matches!(
        (w.next(), w.next(), w.next()),
        (Some(a), Some(b), None) if a.eq_ignore_ascii_case("end") && b.eq_ignore_ascii_case("title")
    )
}

fn is_end_caption_line(t: &str) -> bool {
    let mut w = t.trim().split_whitespace();
    matches!(
        (w.next(), w.next(), w.next()),
        (Some(a), Some(b), None) if a.eq_ignore_ascii_case("end") && b.eq_ignore_ascii_case("caption")
    )
}

/// 顶层 `title …` 单行；不与单独成行 `title`（多行块）混用 — 多行块由 `is_keyword_only_line` + `read_title_block` 处理。
fn try_parse_title_line(line: &str) -> Option<String> {
    let line = line.trim();
    let mut ch = line.chars();
    let head: String = ch.by_ref().take(5).collect();
    if head.len() < 5 || !head.eq_ignore_ascii_case("title") {
        return None;
    }
    let rest = ch.as_str();
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_whitespace()) {
        return None;
    }
    Some(rest.trim_start().to_string())
}

/// 顶层 `caption …` 单行。
fn try_parse_caption_line(line: &str) -> Option<String> {
    let line = line.trim();
    let mut ch = line.chars();
    let head: String = ch.by_ref().take(7).collect();
    if head.len() < 7 || !head.eq_ignore_ascii_case("caption") {
        return None;
    }
    let rest = ch.as_str();
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_whitespace()) {
        return None;
    }
    Some(rest.trim_start().to_string())
}

/// 消费从当前 `title` 行之后到 `end title`（不含）之间的行，合并为 `\n` 分隔正文。结束后 `idx` 指向 `end title` 的下一行。
fn read_title_block(
    lines: &[&str],
    idx: &mut usize,
    line_num: &mut usize,
) -> Result<String, NativeError> {
    if !is_keyword_only_line(lines[*idx].trim(), "title") {
        return Err(parse_err(*line_num, "内部错误：read_title_block 须以单独 `title` 行开头"));
    }
    *idx += 1;
    let mut parts: Vec<String> = Vec::new();
    while *idx < lines.len() {
        let raw = lines[*idx];
        *line_num += 1;
        let t = raw.trim();
        if eq_enduml(t) {
            return Err(parse_err(
                *line_num,
                "多行 title 未闭合：须先 `end title` 再 `@enduml`",
            ));
        }
        *idx += 1;
        if is_end_title_line(t) {
            return Ok(parts.join("\n"));
        }
        if let Some(ll) = logical_line(raw) {
            parts.push(ll.to_string());
        }
    }
    Err(parse_err(
        *line_num,
        "多行 title 未闭合：缺少 `end title`",
    ))
}

/// 消费 `caption` 单独成行开启的多行块，至 `end caption`。
fn read_caption_block(
    lines: &[&str],
    idx: &mut usize,
    line_num: &mut usize,
) -> Result<String, NativeError> {
    if !is_keyword_only_line(lines[*idx].trim(), "caption") {
        return Err(parse_err(*line_num, "内部错误：read_caption_block 须以单独 `caption` 行开头"));
    }
    *idx += 1;
    let mut parts: Vec<String> = Vec::new();
    while *idx < lines.len() {
        let raw = lines[*idx];
        *line_num += 1;
        let t = raw.trim();
        if eq_enduml(t) {
            return Err(parse_err(
                *line_num,
                "多行 caption 未闭合：须先 `end caption` 再 `@enduml`",
            ));
        }
        *idx += 1;
        if is_end_caption_line(t) {
            return Ok(parts.join("\n"));
        }
        if let Some(ll) = logical_line(raw) {
            parts.push(ll.to_string());
        }
    }
    Err(parse_err(
        *line_num,
        "多行 caption 未闭合：缺少 `end caption`",
    ))
}

/// `rectangle` / `boundary` 等：明确拒绝并返回 Unsupported（与 R10「用户可知不支持」一致）。
fn reject_unsupported_component_line(line: &str) -> Result<(), NativeError> {
    let lower = line.trim().to_lowercase();
    const PREFIXES: &[&str] = &["rectangle ", "boundary ", "artifact ", "queue "];
    for p in PREFIXES {
        if lower.starts_with(p) {
            return Err(NativeError::Unsupported {
                detail: format!("组件图暂不支持的语法: {}", line.trim()),
            });
        }
    }
    Ok(())
}

/// 行尾 `<<stereotype>>`（PlantUML 构造型），必须紧邻、无额外尾部。
fn parse_trailing_stereotype(s: &str) -> Option<String> {
    let s = s.trim_start();
    if !s.starts_with("<<") {
        return None;
    }
    let tail = &s[2..];
    let end = tail.find(">>")?;
    let inner = tail[..end].trim();
    if inner.is_empty() {
        return None;
    }
    let after = tail[end + 2..].trim();
    if !after.is_empty() {
        return None;
    }
    Some(inner.to_string())
}

/// `]` 之后 remainder：剥离 `<<st>>` / `#color`；若仍有残留则尝试旧版「整段仅为构造型」。
fn split_bracket_remainder(remainder: &str) -> Option<(Option<String>, Option<String>)> {
    let (st, col, work) = peel_trailing_stereotype_and_color(remainder);
    if work.trim().is_empty() {
        return Some((st, col));
    }
    if let Some(legacy) = parse_trailing_stereotype(remainder.trim()) {
        return Some((Some(legacy), None));
    }
    None
}

/// 组件图箭头：`-[#color]->`、`-[hidden]-`、以及 `-->` / `->` / `..` 等（长匹配优先）。
fn match_arrow_tail(s: &str) -> Option<(ComponentArrowStyle, usize)> {
    let s = s.trim_start();
    if s.starts_with("-->") {
        return Some((ComponentArrowStyle::Solid, 3));
    }
    if s.starts_with("..>") {
        return Some((ComponentArrowStyle::Dashed, 3));
    }
    if s.starts_with("->") {
        return Some((ComponentArrowStyle::Solid, 2));
    }
    if s.starts_with("..") {
        return Some((ComponentArrowStyle::Dashed, 2));
    }
    if s.starts_with("--") {
        return Some((ComponentArrowStyle::Solid, 2));
    }
    if s.starts_with('-') {
        let next = s.as_bytes().get(1).copied();
        if matches!(next, None | Some(b' ') | Some(b'[') | Some(b'(')) {
            return Some((ComponentArrowStyle::Solid, 1));
        }
    }
    None
}

/// 匹配从首节点结束到次节点开始之间的箭头子串；返回 (总消费字节数, 样式, 行内颜色, hidden)。
/// v1 子集：行内着色为 `-[#name]` / `-[#RRGGBB]`；`-[hidden]` / `-[norank]` 映射为 hidden。
fn match_component_arrow_prefix(rest: &str) -> Option<(usize, ComponentArrowStyle, Option<String>, bool)> {
    let rest = rest.trim_start();
    let mut line_color = None;
    let mut hidden = false;
    let consumed_prefix = if rest.starts_with("-[") {
        let close = rest[2..].find(']')? + 2;
        let inner = rest[2..close].trim();
        if let Some(stripped) = inner.strip_prefix('#') {
            if is_valid_color_payload(stripped) {
                line_color = Some(normalize_color_token(stripped));
            }
        } else if inner.eq_ignore_ascii_case("hidden") || inner.eq_ignore_ascii_case("norank") {
            hidden = true;
        }
        close + 1
    } else {
        0
    };
    let after_prefix = &rest[consumed_prefix..];
    let leading_ws = after_prefix.len() - after_prefix.trim_start().len();
    let tail = after_prefix.trim_start();
    let (style, tlen) = match_arrow_tail(tail)?;
    let total = consumed_prefix + leading_ws + tlen;
    Some((total, style, line_color, hidden))
}

/// `]` / `)` 之后：解析可选 `as Id`，返回 (id, label, remainder)。
fn resolve_id_label_and_remainder_after_close<'a>(
    inner: &str,
    after_close: &'a str,
) -> (String, String, &'a str) {
    let after_close = after_close.trim_start();
    if after_close.len() >= 3 && after_close[..3].eq_ignore_ascii_case("as ") {
        let rest = after_close[3..].trim_start();
        if let Some(id_token) = rest.split_whitespace().next() {
            let id = id_token.to_string();
            let consumed = id_token.len();
            let after_id = rest[consumed..].trim_start();
            return (id, inner.to_string(), after_id);
        }
    }
    (
        inner.to_string(),
        inner.to_string(),
        after_close,
    )
}

/// 解析组件图。
pub fn parse_component_diagram(source: &str) -> Result<ComponentDiagram, NativeError> {
    let mut w = Vec::new();
    parse_component_diagram_with_warnings(source, &mut w)
}

/// 解析组件图并收集「未识别行」等告警（与 `try_render_rust_with_report` 共用）。
pub fn parse_component_diagram_with_warnings(
    source: &str,
    warnings: &mut Vec<String>,
) -> Result<ComponentDiagram, NativeError> {
    let mut lines = source.lines();

    // 跳过 @startuml 前缀
    let mut found_start = false;
    while let Some(raw) = lines.next() {
        let t = raw.trim();
        if t.is_empty() {
            continue;
        }
        if eq_startuml(t) {
            found_start = true;
            break;
        }
        return Err(parse_err(1, "组件图须以 @startuml 开头"));
    }
    if !found_start {
        return Err(parse_err(1, "组件图须以 @startuml 开头"));
    }

    let mut diagram = ComponentDiagram::default();
    let mut line_num = 1;

    // 收集所有行用于解析
    let body_lines: Vec<&str> = lines.collect();
    let mut idx = 0;

    // 递归解析所有行（支持嵌套 package）
    parse_component_lines(
        &body_lines,
        &mut idx,
        &mut diagram,
        None,
        &mut line_num,
        warnings,
    )?;

    Ok(diagram)
}

/// `skinparam defaultFontName Courier` 等白名单（仅记录到 IR，不放宽 limits）。
fn try_parse_skinparam_component_whitelist(line: &str) -> Option<String> {
    let t = line.trim();
    let lower = t.to_lowercase();
    if !lower.starts_with("skinparam ") {
        return None;
    }
    let rest = t["skinparam ".len()..].trim_start();
    let mut it = rest.split_whitespace();
    let key = it.next()?.to_lowercase();
    if key != "defaultfontname" {
        return None;
    }
    let value = it.collect::<Vec<_>>().join(" ").trim().to_string();
    if value.is_empty() {
        return None;
    }
    Some(value)
}

/// 递归解析组件图行（支持嵌套 package）。
fn parse_component_lines(
    lines: &[&str],
    idx: &mut usize,
    diagram: &mut ComponentDiagram,
    parent_id: Option<String>,
    line_num: &mut usize,
    warnings: &mut Vec<String>,
) -> Result<(), NativeError> {
    while *idx < lines.len() {
        let raw = lines[*idx];
        *line_num += 1;
        let t = raw.trim();

        if t.is_empty() {
            *idx += 1;
            continue;
        }
        if eq_enduml(t) {
            *idx += 1;
            break;
        }
        if eq_startuml(t) {
            *idx += 1;
            continue;
        }
        
        // skinparam：白名单键写入 IR，其余仍跳过（与旧行为一致）
        if t.starts_with("skinparam") {
            if parent_id.is_none() {
                if let Some(font) = try_parse_skinparam_component_whitelist(t) {
                    diagram.skinparam_default_font_name = Some(font);
                }
            }
            *idx += 1;
            continue;
        }

        // 顶层 title / caption（仅 package 外；须在 logical_line 之前用 `t` 与 logical 内容区分注释）
        if parent_id.is_none() {
            if let Some(ll) = logical_line(t) {
                if is_keyword_only_line(ll, "title") {
                    diagram.title = Some(read_title_block(lines, idx, line_num)?);
                    continue;
                }
                if is_keyword_only_line(ll, "caption") {
                    diagram.caption = Some(read_caption_block(lines, idx, line_num)?);
                    continue;
                }
            }
            if let Some(tt) = try_parse_title_line(t) {
                if !tt.is_empty() {
                    diagram.title = Some(tt);
                }
                *idx += 1;
                continue;
            }
            if let Some(cc) = try_parse_caption_line(t) {
                if !cc.is_empty() {
                    diagram.caption = Some(cc);
                }
                *idx += 1;
                continue;
            }
        }

        // 处理块结束
        if t == "}" {
            *idx += 1;
            return Ok(()); // 返回上层调用
        }

        let line = logical_line(t);
        if let Some(line) = line {
            // 检查是否是 package "Name" { 开始
            if let Some((pkg_name, pkg_id)) = try_parse_package_start(line) {
                // 添加 package 节点
                if !diagram.nodes.iter().any(|n| n.id == pkg_id) {
                    diagram.nodes.push(ComponentNode {
                        id: pkg_id.clone(),
                        label: pkg_name,
                        shape: ComponentShape::Folder,
                        color: None,
                        stereotype: None,
                        parent_id: parent_id.clone(),
                    });
                }
                *idx += 1;
                // 递归解析 package 内容
                parse_component_lines(lines, idx, diagram, Some(pkg_id), line_num, warnings)?;
                continue;
            }

            // 检查是否是 [Component] { 开始
            if let Some(comp_name) = try_parse_component_block_start(line) {
                // 添加组件节点
                if !diagram.nodes.iter().any(|n| n.id == comp_name) {
                    diagram.nodes.push(ComponentNode {
                        id: comp_name.clone(),
                        label: comp_name.clone(),
                        shape: ComponentShape::Rectangle,
                        color: None,
                        stereotype: None,
                        parent_id: parent_id.clone(),
                    });
                }
                *idx += 1;
                // 递归解析块内容
                parse_component_lines(lines, idx, diagram, Some(comp_name), line_num, warnings)?;
                continue;
            }

            // 检查是否是 note 注释
            if line.starts_with("note ") {
                if let Some(note) = try_parse_note_start(lines, idx, line, diagram, line_num)? {
                    diagram.notes.push(note);
                    continue;
                }
            }
            
            parse_component_line(line, diagram, *line_num, &parent_id, warnings)?;
        }
        
        *idx += 1;
    }
    
    Ok(())
}

/// 解析 `[ComponentName] {` 块开始
fn try_parse_component_block_start(line: &str) -> Option<String> {
    let line = line.trim();
    if !line.starts_with('[') {
        return None;
    }
    // 找到 ]
    let close_pos = line.find(']')?;
    let inner = line[1..close_pos].trim();
    if inner.is_empty() {
        return None;
    }
    // 检查后面是否有 {
    let after = line[close_pos + 1..].trim();
    if after == "{" || after.starts_with('{') {
        return Some(inner.to_string());
    }
    None
}

/// 解析 `package "Name" {` 或 `package Name {` 开始，返回 (名称, ID)
fn try_parse_package_start(line: &str) -> Option<(String, String)> {
    if !line.starts_with("package ") {
        return None;
    }
    let rest = line["package ".len()..].trim();
    
    // 尝试 `package "Name" {`
    if rest.starts_with('"') {
        if let Some(name) = extract_package_name(rest) {
            // 检查名称后面是否有 {
            let name_with_quotes = format!("\"{}\"", name);
            let after_name_pos = rest.find(&name_with_quotes)? + name_with_quotes.len();
            let after = rest[after_name_pos..].trim();
            if after.starts_with('{') {
                let id = sanitize_id(&name);
                return Some((name, id));
            }
        }
    } else {
        // 尝试 `package Name {`
        let parts: Vec<&str> = rest.split_whitespace().collect();
        if !parts.is_empty() {
            let name = parts[0].to_string();
            // 检查名称后面是否有 {
            let after_name_pos = rest.find(&name)? + name.len();
            let after = rest[after_name_pos..].trim();
            if after.starts_with('{') {
                let id = sanitize_id(&name);
                return Some((name, id));
            }
        }
    }
    
    None
}

/// 提取 package 名称（支持引号）
fn extract_package_name(s: &str) -> Option<String> {
    if s.starts_with('"') {
        let end_quote = s[1..].find('"')?;
        Some(s[1..1 + end_quote].to_string())
    } else {
        s.split_whitespace().next().map(|s| s.to_string())
    }
}

/// 清理 ID（去除特殊字符，保留字母数字和连字符）
fn sanitize_id(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// 尝试解析 note 注释（支持多行：note left/right/over ... end note）
fn try_parse_note_start(
    lines: &[&str],
    idx: &mut usize,
    first_line: &str,
    _diagram: &ComponentDiagram,
    line_num: &mut usize,
) -> Result<Option<ComponentNote>, NativeError> {
    // 检查是否是 note 开始
    let mut found_pos = None;
    let mut target = String::new();
    let mut target_id_secondary: Option<String> = None;

    if first_line.starts_with("note left of") {
        let after = first_line["note left of".len()..].trim();
        let target_parts: Vec<&str> = after.split_whitespace().collect();
        if target_parts.is_empty() {
            return Ok(None);
        }
        target = target_parts[0].trim_end_matches(',').to_string();
        found_pos = Some("note left of");
    } else if first_line.starts_with("note right of") {
        let after = first_line["note right of".len()..].trim();
        let target_parts: Vec<&str> = after.split_whitespace().collect();
        if target_parts.is_empty() {
            return Ok(None);
        }
        target = target_parts[0].trim_end_matches(',').to_string();
        found_pos = Some("note right of");
    } else if first_line.starts_with("note over") {
        let after = first_line["note over".len()..].trim();
        let segments: Vec<&str> = after
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if segments.is_empty() {
            return Ok(None);
        }
        target = segments[0].to_string();
        target_id_secondary = if segments.len() > 1 {
            Some(segments[1].to_string())
        } else {
            None
        };
        found_pos = Some("note over");
    }
    
    let pos_str = found_pos.ok_or_else(|| parse_err(*line_num, "note 位置无效"))?;
    let position = if pos_str.contains("left") {
        NotePosition::Left
    } else if pos_str.contains("right") {
        NotePosition::Right
    } else {
        NotePosition::Over
    };
    
    // 收集注释文本（直到 end note）
    let mut note_lines = Vec::new();
    *line_num += 1; // 跳过 note 开始行
    *idx += 1; // 跳过 note 开始行
    
    while *idx < lines.len() {
        let line = lines[*idx].trim();
        *line_num += 1;
        
        if line.to_lowercase() == "end note" {
            *idx += 1;
            break;
        }
        
        if !line.is_empty() {
            note_lines.push(line.to_string());
        }
        
        *idx += 1;
    }
    
    if note_lines.is_empty() {
        return Ok(None);
    }
    
    let text = note_lines.join("\n");
    
    Ok(Some(ComponentNote {
        target_id: target,
        target_id_secondary,
        position,
        text,
    }))
}

fn parse_component_line(
    line: &str,
    diagram: &mut ComponentDiagram,
    line_num: usize,
    parent_id: &Option<String>,
    warnings: &mut Vec<String>,
) -> Result<(), NativeError> {
    // 优先尝试匹配边（含箭头）
    if let Some(edge) = try_parse_edge(line) {
        ensure_node(&mut diagram.nodes, &edge.from, ComponentShape::Rectangle, parent_id.clone());
        ensure_node(&mut diagram.nodes, &edge.to, ComponentShape::Rectangle, parent_id.clone());
        diagram.edges.push(edge);
        return Ok(());
    }

    // [ComponentName] 独立节点（不含 {）
    if let Some(node) = try_parse_standalone_bracket_node(line) {
        let mut node = node;
        node.parent_id = parent_id.clone();
        // 如果在块内，添加当前组件作为源
        if let Some(current) = parent_id {
            diagram.edges.push(ComponentEdge {
                from: current.clone(),
                to: node.id.clone(),
                label: None,
                arrow: ComponentArrowStyle::Solid,
                color: None,
                hidden: false,
            });
        }
        diagram.nodes.push(node);
        return Ok(());
    }

    // (InterfaceName) 独立接口节点
    if let Some(node) = try_parse_standalone_paren_node(line) {
        let mut node = node;
        node.parent_id = parent_id.clone();
        // 如果在块内，添加当前组件作为源
        if let Some(current) = parent_id {
            diagram.edges.push(ComponentEdge {
                from: current.clone(),
                to: node.id.clone(),
                label: None,
                arrow: ComponentArrowStyle::Solid,
                color: None,
                hidden: false,
            });
        }
        diagram.nodes.push(node);
        return Ok(());
    }

    // component Keyword 声明
    if let Some(node) = try_parse_component_keyword(line) {
        let mut node = node;
        node.parent_id = parent_id.clone();
        diagram.nodes.push(node);
        return Ok(());
    }

    // database / cloud / folder / package / node 关键字
    if let Some(node) = try_parse_container_keyword(line) {
        let mut node = node;
        node.parent_id = parent_id.clone();
        // 如果在块内，添加当前组件作为源
        if let Some(current) = parent_id {
            diagram.edges.push(ComponentEdge {
                from: current.clone(),
                to: node.id.clone(),
                label: None,
                arrow: ComponentArrowStyle::Solid,
                color: None,
                hidden: false,
            });
        }
        diagram.nodes.push(node);
        return Ok(());
    }

    reject_unsupported_component_line(line)?;
    warnings.push(format!(
        "[NoteZ][plantuml][component] 第 {} 行未识别语法（已跳过）: {}",
        line_num,
        line.trim()
    ));
    Ok(())
}

fn ensure_node(nodes: &mut Vec<ComponentNode>, id: &str, default_shape: ComponentShape, parent_id: Option<String>) {
    if !nodes.iter().any(|n| n.id == id) {
        nodes.push(ComponentNode {
            id: id.to_string(),
            label: id.to_string(),
            shape: default_shape,
            color: None,
            stereotype: None,
            parent_id,
        });
    }
}

/// 尝试解析边行：`[A] --> [B]`、`(A) -> [B]`，或裸标识符 `A --> B`。
fn try_parse_edge(line: &str) -> Option<ComponentEdge> {
    try_parse_bracket_or_paren_edge(line).or_else(|| try_parse_bare_identifier_edge(line))
}

/// `[A] --> [B]` 或 `(A) -> [B]` 等。
fn try_parse_bracket_or_paren_edge(line: &str) -> Option<ComponentEdge> {
    let line = line.trim();
    if !line.starts_with('[') && !line.starts_with('(') {
        return None;
    }

    // 找到第一个节点的结束位置
    let close_char = if line.starts_with('[') { ']' } else { ')' };
    let close_pos = line.find(close_char)?;
    let from = line[1..close_pos].trim().to_string();
    if from.is_empty() {
        return None;
    }

    // 跳过 `] ` 或 `) `
    let rest = line[close_pos + 1..].trim_start();

    let (arrow_len, arrow_style, line_color, hidden) = match_component_arrow_prefix(rest)?;

    let after_arrow = &rest[arrow_len..].trim_start();

    // 第二个节点必须以 [ 或 ( 开头
    if !after_arrow.starts_with('[') && !after_arrow.starts_with('(') {
        return None;
    }

    let close2 = if after_arrow.starts_with('[') { ']' } else { ')' };
    let close2_pos = after_arrow.find(close2)?;
    let to = after_arrow[1..close2_pos].trim().to_string();
    if to.is_empty() {
        return None;
    }

    // 可选标签（`:` 后正文，行尾可跟 `#color`）与无标签时的行首 `#color`
    let after_to = after_arrow[close2_pos + 1..].trim_start();
    let mut edge_color = line_color;

    let label = if after_to.starts_with(':') {
        let rest = after_to[1..].trim_start();
        let (tr_col, text_part) = strip_suffix_color(rest);
        if let Some(c) = tr_col {
            edge_color = edge_color.or(Some(c));
        }
        Some(text_part.trim().to_string())
    } else {
        None
    };

    let tail = if after_to.starts_with(':') {
        ""
    } else {
        after_to
    };

    if !tail.trim().is_empty() {
        if edge_color.is_some() {
            return None;
        }
        if let Some((c, r)) = take_leading_hash_color(tail) {
            edge_color = Some(c);
            if !r.trim().is_empty() {
                return None;
            }
        } else {
            return None;
        }
    }

    Some(ComponentEdge {
        from,
        to,
        label,
        arrow: arrow_style,
        color: edge_color,
        hidden,
    })
}

/// 解析 `FromId --> ToId`（两端为 ASCII 标识符），可选 `: label`。
fn try_parse_bare_identifier_edge(line: &str) -> Option<ComponentEdge> {
    let line = line.trim();
    if line.starts_with('[') || line.starts_with('(') {
        return None;
    }
    if line.starts_with('@') || is_bare_edge_keyword_prefix(line) {
        return None;
    }

    let (from, rest) = take_ascii_identifier(line)?;
    let rest = rest.trim_start();
    let (arrow_len, arrow_style, line_color, hidden) = match_component_arrow_prefix(rest)?;
    let after_arrow = rest[arrow_len..].trim_start();
    let (to, rest_after_to) = take_ascii_identifier(after_arrow)?;

    let tail = rest_after_to.trim_start();
    let mut edge_color = line_color;

    let label = if tail.starts_with(':') {
        let rest = tail[1..].trim_start();
        let (tr_col, text_part) = strip_suffix_color(rest);
        if let Some(c) = tr_col {
            edge_color = edge_color.or(Some(c));
        }
        Some(text_part.trim().to_string())
    } else {
        None
    };

    let tail_check = if label.is_some() { "" } else { tail };
    if !tail_check.trim().is_empty() {
        if edge_color.is_some() {
            return None;
        }
        if let Some((c, r)) = take_leading_hash_color(tail_check) {
            edge_color = Some(c);
            if !r.trim().is_empty() {
                return None;
            }
        } else {
            return None;
        }
    }

    Some(ComponentEdge {
        from: from.to_string(),
        to: to.to_string(),
        label,
        arrow: arrow_style,
        color: edge_color,
        hidden,
    })
}

fn is_bare_edge_keyword_prefix(line: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "component ",
        "package ",
        "note ",
        "skinparam",
        "database ",
        "cloud ",
        "folder ",
        "node ",
    ];
    let lower = line.to_lowercase();
    PREFIXES.iter().any(|p| lower.starts_with(p))
}

/// 取一段 `[A-Za-z0-9_]+`，返回 (标识符, 剩余)。
fn take_ascii_identifier(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    Some((&s[..i], &s[i..]))
}

/// `[ComponentName]`、`[Label] as Id`，或 `[ComponentName] {`（块开始由 `try_parse_component_block_start` 处理）。
fn try_parse_standalone_bracket_node(line: &str) -> Option<ComponentNode> {
    let line = line.trim();
    if !line.starts_with('[') {
        return None;
    }
    // 找到 ]
    let close_pos = line.find(']')?;
    let inner = line[1..close_pos].trim();
    if inner.is_empty() {
        return None;
    }
    let after = line[close_pos + 1..].trim_start();
    let (id, label, remainder) = resolve_id_label_and_remainder_after_close(inner, after);
    let (stereotype, color) = split_bracket_remainder(remainder)?;
    Some(ComponentNode {
        id,
        label,
        shape: ComponentShape::Rectangle,
        color,
        stereotype,
        parent_id: None,
    })
}

/// `(InterfaceName)`、`(Label) as Id`，或 `(InterfaceName) {`（块开始由上层处理）。
fn try_parse_standalone_paren_node(line: &str) -> Option<ComponentNode> {
    let line = line.trim();
    if !line.starts_with('(') {
        return None;
    }
    // 找到 )
    let close_pos = line.find(')')?;
    let inner = line[1..close_pos].trim();
    if inner.is_empty() {
        return None;
    }
    let after = line[close_pos + 1..].trim_start();
    let (id, label, remainder) = resolve_id_label_and_remainder_after_close(inner, after);
    let (stereotype, color) = split_bracket_remainder(remainder)?;
    Some(ComponentNode {
        id,
        label,
        shape: ComponentShape::Ellipse,
        color,
        stereotype,
        parent_id: None,
    })
}

/// `component Name` 或 `component "Display Name" as Alias`
fn try_parse_component_keyword(line: &str) -> Option<ComponentNode> {
    if !line.starts_with("component ") {
        return None;
    }
    let rest = line["component ".len()..].trim();
    if rest.is_empty() {
        return None;
    }

    if let Some((label, id, rem)) = try_parse_quoted_with_as_remainder(rest) {
        let (st, col, work) = peel_trailing_stereotype_and_color(rem.as_str());
        if !work.trim().is_empty() {
            return None;
        }
        return Some(ComponentNode {
            id,
            label,
            shape: ComponentShape::Rectangle,
            color: col,
            stereotype: st,
            parent_id: None,
        });
    }

    let parts: Vec<&str> = rest.split_whitespace().collect();
    if parts.len() >= 3 && parts[1].eq_ignore_ascii_case("as") {
        let name = parts[0].to_string();
        let alias = parts[2].to_string();
        let lower = rest.to_lowercase();
        let as_pos = lower.find(" as ")?;
        let after_as_kw = rest[as_pos + 4..].trim_start();
        let id_token = after_as_kw.split_whitespace().next()?;
        if id_token != alias {
            return None;
        }
        let after_id = after_as_kw[id_token.len()..].trim_start();
        let (st, col, work) = peel_trailing_stereotype_and_color(after_id);
        if !work.trim().is_empty() {
            return None;
        }
        return Some(ComponentNode {
            id: alias,
            label: name,
            shape: ComponentShape::Rectangle,
            color: col,
            stereotype: st,
            parent_id: None,
        });
    }

    let first = rest.split_whitespace().next()?.to_string();
    let tail = rest[first.len()..].trim_start();
    let (st, col, work) = peel_trailing_stereotype_and_color(tail);
    if !work.trim().is_empty() {
        return None;
    }
    Some(ComponentNode {
        id: first.clone(),
        label: first,
        shape: ComponentShape::Rectangle,
        color: col,
        stereotype: st,
        parent_id: None,
    })
}

/// `component "Display" as Id` 行：返回 (display, id, `as Id` 之后的行尾)。
fn try_parse_quoted_with_as_remainder(s: &str) -> Option<(String, String, String)> {
    if !s.starts_with('"') {
        return None;
    }
    let end_quote = s[1..].find('"')?;
    let name = s[1..1 + end_quote].to_string();
    let after_line = s[1 + end_quote + 1..].trim_start();
    let parts: Vec<&str> = after_line.split_whitespace().collect();
    if parts.len() < 2 || !parts[0].eq_ignore_ascii_case("as") {
        return None;
    }
    let id = parts[1].to_string();
    let rem = if parts.len() > 2 {
        parts[2..].join(" ")
    } else {
        String::new()
    };
    Some((name, id, rem))
}

/// 容器行首段：引号内名称或首个空白分隔 token，返回 (名称, 其后 remainder)。
fn split_container_name_head(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start();
    if s.is_empty() {
        return None;
    }
    if s.starts_with('"') {
        let end = s[1..].find('"')?;
        let inner = &s[1..1 + end];
        let tail = s[1 + end + 1..].trim_start();
        return Some((inner, tail));
    }
    let tok = s.split_whitespace().next()?;
    Some((tok, s[tok.len()..].trim_start()))
}

/// `database Name` / `cloud Name` / `folder Name` / `package Name` / `node Name`
fn try_parse_container_keyword(line: &str) -> Option<ComponentNode> {
    let keywords = ["database", "cloud", "folder", "package", "node"];
    for &kw in &keywords {
        let prefix = format!("{kw} ");
        if line.starts_with(&prefix) {
            let raw = line[prefix.len()..].trim();
            if raw.is_empty() {
                return None;
            }
            let (name, tail) = split_container_name_head(raw)?;
            if name.is_empty() {
                return None;
            }
            let (st, col, work) = peel_trailing_stereotype_and_color(tail);
            if !work.trim().is_empty() {
                return None;
            }
            let name = name.to_string();

            let shape = match kw {
                "database" => ComponentShape::Cylinder,
                "cloud" => ComponentShape::Diamond,
                "folder" | "package" => ComponentShape::Folder,
                _ => ComponentShape::Rectangle,
            };

            return Some(ComponentNode {
                id: name.clone(),
                label: name,
                shape,
                color: col,
                stereotype: st,
                parent_id: None,
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_diagram_parses() {
        let src = "@startuml\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert!(d.nodes.is_empty());
        assert!(d.edges.is_empty());
    }

    #[test]
    fn simple_component_edge() {
        let src = "@startuml\n[WebServer] --> [Database]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 2);
        assert_eq!(d.edges.len(), 1);
        assert_eq!(d.edges[0].from, "WebServer");
        assert_eq!(d.edges[0].to, "Database");
        assert_eq!(d.edges[0].arrow, ComponentArrowStyle::Solid);
    }

    #[test]
    fn edge_with_label() {
        let src = "@startuml\n[A] --> [B] : calls\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges.len(), 1);
        assert_eq!(d.edges[0].label, Some("calls".to_string()));
    }

    #[test]
    fn dashed_edge() {
        let src = "@startuml\n[A] ..> [B]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges[0].arrow, ComponentArrowStyle::Dashed);
    }

    #[test]
    fn dashed_edge_plain() {
        let src = "@startuml\n[A] -- [B]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges[0].arrow, ComponentArrowStyle::Solid);
    }

    #[test]
    fn interface_paren_node() {
        let src = "@startuml\n(Interface)\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
        assert_eq!(d.nodes[0].shape, ComponentShape::Ellipse);
        assert_eq!(d.nodes[0].label, "Interface");
    }

    #[test]
    fn component_keyword() {
        let src = "@startuml\ncomponent MyComponent\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
        assert_eq!(d.nodes[0].id, "MyComponent");
        assert_eq!(d.nodes[0].shape, ComponentShape::Rectangle);
    }

    #[test]
    fn component_keyword_with_as() {
        let src = "@startuml\ncomponent \"My Display\" as MC\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
        assert_eq!(d.nodes[0].id, "MC");
        assert_eq!(d.nodes[0].label, "My Display");
    }

    #[test]
    fn component_keyword_simple_as() {
        let src = "@startuml\ncomponent WebApp as WA\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].id, "WA");
        assert_eq!(d.nodes[0].label, "WebApp");
    }

    #[test]
    fn database_keyword() {
        let src = "@startuml\ndatabase MyDB\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
        assert_eq!(d.nodes[0].shape, ComponentShape::Cylinder);
        assert_eq!(d.nodes[0].label, "MyDB");
    }

    #[test]
    fn cloud_keyword() {
        let src = "@startuml\ncloud MyCloud\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].shape, ComponentShape::Diamond);
    }

    #[test]
    fn folder_keyword() {
        let src = "@startuml\nfolder MyFolder\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].shape, ComponentShape::Folder);
    }

    #[test]
    fn mixed_nodes_and_edges() {
        let src = "@startuml\n[Web]\n[Web] --> [Database]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 2);
        assert_eq!(d.edges.len(), 1);
        assert_eq!(d.nodes[0].shape, ComponentShape::Rectangle);
    }

    #[test]
    fn multiple_edges() {
        let src = "@startuml\n[A] --> [B]\n[B] --> [C]\n[C] ..> [A]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 3);
        assert_eq!(d.edges.len(), 3);
    }

    #[test]
    fn without_startuml_fails() {
        let e = parse_component_diagram("[A] --> [B]").unwrap_err();
        assert!(matches!(e, NativeError::Parse { .. }));
    }

    #[test]
    fn comments_are_skipped() {
        let src = "@startuml\n' this is a comment\n[A]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
    }

    #[test]
    fn interface_to_component_edge() {
        let src = "@startuml\n(API) --> [Server]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges.len(), 1);
        assert_eq!(d.edges[0].from, "API");
        assert_eq!(d.edges[0].to, "Server");
    }

    #[test]
    fn package_keyword() {
        let src = "@startuml\npackage MyPackage\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].shape, ComponentShape::Folder);
    }

    #[test]
    fn node_keyword() {
        let src = "@startuml\nnode MyNode\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].shape, ComponentShape::Rectangle);
    }

    #[test]
    fn edge_with_paren_to_bracket() {
        let src = "@startuml\n(Service) --> [Database]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges.len(), 1);
        assert_eq!(d.edges[0].from, "Service");
        assert_eq!(d.edges[0].to, "Database");
    }

    #[test]
    fn edge_with_dashed_plain() {
        let src = "@startuml\n[A] .. [B]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges[0].arrow, ComponentArrowStyle::Dashed);
    }

    #[test]
    fn component_block_with_brace_parses() {
        let src = "@startuml\n[日历应用] {\n[数据层]\n[业务层]\n}\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 3);
        assert!(d.nodes.iter().any(|n| n.id == "日历应用"));
        assert!(d.nodes.iter().any(|n| n.id == "数据层"));
        assert!(d.nodes.iter().any(|n| n.id == "业务层"));
        // 块内组件应连接到块父组件
        assert_eq!(d.edges.len(), 2);
        assert!(d.edges.iter().any(|e| e.from == "日历应用" && e.to == "数据层"));
        assert!(d.edges.iter().any(|e| e.from == "日历应用" && e.to == "业务层"));
    }

    #[test]
    fn component_block_label_no_brace() {
        // 确保 [Name] { 不会把 { 包含进标签
        let src = "@startuml\n[日历应用] {\n}\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
        assert_eq!(d.nodes[0].label, "日历应用");
        assert_eq!(d.nodes[0].id, "日历应用");
    }

    #[test]
    fn edge_outside_block_renders() {
        let src = "@startuml\n[A] {\n[B]\n}\n[C]\n[A] --> [C]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 3);
        // A->B (块内), A->C (显式边)
        assert_eq!(d.edges.len(), 2);
        assert!(d.edges.iter().any(|e| e.from == "A" && e.to == "C"));
    }

    #[test]
    fn bracket_node_parses_display_and_alias() {
        let src = "@startuml\n[日历-日程管理模块] as DataLayer\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
        assert_eq!(d.nodes[0].id, "DataLayer");
        assert_eq!(d.nodes[0].label, "日历-日程管理模块");
    }

    #[test]
    fn paren_node_parses_display_and_alias() {
        let src = "@startuml\n(Foo API) as ApiId\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes.len(), 1);
        assert_eq!(d.nodes[0].id, "ApiId");
        assert_eq!(d.nodes[0].label, "Foo API");
        assert_eq!(d.nodes[0].shape, ComponentShape::Ellipse);
    }

    #[test]
    fn bare_identifier_edge_parses() {
        let src = "@startuml\nCloudService --> SyncLayer : JSON\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges.len(), 1);
        assert_eq!(d.edges[0].from, "CloudService");
        assert_eq!(d.edges[0].to, "SyncLayer");
        assert_eq!(d.edges[0].label, Some("JSON".to_string()));
    }

    #[test]
    fn cross_package_edge_uses_alias_ids() {
        let src = r#"@startuml
package "Outer" {
  [A] as NodeA
}
package "Other" {
  [B] as NodeB
}
NodeA --> NodeB
@enduml"#;
        let d = parse_component_diagram(src).unwrap();
        assert!(
            d.edges.iter().any(|e| e.from == "NodeA" && e.to == "NodeB"),
            "expected edge NodeA -> NodeB, got {:?}",
            d.edges
        );
    }

    #[test]
    fn note_over_two_targets_parses_both_ids() {
        let src = "@startuml\n[A]\n[B]\nnote over A, B\nhello\nend note\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.notes.len(), 1);
        assert_eq!(d.notes[0].target_id, "A");
        assert_eq!(d.notes[0].target_id_secondary.as_deref(), Some("B"));
        assert!(d.notes[0].text.contains("hello"));
    }

    #[test]
    fn bracket_node_parses_stereotype_suffix() {
        let src = "@startuml\n[DB] <<repository>>\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].id, "DB");
        assert_eq!(d.nodes[0].stereotype.as_deref(), Some("repository"));
    }

    #[test]
    fn bracket_alias_with_stereotype() {
        let src = "@startuml\n[Data] as DR <<repository>>\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].id, "DR");
        assert_eq!(d.nodes[0].stereotype.as_deref(), Some("repository"));
    }

    #[test]
    fn component_diagram_parses_title_line() {
        let src = "@startuml\ntitle My Architecture\n[A]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.title.as_deref(), Some("My Architecture"));
    }

    #[test]
    fn component_diagram_parses_caption_line() {
        let src = "@startuml\ncaption Bottom note\n[A]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.caption.as_deref(), Some("Bottom note"));
    }

    #[test]
    fn component_diagram_multiline_title_end_title() {
        let src = r#"@startuml
title
First line
Second line
end title
[A]
@enduml"#;
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.title.as_deref(), Some("First line\nSecond line"));
    }

    #[test]
    fn component_diagram_multiline_caption_end_caption() {
        let src = r#"@startuml
caption
Line A
Line B
end caption
[B]
@enduml"#;
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.caption.as_deref(), Some("Line A\nLine B"));
    }

    #[test]
    fn title_keyword_does_not_match_titles_prefix() {
        let src = "@startuml\ntitles are wrong\n[A]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert!(d.title.is_none());
        assert!(d.nodes.iter().any(|n| n.id == "A"));
    }

    #[test]
    fn unsupported_rectangle_returns_unsupported_error() {
        let src = "@startuml\nrectangle Foo\n@enduml";
        let e = parse_component_diagram(src).unwrap_err();
        assert!(matches!(e, NativeError::Unsupported { .. }), "{e:?}");
    }

    #[test]
    fn edge_inline_bracket_color_red() {
        let src = "@startuml\n[A] -[#red]-> [B]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges[0].color.as_deref(), Some("red"));
        assert!(!d.edges[0].hidden);
    }

    #[test]
    fn edge_trailing_hash_color() {
        let src = "@startuml\n[A] --> [B] #blue\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges[0].color.as_deref(), Some("blue"));
    }

    #[test]
    fn hidden_edge_flag() {
        let src = "@startuml\n[A] -[hidden]- [B]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert!(d.edges[0].hidden);
    }

    #[test]
    fn bracket_node_trailing_color() {
        let src = "@startuml\n[A] #lightblue\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].color.as_deref(), Some("lightblue"));
    }

    #[test]
    fn component_line_stereotype() {
        let src = "@startuml\ncomponent \"X\" as Y <<svc>>\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].stereotype.as_deref(), Some("svc"));
    }

    #[test]
    fn database_line_stereotype() {
        let src = "@startuml\ndatabase DB <<store>>\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.nodes[0].stereotype.as_deref(), Some("store"));
    }

    #[test]
    fn skinparam_default_font_name_parses() {
        let src = "@startuml\nskinparam defaultFontName Courier\n[A]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.skinparam_default_font_name.as_deref(), Some("Courier"));
    }

    #[test]
    fn hidden_and_colored_edges_coexist() {
        let src = "@startuml\n[A] -[#990000]-> [B]\n[C] -[hidden]- [D]\n@enduml";
        let d = parse_component_diagram(src).unwrap();
        assert_eq!(d.edges.len(), 2);
        assert_eq!(d.edges[0].color.as_deref(), Some("990000"));
        assert!(d.edges[1].hidden);
    }
}
