//! 序列图文本 → IR。`!theme` 跳过；`skinparam` 白名单外报错；其余未实现指令静默跳过。

use crate::plantuml_native::ir::{
    ActivationSpan, AltSection, DiagramLegend, LegendAlign, MessageArrow,
    NotePlacement, NoteShape, ParticipantBox, SequenceBodyItem, SequenceDelay, SequenceDelayKind, SequenceDiagram,
    SequenceDivider, SequenceMessage, SequenceNote, SequenceParticipant, SequenceRef,
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
    if t.is_empty() {
        return None;
    }
    if t.starts_with('\'') {
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

/// 类图等关键字：出现在序列图上下文中即报错（计划测试场景）。
/// `kw` 不含尾部空格：匹配后下一字节须为空白或行尾（避免误伤含 `->` 的消息行）。
///
/// 前缀比较必须用 `str::get`：按字节 `line[..kw.len()]` 在 `kw.len()` 落在多字节 UTF-8
/// 字符中间时会 panic（例如关键字 `abstract` 长 8 字节，行 `title 接口…` 的前 8 字节会落在「接」内）。
fn rejects_as_non_sequence(line: &str) -> bool {
    let starts = |kw: &str| match line.get(..kw.len()) {
        Some(head) => {
            head.eq_ignore_ascii_case(kw)
                && line
                    .as_bytes()
                    .get(kw.len())
                    .map_or(true, |b| b.is_ascii_whitespace())
        }
        None => false,
    };
    starts("class")
        || starts("interface")
        || starts("enum")
        || starts("abstract")
        || starts("annotation")
        || starts("namespace")
        || starts("package")
        || starts("component")
        || starts("usecase")
        || starts("object")
        || starts("map")
        || starts("salt")
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 解析 `participant …` / `actor …`：单 token id，或 `participant "Name" as id`（`actor` 同形）。
fn try_parse_participant(
    line: &str,
    line_no: usize,
) -> Result<Option<(String, Option<String>)>, NativeError> {
    let lower = line.to_ascii_lowercase();
    // 支持多种参与者类型关键字（语法相同，仅显示样式不同）
    let rest = if lower.starts_with("participant ") {
        line["participant ".len()..].trim()
    } else if lower.starts_with("actor ") {
        line["actor ".len()..].trim()
    } else if lower.starts_with("boundary ") {
        line["boundary ".len()..].trim()
    } else if lower.starts_with("control ") {
        line["control ".len()..].trim()
    } else if lower.starts_with("entity ") {
        line["entity ".len()..].trim()
    } else if lower.starts_with("database ") {
        line["database ".len()..].trim()
    } else if lower.starts_with("collections ") {
        line["collections ".len()..].trim()
    } else {
        return Ok(None);
    };

    if rest.starts_with('"') {
        let (display, after_quote) = parse_double_quoted_string(rest, line_no)?;
        let tail = after_quote.trim_start();
        let parts: Vec<&str> = tail.split_whitespace().collect();
        if parts.len() != 2 || !parts[0].eq_ignore_ascii_case("as") {
            return Err(parse_err(
                line_no,
                "引号别名后须为 `as id`，如 participant \"Display\" as d",
            ));
        }
        let id = parts[1];
        if !valid_id(id) {
            return Err(parse_err(
                line_no,
                "`as` 后的 id 须为单 token（字母、数字、下划线）",
            ));
        }
        if display.is_empty() {
            return Err(parse_err(line_no, "参与者展示名不能为空字符串"));
        }
        return Ok(Some((id.to_string(), Some(display))));
    }

    let id = rest
        .split_whitespace()
        .next()
        .ok_or_else(|| parse_err(line_no, "participant / actor 后缺少名称或 id"))?;
    if id.len() != rest.len() {
        return Ok(None);
    }
    if !valid_id(id) {
        return Ok(None);
    }
    Ok(Some((id.to_string(), None)))
}

/// `input` 须以 `"` 开头；返回 (内文已反转义, 闭合引号之后的子串)。
fn parse_double_quoted_string(input: &str, line_no: usize) -> Result<(String, &str), NativeError> {
    let bytes = input.as_bytes();
    if bytes.first() != Some(&b'"') {
        return Err(parse_err(
            line_no,
            "内部错误：期望以双引号开头的参与者展示名",
        ));
    }
    let mut i = 1usize;
    let mut out = String::new();
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                let rest = &input[i + 1..];
                return Ok((out, rest));
            }
            b'\\' if i + 1 < bytes.len() => match bytes[i + 1] {
                b'"' => {
                    out.push('"');
                    i += 2;
                }
                b'\\' => {
                    out.push('\\');
                    i += 2;
                }
                _ => {
                    out.push('\\');
                    i += 1;
                }
            },
            _ => {
                let ch = input[i..].chars().next().unwrap();
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    Err(parse_err(
        line_no,
        "参与者展示名字符串未闭合（缺少结束引号）",
    ))
}

/// PlantUML 消息标签内联转义（与 JAR 常见子集对齐：`\\n`、`\t`、`\\` 等）。
fn unescape_plantuml_message_label(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut it = raw.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('\\') => out.push('\\'),
            Some(o) => {
                out.push('\\');
                out.push(o);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// 解析 `from -> to : label` / `-->` / `->>` / `-->>`（长箭头优先匹配，避免 `-->>`、`->>` 被截断）。
/// 同时解析 `++`/`--` 激活/停用简写（如 `A -> B ++ : msg`）和颜色（如 `A -> B #red : msg`）。
fn parse_message_line(line: &str, line_no: usize) -> Result<SequenceMessage, NativeError> {
    let (before_colon, after_colon) = line
        .split_once(':')
        .ok_or_else(|| parse_err(line_no, "消息行缺少 ':'（标签可为空，如 `A -> B :`）"))?;

    let label = unescape_plantuml_message_label(after_colon.trim());

    // 解析颜色：在 before_colon 中查找 #color 模式
    let (before_colon, color) = parse_color_from_message_part(before_colon);

    let (from, arrow, to_part, _is_reverse, activate_from, deactivate_from, activate_to, _deactivate_to) =
        split_arrow(before_colon.trim()).ok_or_else(|| {
        parse_err(
            line_no,
            "无法识别消息箭头（支持 `->`、`-->`、`->>`、`-->>`、`<-`、`<--`、`<<-`、`<<--`，如 `Alice -> Bob : hi`）",
        )
    })?;

    let to = to_part.trim();
    if !valid_id(from) {
        return Err(parse_err(
            line_no,
            "消息起点须为单 token 参与者名（字母、数字、下划线）",
        ));
    }
    if !valid_id(to) {
        return Err(parse_err(
            line_no,
            "消息终点须为单 token 参与者名（字母、数字、下划线）",
        ));
    }

    // 根据箭头方向确定激活/停用目标
    // `++` 在 from 侧表示激活 from，`++` 在 to 侧表示激活 to
    // `--` 在 from 侧表示停用 from，`--` 在 to 侧表示停用 to
    let (activate_target, deactivate_source) = if _is_reverse {
        // 反向箭头：from/to 已交换，激活/停用逻辑也需要相应调整
        (activate_from, deactivate_from)
    } else {
        (activate_to, deactivate_from)
    };

    Ok(SequenceMessage {
        from: from.to_string(),
        to: to.to_string(),
        label,
        arrow,
        activate_target,
        deactivate_source,
        color,
    })
}

/// 从消息行的前半部分（冒号前）解析颜色
/// 颜色格式：`#red` 或 `#FF8833`
/// 返回 (移除颜色后的字符串, 颜色值或None)
fn parse_color_from_message_part(s: &str) -> (&str, Option<String>) {
    // 查找 # 后跟颜色名或十六进制数字
    let s = s.trim();

    // 从右向左查找颜色标记（可能在参与者后面）
    if let Some(hash_pos) = s.rfind('#') {
        let after_hash = &s[hash_pos + 1..];

        // 检查是否是有效的颜色（颜色名或十六进制）
        // 颜色名：字母组成，如 red, blue, green
        // 十六进制：6位十六进制数字，如 FF8833
        let color_end = after_hash
            .find(|c: char| !c.is_ascii_alphanumeric())
            .unwrap_or(after_hash.len());

        if color_end > 0 {
            let color_str = &after_hash[..color_end];
            // 验证颜色格式：要么全是字母（颜色名），要么是有效的十六进制
            let is_valid_color = color_str.chars().all(|c| c.is_ascii_alphabetic())
                || (color_str.len() == 6 && color_str.chars().all(|c| c.is_ascii_hexdigit()));

            if is_valid_color {
                let before_color = s[..hash_pos].trim_end();
                return (before_color, Some(color_str.to_lowercase()));
            }
        }
    }

    (s, None)
}

/// 检查并移除参与者名称后的 `++` 和/或 `--` 后缀
/// 返回 (清理后的名称, 是否有++, 是否有--)
/// 支持: `B++`, `B--`, `B++--`, `B--++`
fn strip_activation_suffix(s: &str) -> (&str, bool, bool) {
    let s = s.trim();

    // 检查是否有 ++ 和 -- 的组合（顺序不限）
    let has_plus_plus = s.contains("++");
    let has_minus_minus = s.contains("--");

    // 简单情况：只有一个后缀
    if s.ends_with("++") && !has_minus_minus {
        return (s[..s.len()-2].trim_end(), true, false);
    }
    if s.ends_with("--") && !has_plus_plus {
        return (s[..s.len()-2].trim_end(), false, true);
    }

    // 复杂情况：同时有 ++ 和 --
    // 需要移除这些后缀并验证剩余部分是有效 ID
    let mut result = s;
    let mut act = false;
    let mut deact = false;

    // 从右向左移除后缀
    while result.ends_with("++") || result.ends_with("--") {
        if result.ends_with("++") {
            act = true;
            result = result[..result.len()-2].trim_end();
        } else if result.ends_with("--") {
            deact = true;
            result = result[..result.len()-2].trim_end();
        }
    }

    (result, act, deact)
}

/// 解析消息箭头，返回 (左侧参与者, 箭头类型, 右侧参与者, 是否反向, 左侧激活++, 左侧停用--, 右侧激活++, 右侧停用--)
/// 反向箭头如 `<-` 表示箭头方向从右到左，需要在后续处理中交换参与者
fn split_arrow(s: &str) -> Option<(&str, MessageArrow, &str, bool, bool, bool, bool, bool)> {
    // 正向箭头：-> --> ->> -->>
    if let Some(i) = s.find("-->>") {
        let left = s[..i].trim_end();
        let right = s[i + 4..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        return Some((l.trim(), MessageArrow::AsyncDashed, r.trim(), false, act_l, deact_l, act_r, deact_r));
    }
    if let Some(i) = s.find("->>") {
        let left = s[..i].trim_end();
        let right = s[i + 3..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        return Some((l.trim(), MessageArrow::AsyncSolid, r.trim(), false, act_l, deact_l, act_r, deact_r));
    }
    if let Some(i) = s.find("-->") {
        let left = s[..i].trim_end();
        let right = s[i + 3..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        return Some((l.trim(), MessageArrow::Dashed, r.trim(), false, act_l, deact_l, act_r, deact_r));
    }
    for (idx, _) in s.match_indices("->") {
        if idx > 0 && s.as_bytes()[idx - 1] == b'-' {
            continue;
        }
        let left = s[..idx].trim_end();
        let right = s[idx + 2..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        return Some((l.trim(), MessageArrow::Solid, r.trim(), false, act_l, deact_l, act_r, deact_r));
    }

    // 反向箭头：<- <--) <<- <<-- (从右向左，视觉效果相同但方向相反)
    if let Some(i) = s.find("<<--") {
        let left = s[..i].trim_end();
        let right = s[i + 4..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        // <<-- 表示从右到左的虚线空心箭头，等价于左侧 -->> 右侧
        // 对于反向箭头，left 和 right 的激活语义需要交换
        return Some((r.trim(), MessageArrow::AsyncDashed, l.trim(), true, act_r, deact_r, act_l, deact_l));
    }
    if let Some(i) = s.find("<<-") {
        let left = s[..i].trim_end();
        let right = s[i + 3..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        // <<- 表示从右到左的实线空心箭头，等价于左侧 ->> 右侧
        return Some((r.trim(), MessageArrow::AsyncSolid, l.trim(), true, act_r, deact_r, act_l, deact_l));
    }
    if let Some(i) = s.find("<--") {
        let left = s[..i].trim_end();
        let right = s[i + 3..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        // <-- 表示从右到左的虚线箭头，等价于左侧 --> 右侧
        return Some((r.trim(), MessageArrow::Dashed, l.trim(), true, act_r, deact_r, act_l, deact_l));
    }
    for (idx, _) in s.match_indices("<-") {
        if idx > 0 && s.as_bytes()[idx - 1] == b'-' {
            continue;
        }
        // 检查后面是否有额外的 -，避免匹配到 <--
        if idx + 2 < s.len() && s.as_bytes()[idx + 2] == b'-' {
            continue;
        }
        let left = s[..idx].trim_end();
        let right = s[idx + 2..].trim_start();
        let (l, act_l, deact_l) = strip_activation_suffix(left);
        let (r, act_r, deact_r) = strip_activation_suffix(right);
        // <- 表示从右到左的实线箭头，等价于左侧 -> 右侧
        return Some((r.trim(), MessageArrow::Solid, l.trim(), true, act_r, deact_r, act_l, deact_l));
    }
    None
}

/// 检测行是否包含箭头（正向或反向）
fn contains_arrow(t: &str) -> bool {
    t.contains("->") || t.contains("<-")
}

fn ensure_participant(order: &mut Vec<SequenceParticipant>, id: &str, display: Option<String>) {
    if let Some(p) = order.iter_mut().find(|p| p.id == id) {
        if p.display.is_none() {
            p.display = display;
        }
        return;
    }
    order.push(SequenceParticipant {
        id: id.to_string(),
        display,
        is_created: false,
    });
}

/// 按**字符**截断，避免 `&str[..byte]` 切在多字节字符上 panic。
fn truncate(s: &str, max_chars: usize) -> String {
    let n = s.chars().count();
    if n <= max_chars {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max_chars).collect();
        t.push('…');
        t
    }
}

/// `alt` 行（整词），返回标题（可为空）。
fn try_alt_header(t: &str) -> Option<String> {
    let l = t.to_ascii_lowercase();
    if !l.starts_with("alt") {
        return None;
    }
    let rest = &t[3..];
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None;
    }
    Some(rest.trim().to_string())
}

fn try_opt_header(t: &str) -> Option<String> {
    let l = t.to_ascii_lowercase();
    if !l.starts_with("opt") {
        return None;
    }
    let rest = &t[3..];
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None;
    }
    Some(rest.trim().to_string())
}

fn try_else_header(t: &str) -> Option<String> {
    let l = t.to_ascii_lowercase();
    if !l.starts_with("else") {
        return None;
    }
    let rest = &t[4..];
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None;
    }
    Some(rest.trim().to_string())
}

/// `par` 块内分段：`and` 与 `else` 等价（整词，避免匹配 `android`）。
fn try_and_header(t: &str) -> Option<String> {
    let l = t.to_ascii_lowercase();
    if !l.starts_with("and") {
        return None;
    }
    let rest = &t[3..];
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None;
    }
    Some(rest.trim().to_string())
}

fn is_standalone_end(t: &str) -> bool {
    let mut it = t.split_whitespace();
    matches!((it.next(), it.next()), (Some(w), None) if w.eq_ignore_ascii_case("end"))
}

/// `loop …` 整词开头，返回标题（可空）。
fn try_loop_header(t: &str) -> Option<String> {
    let l = t.to_ascii_lowercase();
    if !l.starts_with("loop") {
        return None;
    }
    let rest = &t[4..];
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None;
    }
    Some(rest.trim().to_string())
}

/// `par …` 整词开头（避免匹配 `parallel` 等非关键字）。
fn try_par_header(t: &str) -> Option<String> {
    let l = t.to_ascii_lowercase();
    if !l.starts_with("par") {
        return None;
    }
    let rest = &t[3..];
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None;
    }
    Some(rest.trim().to_string())
}

/// `group …` 整词开头，返回标题（可空）。
fn try_group_header(t: &str) -> Option<String> {
    let l = t.to_ascii_lowercase();
    if !l.starts_with("group") {
        return None;
    }
    let rest = &t[5..];
    if !rest.is_empty() && !rest.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None;
    }
    Some(rest.trim().to_string())
}

/// 图标题单行长度上限（多行合并后同样校验）。
const MAX_TITLE_CHARS: usize = 2048;

fn is_end_block_line(t: &str, block_kw: &str) -> bool {
    let mut it = t.split_whitespace();
    matches!(
        (it.next(), it.next(), it.next()),
        (Some(a), Some(b), None) if a.eq_ignore_ascii_case("end") && b.eq_ignore_ascii_case(block_kw)
    )
}

enum BlockDirective {
    Set(String),
    OpenBlock,
}

/// 顶层 `kw …`（整词）或单独 `kw` 开启多行块（`title` / `header` / `footer`）。
fn try_parse_kw_block(
    t: &str,
    ln: usize,
    kw: &str,
    max_chars: usize,
    label_zh: &str,
) -> Result<Option<BlockDirective>, NativeError> {
    let low = t.to_ascii_lowercase();
    let kw_low = kw.to_ascii_lowercase();
    if !low.starts_with(&kw_low) {
        return Ok(None);
    }
    let after = match t.get(kw.len()..) {
        Some(a) => a,
        None => return Err(parse_err(ln, format!("{kw} 语法错误"))),
    };
    if !after.is_empty() && !after.starts_with(|c: char| c.is_ascii_whitespace()) {
        return Ok(None);
    }
    let rest = after.trim_start();
    if rest.is_empty() {
        return Ok(Some(BlockDirective::OpenBlock));
    }
    if rest.chars().count() > max_chars {
        return Err(parse_err(
            ln,
            format!("{label_zh}过长（上限 {max_chars} 字符）"),
        ));
    }
    Ok(Some(BlockDirective::Set(rest.to_string())))
}

/// 顶层 `title …`（整词）或单独 `title` 开启多行块。
/// 图例正文合并后长度上限。
const MAX_LEGEND_CHARS: usize = 4096;

fn is_end_legend_line(t: &str) -> bool {
    let mut it = t.split_whitespace();
    matches!(
        (it.next(), it.next(), it.next()),
        (Some(a), Some(b), None) if a.eq_ignore_ascii_case("end") && b.eq_ignore_ascii_case("legend")
    )
}

fn is_legend_opener_line(t: &str) -> bool {
    let low = t.to_ascii_lowercase();
    low.starts_with("legend")
        && (low.len() == 6
            || low
                .as_bytes()
                .get(6)
                .map_or(false, |b| b.is_ascii_whitespace()))
}

/// `legend` / `legend left|right|center` 开启多行块；其它形式（如 `legend top`）返回 `None` 并静默跳过。
fn try_parse_legend_open(t: &str) -> Option<LegendAlign> {
    if !is_legend_opener_line(t) {
        return None;
    }
    let rest = t.get(6..)?.trim_start();
    if rest.is_empty() {
        return Some(LegendAlign::Right);
    }
    let word = rest.split_whitespace().next()?;
    if word.len() != rest.len() {
        return None;
    }
    if word.eq_ignore_ascii_case("left") {
        return Some(LegendAlign::Left);
    }
    if word.eq_ignore_ascii_case("right") {
        return Some(LegendAlign::Right);
    }
    if word.eq_ignore_ascii_case("center") {
        return Some(LegendAlign::Center);
    }
    None
}

fn skinparam_key_allowed(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k == "monochrome"
        || k == "shadowing"
        || k.starts_with("sequence")
        || k.starts_with("default")
        || k.starts_with("lifeline")
        || k.starts_with("responsemessage")
        || k.starts_with("participant")
        || k.starts_with("title")
        || k.starts_with("footer")
        || k.starts_with("header")
}

/// 识别 `skinparam …`：白名单内跳过，否则 Parse。
fn try_handle_skinparam(t: &str, ln: usize) -> Result<bool, NativeError> {
    let low = t.to_ascii_lowercase();
    if !low.starts_with("skinparam") {
        return Ok(false);
    }
    let after = match t.get(9..) {
        Some(a) => a,
        None => return Ok(false),
    };
    if !after.is_empty() && !after.starts_with(|c: char| c.is_ascii_whitespace()) {
        return Ok(false);
    }
    let rest = after.trim();
    let key = rest.split_whitespace().next().unwrap_or("");
    if key.is_empty() {
        return Err(parse_err(ln, "skinparam 后须指定参数名"));
    }
    if skinparam_key_allowed(key) {
        Ok(true)
    } else {
        Err(parse_err(
            ln,
            format!(
                "不支持的 skinparam：`{key}`（仅允许 sequence*/default*/lifeline*/monochrome/shadowing/participant*/title 等前缀）"
            ),
        ))
    }
}

/// `autonumber` / `autonumber n` / `autonumber stop`。
fn try_handle_autonumber(t: &str, ln: usize, out: &mut Option<u32>) -> Result<bool, NativeError> {
    let low = t.to_ascii_lowercase();
    if !low.starts_with("autonumber") {
        return Ok(false);
    }
    let after = match t.get(10..) {
        Some(a) => a,
        None => return Ok(false),
    };
    if !after.is_empty() && !after.starts_with(|c: char| c.is_ascii_whitespace()) {
        return Ok(false);
    }
    let tail = after.trim();
    if tail.is_empty() {
        *out = Some(1);
        return Ok(true);
    }
    let head = tail.split_whitespace().next().unwrap_or("");
    if head.eq_ignore_ascii_case("stop") {
        *out = None;
        return Ok(true);
    }
    let n: u32 = head
        .parse()
        .map_err(|_| parse_err(ln, "autonumber 后须为十进制数字或 stop"))?;
    *out = Some(n);
    Ok(true)
}

fn is_end_note_line(t: &str) -> bool {
    let mut it = t.split_whitespace();
    matches!(
        (it.next(), it.next(), it.next()),
        (Some(a), Some(b), None) if a.eq_ignore_ascii_case("end") && b.eq_ignore_ascii_case("note")
    )
}

fn is_end_box_line(t: &str) -> bool {
    let mut it = t.split_whitespace();
    matches!(
        (it.next(), it.next(), it.next()),
        (Some(a), Some(b), None) if a.eq_ignore_ascii_case("end") && b.eq_ignore_ascii_case("box")
    )
}

/// 识别 `box` 开头：`box` / `box Color` / `box "Title"` / `box Color "Title"` / `box "Title" Color`
/// 返回 `(title, color)`；若不为 `box` 开头返回 `None`。
fn try_parse_box_open(t: &str) -> Option<(Option<String>, Option<String>)> {
    let low = t.to_ascii_lowercase();
    if !low.starts_with("box") {
        return None;
    }
    let after = t.get(3..)?.trim_start();
    if after.is_empty() {
        return Some((None, None));
    }

    // 尝试解析：可能是 `Color`、`"Title"`、`Color "Title"`、`"Title" Color` 之一
    // 颜色：`#RGB`、`#RRGGBB`、`rgb(...)`、颜色名（如 `LightBlue`）
    // 标题：双引号包裹

    let first_char = after.chars().next()?;

    if first_char == '"' {
        // `box "Title"` 或 `box "Title" Color`
        let (title, rest) = parse_double_quoted_string_no_err(after)?;
        let rest = rest.trim();
        if rest.is_empty() {
            return Some((Some(title), None));
        }
        // 后面可能是颜色
        if rest.starts_with('#')
            || rest.to_lowercase().starts_with("rgb")
            || is_color_name(rest.split_whitespace().next()?)
        {
            return Some((Some(title), Some(rest.split_whitespace().next()?.to_string())));
        }
        // 后面有内容但不是颜色，跳过
        return None;
    }

    // 假设第一个 token 是颜色
    let mut parts = after.split_whitespace();
    let color_token = parts.next()?;
    let color = if color_token.starts_with('#')
        || color_token.to_lowercase().starts_with("rgb")
        || is_color_name(color_token)
    {
        Some(color_token.to_string())
    } else {
        // 不是颜色，可能是标题没加引号（不支持）
        return None;
    };

    let rest = parts.collect::<Vec<_>>().join(" ");
    if rest.is_empty() {
        return Some((None, color));
    }

    // `box Color "Title"`
    if let Some((title, remaining)) = parse_double_quoted_string_no_err(&rest) {
        if remaining.trim().is_empty() {
            return Some((Some(title), color));
        }
    }
    None
}

/// 简单颜色名白名单（PlantUML 支持大量颜色名；这里只列常见）
fn is_color_name(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "white" | "black"
            | "red"
            | "green"
            | "blue"
            | "yellow"
            | "cyan"
            | "magenta"
            | "orange"
            | "purple"
            | "pink"
            | "gray"
            | "grey"
            | "lightblue"
            | "lightgreen"
            | "lightgray"
            | "lightgrey"
            | "darkblue"
            | "darkgreen"
            | "darkgray"
            | "darkgrey"
            | "navy"
            | "teal"
            | "olive"
            | "maroon"
            | "fuchsia"
            | "aqua"
            | "lime"
            | "silver"
            | "gold"
    )
}

/// 不报错版本：若不以 `"` 开头返回 `None`。
fn parse_double_quoted_string_no_err(input: &str) -> Option<(String, &str)> {
    let bytes = input.as_bytes();
    if bytes.first()? != &b'"' {
        return None;
    }
    let mut i = 1usize;
    let mut out = String::new();
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                let rest = &input[i + 1..];
                return Some((out, rest));
            }
            b'\\' if i + 1 < bytes.len() => match bytes[i + 1] {
                b'"' => {
                    out.push('"');
                    i += 2;
                }
                b'\\' => {
                    out.push('\\');
                    i += 2;
                }
                _ => {
                    out.push('\\');
                    i += 1;
                }
            },
            b_val => {
                out.push(b_val as char);
                i += 1;
            }
        }
    }
    // 未闭合，返回已解析内容
    Some((out, ""))
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let pb = prefix.as_bytes();
    if s.len() < pb.len() {
        return None;
    }
    let head = s.get(..pb.len())?;
    if !head.eq_ignore_ascii_case(prefix) {
        return None;
    }
    s.get(pb.len()..).map(str::trim_start)
}

enum NoteStart {
    Single(SequenceNote),
    Multi(NotePlacement, NoteShape),
}

/// 解析 note/hnote/rnote 行，返回 NoteStart 或 None（非 note 行）。
fn parse_note_line(t: &str, ln: usize) -> Result<Option<NoteStart>, NativeError> {
    let low = t.to_ascii_lowercase();

    // 检测 note 类型关键字
    let (shape, kw_len): (NoteShape, usize) = if low.starts_with("hnote") {
        (NoteShape::Hexagonal, 5)
    } else if low.starts_with("rnote") {
        (NoteShape::Rectangular, 5)
    } else if low.starts_with("note") {
        (NoteShape::Standard, 4)
    } else {
        return Ok(None);
    };

    let after = match t.get(kw_len..) {
        Some(a) => a,
        None => return Err(parse_err(ln, "note/hnote/rnote 语法错误")),
    };
    if !after.is_empty() && !after.starts_with(|c: char| c.is_ascii_whitespace()) {
        return Ok(None);
    }
    let rest = after.trim_start();
    if rest.is_empty() {
        return Err(parse_err(ln, "note/hnote/rnote 后须指定 left of / right of / over"));
    }
    if let Some(tail) = strip_prefix_ci(rest, "left of") {
        return parse_note_after_side(true, tail, ln, shape);
    }
    if let Some(tail) = strip_prefix_ci(rest, "right of") {
        return parse_note_after_side(false, tail, ln, shape);
    }
    if let Some(tail) = strip_prefix_ci(rest, "over") {
        return parse_note_over_tail(tail, ln, shape);
    }
    Err(parse_err(
        ln,
        "不支持的 note 语法（仅 left of / right of / over）",
    ))
}

fn parse_note_after_side(
    left: bool,
    tail: &str,
    ln: usize,
    shape: NoteShape,
) -> Result<Option<NoteStart>, NativeError> {
    let id = tail
        .split_whitespace()
        .next()
        .ok_or_else(|| parse_err(ln, "note 缺少参与者 id"))?;
    if !valid_id(id) {
        return Err(parse_err(ln, format!("非法参与者 id：{id}")));
    }
    let after_id = tail[id.len()..].trim_start();
    let placement = if left {
        NotePlacement::LeftOf(id.to_string())
    } else {
        NotePlacement::RightOf(id.to_string())
    };
    if after_id.starts_with(':') {
        let text = after_id[1..].trim().to_string();
        return Ok(Some(NoteStart::Single(SequenceNote { placement, text, shape })));
    }
    if !after_id.is_empty() {
        return Err(parse_err(ln, "note 行语法错误"));
    }
    Ok(Some(NoteStart::Multi(placement, shape)))
}

fn parse_note_over_tail(tail: &str, ln: usize, shape: NoteShape) -> Result<Option<NoteStart>, NativeError> {
    if let Some(colon_pos) = tail.find(':') {
        let ids_part = tail[..colon_pos].trim();
        let text = tail[colon_pos + 1..].trim().to_string();
        let ids: Vec<&str> = ids_part
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        match ids.as_slice() {
            [a] => {
                if !valid_id(a) {
                    return Err(parse_err(ln, format!("非法参与者 id：{a}")));
                }
                Ok(Some(NoteStart::Single(SequenceNote {
                    placement: NotePlacement::Over1(a.to_string()),
                    text,
                    shape,
                })))
            }
            [a, b] => {
                if !valid_id(a) || !valid_id(b) {
                    return Err(parse_err(ln, "note over 参与者 id 非法"));
                }
                Ok(Some(NoteStart::Single(SequenceNote {
                    placement: NotePlacement::Over2(a.to_string(), b.to_string()),
                    text,
                    shape,
                })))
            }
            _ => Err(parse_err(ln, "note over 须为 1 或 2 个参与者")),
        }
    } else {
        let ids_part = tail.trim();
        let ids: Vec<&str> = ids_part
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        match ids.as_slice() {
            [a] => {
                if !valid_id(a) {
                    return Err(parse_err(ln, format!("非法参与者 id：{a}")));
                }
                Ok(Some(NoteStart::Multi(NotePlacement::Over1(a.to_string()), shape)))
            }
            [a, b] => {
                if !valid_id(a) || !valid_id(b) {
                    return Err(parse_err(ln, "note over 参与者 id 非法"));
                }
                Ok(Some(NoteStart::Multi(
                    NotePlacement::Over2(a.to_string(), b.to_string()),
                    shape,
                )))
            }
            _ => Err(parse_err(ln, "note over 须为 1 或 2 个参与者")),
        }
    }
}

fn ensure_participants_for_note_start(ns: &NoteStart, order: &mut Vec<SequenceParticipant>) {
    match ns {
        NoteStart::Single(n) => {
            ensure_participants_for_placement(&n.placement, order);
        }
        NoteStart::Multi(p, _) => {
            ensure_participants_for_placement(p, order);
        }
    }
}

fn ensure_participants_for_placement(p: &NotePlacement, order: &mut Vec<SequenceParticipant>) {
    match p {
        NotePlacement::LeftOf(id) | NotePlacement::RightOf(id) | NotePlacement::Over1(id) => {
            ensure_participant(order, id, None);
        }
        NotePlacement::Over2(a, b) => {
            ensure_participant(order, a, None);
            ensure_participant(order, b, None);
        }
    }
}

struct AltParse {
    sections: Vec<AltSection>,
    cur_label: String,
    cur_body: Vec<SequenceBodyItem>,
}

struct OptParse {
    label: String,
    body: Vec<SequenceBodyItem>,
}

enum ParseState {
    Top,
    InAlt(AltParse),
    InOpt(OptParse),
    InLoop(OptParse),
    InGroup(OptParse),
    InPar(AltParse),
    /// `box` / `end box` 分组框（仅顶层有效；fragment 内遇到 `box` 静默跳过）
    InBox {
        title: Option<String>,
        color: Option<String>,
        participant_ids: Vec<String>,
    },
    InNote {
        placement: NotePlacement,
        lines: Vec<String>,
        resume: Box<ParseState>,
        shape: NoteShape,
    },
    /// 仅自 `Top` 进入：`title` 单独成行后直至 `end title`。
    InTitle {
        lines: Vec<String>,
    },
    /// 仅自 `Top` 进入：`header` … `end header`。
    InHeader {
        lines: Vec<String>,
    },
    /// 仅自 `Top` 进入：`footer` … `end footer`。
    InFooter {
        lines: Vec<String>,
    },
    /// 仅自 `Top` 进入：`legend` … `end legend`。
    InLegend {
        align: LegendAlign,
        lines: Vec<String>,
    },
}

fn push_note_step(state: &mut ParseState, body: &mut Vec<SequenceBodyItem>, note: SequenceNote) {
    match state {
        ParseState::Top => {
            body.push(SequenceBodyItem::Note(note));
        }
        ParseState::InAlt(a) | ParseState::InPar(a) => {
            a.cur_body.push(SequenceBodyItem::Note(note));
        }
        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
            o.body.push(SequenceBodyItem::Note(note));
        }
        ParseState::InBox { .. } => {
            // box 内不支持 note（静默跳过）
        }
        ParseState::InNote { .. }
        | ParseState::InTitle { .. }
        | ParseState::InHeader { .. }
        | ParseState::InFooter { .. }
        | ParseState::InLegend { .. } => {}
    }
}

fn push_delay_step(
    state: &mut ParseState,
    body: &mut Vec<SequenceBodyItem>,
    delay: SequenceDelay,
) {
    match state {
        ParseState::Top => {
            body.push(SequenceBodyItem::Delay(delay));
        }
        ParseState::InAlt(a) | ParseState::InPar(a) => {
            a.cur_body.push(SequenceBodyItem::Delay(delay));
        }
        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
            o.body.push(SequenceBodyItem::Delay(delay));
        }
        ParseState::InBox { .. } => {
            // box 内不支持 delay（静默跳过）
        }
        ParseState::InNote { .. }
        | ParseState::InTitle { .. }
        | ParseState::InHeader { .. }
        | ParseState::InFooter { .. }
        | ParseState::InLegend { .. } => {}
    }
}

fn push_divider_step(
    state: &mut ParseState,
    body: &mut Vec<SequenceBodyItem>,
    divider: SequenceDivider,
) {
    match state {
        ParseState::Top => {
            body.push(SequenceBodyItem::Divider(divider));
        }
        ParseState::InAlt(a) | ParseState::InPar(a) => {
            a.cur_body.push(SequenceBodyItem::Divider(divider));
        }
        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
            o.body.push(SequenceBodyItem::Divider(divider));
        }
        ParseState::InBox { .. } => {
            // box 内不支持 divider（静默跳过）
        }
        ParseState::InNote { .. }
        | ParseState::InTitle { .. }
        | ParseState::InHeader { .. }
        | ParseState::InFooter { .. }
        | ParseState::InLegend { .. } => {}
    }
}

fn push_ref_step(
    state: &mut ParseState,
    body: &mut Vec<SequenceBodyItem>,
    ref_item: SequenceRef,
) {
    match state {
        ParseState::Top => {
            body.push(SequenceBodyItem::Ref(ref_item));
        }
        ParseState::InAlt(a) | ParseState::InPar(a) => {
            a.cur_body.push(SequenceBodyItem::Ref(ref_item));
        }
        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
            o.body.push(SequenceBodyItem::Ref(ref_item));
        }
        ParseState::InBox { .. } => {
            // box 内不支持 ref（静默跳过）
        }
        ParseState::InNote { .. }
        | ParseState::InTitle { .. }
        | ParseState::InHeader { .. }
        | ParseState::InFooter { .. }
        | ParseState::InLegend { .. } => {}
    }
}

fn push_newpage_step(
    state: &mut ParseState,
    body: &mut Vec<SequenceBodyItem>,
    title: Option<String>,
) {
    match state {
        ParseState::Top => {
            body.push(SequenceBodyItem::Newpage { title });
        }
        ParseState::InAlt(a) | ParseState::InPar(a) => {
            a.cur_body.push(SequenceBodyItem::Newpage { title });
        }
        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
            o.body.push(SequenceBodyItem::Newpage { title });
        }
        ParseState::InBox { .. } => {
            // box 内不支持 newpage（静默跳过）
        }
        ParseState::InNote { .. }
        | ParseState::InTitle { .. }
        | ParseState::InHeader { .. }
        | ParseState::InFooter { .. }
        | ParseState::InLegend { .. } => {}
    }
}

fn push_destroy_step(
    state: &mut ParseState,
    body: &mut Vec<SequenceBodyItem>,
    participant_id: String,
) {
    match state {
        ParseState::Top => {
            body.push(SequenceBodyItem::Destroy { participant_id });
        }
        ParseState::InAlt(a) | ParseState::InPar(a) => {
            a.cur_body.push(SequenceBodyItem::Destroy { participant_id });
        }
        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
            o.body.push(SequenceBodyItem::Destroy { participant_id });
        }
        ParseState::InBox { .. } => {
            // box 内不支持 destroy（静默跳过）
        }
        ParseState::InNote { .. }
        | ParseState::InTitle { .. }
        | ParseState::InHeader { .. }
        | ParseState::InFooter { .. }
        | ParseState::InLegend { .. } => {}
    }
}

fn push_create_step(
    state: &mut ParseState,
    body: &mut Vec<SequenceBodyItem>,
    participant_id: String,
) {
    match state {
        ParseState::Top => {
            body.push(SequenceBodyItem::Create { participant_id });
        }
        ParseState::InAlt(a) | ParseState::InPar(a) => {
            a.cur_body.push(SequenceBodyItem::Create { participant_id });
        }
        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
            o.body.push(SequenceBodyItem::Create { participant_id });
        }
        ParseState::InBox { .. } => {
            // box 内不支持 create（静默跳过）
        }
        ParseState::InNote { .. }
        | ParseState::InTitle { .. }
        | ParseState::InHeader { .. }
        | ParseState::InFooter { .. }
        | ParseState::InLegend { .. } => {}
    }
}

#[derive(Default)]
struct ActTracker {
    stack: Vec<(String, usize)>,
    spans: Vec<ActivationSpan>,
    flat_msg: usize,
}

impl ActTracker {
    fn on_push_message(&mut self) {
        self.flat_msg += 1;
    }

    fn activate(&mut self, id: String) {
        self.stack.push((id, self.flat_msg));
    }

    /// 激活简写 `++`：在当前消息之后激活（start_msg_index 为当前消息索引）
    fn activate_after_message(&mut self, id: String) {
        self.stack.push((id, self.flat_msg.saturating_sub(1)));
    }

    fn deactivate(&mut self, id: &str, line_no: usize) -> Result<(), NativeError> {
        let pos = self
            .stack
            .iter()
            .rposition(|(p, _)| p == id)
            .ok_or_else(|| parse_err(line_no, format!("无匹配的 activate（deactivate {id}）")))?;
        let (_, start) = self.stack.remove(pos);
        self.spans.push(ActivationSpan {
            participant_id: id.to_string(),
            start_msg_index: start,
            end_msg_index: self.flat_msg,
        });
        Ok(())
    }

    /// 停用简写 `--`：在当前消息之后停用（end_msg_index 为当前消息索引）
    fn deactivate_after_message(&mut self, id: &str, line_no: usize) -> Result<(), NativeError> {
        let pos = self
            .stack
            .iter()
            .rposition(|(p, _)| p == id)
            .ok_or_else(|| parse_err(line_no, format!("无匹配的 activate（停用 {id}）")))?;
        let (_, start) = self.stack.remove(pos);
        self.spans.push(ActivationSpan {
            participant_id: id.to_string(),
            start_msg_index: start,
            end_msg_index: self.flat_msg, // 当前消息索引（已递增）
        });
        Ok(())
    }

    fn deactivate_all_for(&mut self, id: &str) {
        while let Some(pos) = self.stack.iter().rposition(|(p, _)| p == id) {
            let (pid, start) = self.stack.remove(pos);
            self.spans.push(ActivationSpan {
                participant_id: pid,
                start_msg_index: start,
                end_msg_index: self.flat_msg,
            });
        }
    }

    fn finish(self, _end_line: usize) -> Result<Vec<ActivationSpan>, NativeError> {
        // 自动关闭所有未 deactivate 的参与者（在图结束时激活条自然结束）
        let mut spans = self.spans;
        for (pid, start) in self.stack {
            spans.push(ActivationSpan {
                participant_id: pid,
                start_msg_index: start,
                end_msg_index: self.flat_msg, // 使用消息总数作为结束索引
            });
        }
        Ok(spans)
    }
}

/// 处理消息行中的 `++`/`--` 激活/停用简写
fn process_inline_activation(
    msg: &SequenceMessage,
    act: &mut ActTracker,
    ln: usize,
) -> Result<(), NativeError> {
    // 先处理停用（在消息发送后）
    if msg.deactivate_source {
        act.deactivate_after_message(&msg.from, ln)?;
    }
    // 再处理激活（在消息发送后）
    if msg.activate_target {
        act.activate_after_message(msg.to.clone());
    }
    Ok(())
}

/// `activate Foo` / `deactivate Foo`（整词关键字 + 单 token id）。
fn try_lifeline_kw_id<'a>(line: &'a str, kw: &str) -> Option<&'a str> {
    let low = line.to_ascii_lowercase();
    if !low.starts_with(kw) {
        return None;
    }
    let tail = line.get(kw.len()..)?;
    let b = tail.as_bytes().first()?;
    if !b.is_ascii_whitespace() {
        return None;
    }
    let rest = tail.trim_start();
    let id = rest.split_whitespace().next()?;
    if id.len() != rest.len() {
        return None;
    }
    valid_id(id).then_some(id)
}

fn try_parse_lifeline_control(
    t: &str,
    ln: usize,
    act: &mut ActTracker,
) -> Result<bool, NativeError> {
    if let Some(id) = try_lifeline_kw_id(t, "activate") {
        act.activate(id.to_string());
        return Ok(true);
    }
    if let Some(id) = try_lifeline_kw_id(t, "deactivate") {
        act.deactivate(id, ln)?;
        return Ok(true);
    }
    Ok(false)
}

/// 整行 `destroy <id>`（单 token id，大小写不敏感关键字）。
fn try_parse_destroy_line(line: &str, line_no: usize) -> Result<Option<String>, NativeError> {
    const KW: &str = "destroy";
    let low = line.to_ascii_lowercase();
    if !low.starts_with(KW) {
        return Ok(None);
    }
    let tail = line
        .get(KW.len()..)
        .ok_or_else(|| parse_err(line_no, "destroy 语法错误"))?;
    if !tail.is_empty() {
        let b = tail.as_bytes().first();
        if let Some(b) = b {
            if !b.is_ascii_whitespace() {
                return Ok(None);
            }
        }
    }
    let id = tail.trim();
    if id.is_empty() {
        return Err(parse_err(line_no, "destroy 后须指定参与者 id"));
    }
    if !valid_id(id) {
        return Err(parse_err(line_no, "destroy 目标须为单 token 参与者名"));
    }
    Ok(Some(id.to_string()))
}

/// 解析 `create ParticipantName` 行
fn try_parse_create_line(line: &str, line_no: usize) -> Result<Option<(String, Option<String>)>, NativeError> {
    const KW: &str = "create";
    let low = line.to_ascii_lowercase();
    if !low.starts_with(KW) {
        return Ok(None);
    }
    let tail = line
        .get(KW.len()..)
        .ok_or_else(|| parse_err(line_no, "create 语法错误"))?;
    if !tail.is_empty() {
        let b = tail.as_bytes().first();
        if let Some(b) = b {
            if !b.is_ascii_whitespace() {
                return Ok(None);
            }
        }
    }
    let rest = tail.trim();
    if rest.is_empty() {
        return Err(parse_err(line_no, "create 后须指定参与者 id"));
    }

    // 支持 create "Display Name" as id 格式
    if rest.starts_with('"') {
        let (display, after_quote) = parse_double_quoted_string(rest, line_no)?;
        let tail = after_quote.trim_start();
        let parts: Vec<&str> = tail.split_whitespace().collect();
        if parts.len() != 2 || !parts[0].eq_ignore_ascii_case("as") {
            return Err(parse_err(
                line_no,
                "create 引号别名后须为 `as id`，如 create \"Display\" as d",
            ));
        }
        let id = parts[1];
        if !valid_id(id) {
            return Err(parse_err(
                line_no,
                "create `as` 后的 id 须为单 token（字母、数字、下划线）",
            ));
        }
        if display.is_empty() {
            return Err(parse_err(line_no, "create 引号别名不能为空"));
        }
        return Ok(Some((id.to_string(), Some(display))));
    }

    // 简单格式：create ParticipantName
    if !valid_id(rest) {
        return Err(parse_err(
            line_no,
            "create 目标须为单 token 参与者名",
        ));
    }
    Ok(Some((rest.to_string(), None)))
}

/// 整行 `...`（≥3 个点）或 `|||`（≥3 个竖线），两端可空白。
/// 解析延迟行：`...` 或 `... text ...` 或 `|||` 或 `||| text |||`
fn try_parse_delay_line(line: &str) -> Option<SequenceDelay> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }

    // 纯点延迟行 ...
    if t.chars().all(|c| c == '.') && t.chars().count() >= 3 {
        return Some(SequenceDelay {
            kind: SequenceDelayKind::Dots,
            text: None,
        });
    }

    // 纯竖线延迟行 |||
    if t.chars().all(|c| c == '|') && t.chars().count() >= 3 {
        return Some(SequenceDelay {
            kind: SequenceDelayKind::Bars,
            text: None,
        });
    }

    // 带文案的点延迟行 ... text ...
    // 格式：至少3个点开头，至少3个点结尾，中间是文案
    let dots_count = t.chars().take_while(|&c| c == '.').count();
    if dots_count >= 3 {
        let rest = &t[dots_count..];
        // 检查是否以 ... 结尾
        let trailing_dots = rest.chars().rev().take_while(|&c| c == '.').count();
        if trailing_dots >= 3 {
            let text_part = &rest[..rest.len() - trailing_dots];
            let text = text_part.trim();
            return Some(SequenceDelay {
                kind: SequenceDelayKind::Dots,
                text: if text.is_empty() { None } else { Some(text.to_string()) },
            });
        }
    }

    // 带文案的竖线延迟行 ||| text |||
    let bars_count = t.chars().take_while(|&c| c == '|').count();
    if bars_count >= 3 {
        let rest = &t[bars_count..];
        // 检查是否以 ||| 结尾
        let trailing_bars = rest.chars().rev().take_while(|&c| c == '|').count();
        if trailing_bars >= 3 {
            let text_part = &rest[..rest.len() - trailing_bars];
            let text = text_part.trim();
            return Some(SequenceDelay {
                kind: SequenceDelayKind::Bars,
                text: if text.is_empty() { None } else { Some(text.to_string()) },
            });
        }
    }

    None
}

/// 解析分割线：`== title ==` 或 `==`（无标题）
fn try_parse_divider_line(line: &str) -> Option<SequenceDivider> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    // 必须以 == 开头
    if !t.starts_with("==") {
        return None;
    }
    // 必须以 == 结尾
    if !t.ends_with("==") {
        return None;
    }
    // 至少需要 4 个字符 "== =="
    if t.len() < 4 {
        return None;
    }
    // 提取中间的标题
    let middle = t[2..t.len()-2].trim();
    let label = if middle.is_empty() {
        None
    } else {
        Some(middle.to_string())
    };
    Some(SequenceDivider { label })
}

/// 解析 `newpage` 或 `newpage title` 分页指令
fn try_parse_newpage_line(line: &str) -> Option<Option<String>> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    // 必须以 newpage 开头（不区分大小写）
    let lower = t.to_ascii_lowercase();
    if !lower.starts_with("newpage") {
        return None;
    }
    // newpage 后必须是空白或结束
    let after = &t[7..]; // "newpage" is 7 chars
    if after.is_empty() {
        return Some(None); // 无标题
    }
    if !after.starts_with(|c: char| c.is_ascii_whitespace()) {
        return None; // 不是有效的 newpage 行（例如 "newpagesomething"）
    }
    // 提取标题
    let title = after.trim().to_string();
    if title.is_empty() {
        Some(None)
    } else {
        Some(Some(title))
    }
}

/// 解析 `ref over Participant : text` 或 `ref over Participant1, Participant2 : text`
fn try_parse_ref_line(line: &str, ln: usize) -> Result<Option<SequenceRef>, NativeError> {
    let t = line.trim();
    if t.is_empty() {
        return Ok(None);
    }

    let lower = t.to_ascii_lowercase();
    if !lower.starts_with("ref over") {
        return Ok(None);
    }

    let rest = &t[8..].trim_start(); // "ref over" is 8 chars
    if rest.is_empty() {
        return Err(parse_err(ln, "ref over 后须指定参与者"));
    }

    // 查找冒号分隔参与者列表和文本
    let (participants_part, text) = if let Some(colon_pos) = rest.find(':') {
        let pp = rest[..colon_pos].trim();
        let txt = rest[colon_pos + 1..].trim().to_string();
        (pp, txt)
    } else {
        return Err(parse_err(ln, "ref over 须使用冒号分隔参与者与文本，如 `ref over A, B : description`"));
    };

    // 解析参与者列表（逗号分隔）
    let participants: Vec<String> = participants_part
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    if participants.is_empty() {
        return Err(parse_err(ln, "ref over 须指定至少一个参与者"));
    }

    // 验证参与者 ID 格式
    for p in &participants {
        if !valid_id(p) {
            return Err(parse_err(ln, format!("非法参与者 id：{p}")));
        }
    }

    Ok(Some(SequenceRef { participants, text }))
}

/// 将 PlantUML 序列图源码解析为 IR。
pub fn parse_sequence_diagram(source: &str) -> Result<SequenceDiagram, NativeError> {
    let lines: Vec<(usize, &str)> = source
        .lines()
        .enumerate()
        .map(|(i, l)| (i + 1, l))
        .collect();

    let mut i = 0usize;
    while i < lines.len() {
        let (ln, raw) = lines[i];
        if let Some(t) = logical_line(raw) {
            if eq_startuml(t) {
                i += 1;
                break;
            }
            return Err(parse_err(
                ln,
                format!(
                    "预期 @startuml（忽略空行与以 ' 开头的注释行），实际为：{}",
                    truncate(t, 60)
                ),
            ));
        }
        i += 1;
    }

    if i > lines.len() {
        return Err(parse_err(lines.len().max(1), "缺少 @startuml".to_string()));
    }

    let mut participants: Vec<SequenceParticipant> = Vec::new();
    let mut body: Vec<SequenceBodyItem> = Vec::new();
    let mut boxes: Vec<ParticipantBox> = Vec::new();
    let mut state = ParseState::Top;
    // 状态栈：用于追踪嵌套fragment的父状态（支持嵌套fragment）
    let mut state_stack: Vec<ParseState> = Vec::new();
    let mut act = ActTracker::default();
    let mut autonumber_start: Option<u32> = None;
    let mut diagram_title: Option<String> = None;
    let mut diagram_page_header: Option<String> = None;
    let mut diagram_page_footer: Option<String> = None;
    let mut diagram_legend: Option<DiagramLegend> = None;

    let mut ended = false;
    while i < lines.len() {
        let (ln, raw) = lines[i];
        i += 1;

        let Some(t) = logical_line(raw) else {
            continue;
        };

        if eq_enduml(t) {
            match &state {
                ParseState::Top => {
                    ended = true;
                    break;
                }
                ParseState::InNote { .. } => {
                    return Err(parse_err(
                        ln,
                        "多行 note 未闭合：须先 `end note` 再 `@enduml`",
                    ));
                }
                ParseState::InTitle { .. } => {
                    return Err(parse_err(
                        ln,
                        "多行 title 未闭合：须先 `end title` 再 `@enduml`",
                    ));
                }
                ParseState::InHeader { .. } => {
                    return Err(parse_err(
                        ln,
                        "多行 header 未闭合：须先 `end header` 再 `@enduml`",
                    ));
                }
                ParseState::InFooter { .. } => {
                    return Err(parse_err(
                        ln,
                        "多行 footer 未闭合：须先 `end footer` 再 `@enduml`",
                    ));
                }
                ParseState::InLegend { .. } => {
                    return Err(parse_err(
                        ln,
                        "多行 legend 未闭合：须先 `end legend` 再 `@enduml`",
                    ));
                }
                ParseState::InBox { .. } => {
                    return Err(parse_err(
                        ln,
                        "多行 box 未闭合：须先 `end box` 再 `@enduml`",
                    ));
                }
                ParseState::InAlt(_)
                | ParseState::InOpt(_)
                | ParseState::InLoop(_)
                | ParseState::InGroup(_)
                | ParseState::InPar(_) => {
                    return Err(parse_err(ln, "fragment 未闭合：须先写 `end` 再 `@enduml`"));
                }
            }
        }

        // 与计划一致：Rust v0 不应用主题，但前端会注入 `!theme`，须跳过以免误判为语法错误。
        let tl = t.to_ascii_lowercase();
        if tl.starts_with("!theme")
            && (tl.len() == 6
                || tl
                    .as_bytes()
                    .get(6)
                    .map_or(false, |b| b.is_ascii_whitespace()))
        {
            continue;
        }

        if rejects_as_non_sequence(t) {
            return Err(parse_err(
                ln,
                "不支持类图/组件等非序列图关键字（Rust 引擎当前仅支持序列图子集）",
            ));
        }

        // 多行 title 正文须在 lifeline/skinparam/autonumber 之前处理。
        if matches!(state, ParseState::InTitle { .. }) {
            let taken = std::mem::replace(&mut state, ParseState::Top);
            match taken {
                ParseState::InTitle { mut lines } => {
                    if is_end_block_line(t, "title") {
                        let merged = lines.join("\n").trim().to_string();
                        if merged.chars().count() > MAX_TITLE_CHARS {
                            return Err(parse_err(
                                ln,
                                format!("标题过长（上限 {MAX_TITLE_CHARS} 字符）"),
                            ));
                        }
                        diagram_title = Some(merged);
                        state = ParseState::Top;
                    } else {
                        lines.push(t.to_string());
                        state = ParseState::InTitle { lines };
                    }
                }
                _ => unreachable!(),
            }
            continue;
        }

        if matches!(state, ParseState::InHeader { .. }) {
            let taken = std::mem::replace(&mut state, ParseState::Top);
            match taken {
                ParseState::InHeader { mut lines } => {
                    if is_end_block_line(t, "header") {
                        let merged = lines.join("\n").trim().to_string();
                        if merged.chars().count() > MAX_TITLE_CHARS {
                            return Err(parse_err(
                                ln,
                                format!("页眉过长（上限 {MAX_TITLE_CHARS} 字符）"),
                            ));
                        }
                        diagram_page_header = Some(merged);
                        state = ParseState::Top;
                    } else {
                        lines.push(t.to_string());
                        state = ParseState::InHeader { lines };
                    }
                }
                _ => unreachable!(),
            }
            continue;
        }

        if matches!(state, ParseState::InFooter { .. }) {
            let taken = std::mem::replace(&mut state, ParseState::Top);
            match taken {
                ParseState::InFooter { mut lines } => {
                    if is_end_block_line(t, "footer") {
                        let merged = lines.join("\n").trim().to_string();
                        if merged.chars().count() > MAX_TITLE_CHARS {
                            return Err(parse_err(
                                ln,
                                format!("页脚过长（上限 {MAX_TITLE_CHARS} 字符）"),
                            ));
                        }
                        diagram_page_footer = Some(merged);
                        state = ParseState::Top;
                    } else {
                        lines.push(t.to_string());
                        state = ParseState::InFooter { lines };
                    }
                }
                _ => unreachable!(),
            }
            continue;
        }

        if matches!(state, ParseState::InLegend { .. }) {
            let taken = std::mem::replace(&mut state, ParseState::Top);
            match taken {
                ParseState::InLegend { align, mut lines } => {
                    if is_end_legend_line(t) {
                        let text = lines.join("\n").trim().to_string();
                        if text.chars().count() > MAX_LEGEND_CHARS {
                            return Err(parse_err(
                                ln,
                                format!("图例过长（上限 {MAX_LEGEND_CHARS} 字符）"),
                            ));
                        }
                        diagram_legend = Some(DiagramLegend { text, align });
                        state = ParseState::Top;
                    } else {
                        lines.push(t.to_string());
                        state = ParseState::InLegend { align, lines };
                    }
                }
                _ => unreachable!(),
            }
            continue;
        }

        // 多行 note 正文须在 lifeline/skinparam/autonumber 之前处理，避免误当指令解析。
        if matches!(state, ParseState::InNote { .. }) {
            let taken = std::mem::replace(&mut state, ParseState::Top);
            match taken {
                ParseState::InNote {
                    placement,
                    mut lines,
                    resume,
                    shape,
                } => {
                    if is_end_note_line(t) {
                        let text = lines.join("\n").trim().to_string();
                        let note = SequenceNote { placement, text, shape };
                        state = *resume;
                        push_note_step(&mut state, &mut body, note);
                    } else {
                        lines.push(t.to_string());
                        state = ParseState::InNote {
                            placement,
                            lines,
                            resume,
                            shape,
                        };
                    }
                }
                _ => unreachable!(),
            }
            continue;
        }

        // 多行 box 参与者收集：`box` / `end box` 之间的参与者声明归入该 box。
        if matches!(state, ParseState::InBox { .. }) {
            let taken = std::mem::replace(&mut state, ParseState::Top);
            match taken {
                ParseState::InBox {
                    title,
                    color,
                    mut participant_ids,
                } => {
                    if is_end_box_line(t) {
                        // 闭合 box，将参与者 ID 和 metadata 存入 IR
                        let pbox = ParticipantBox {
                            title,
                            color,
                            participant_ids,
                        };
                        boxes.push(pbox.clone());
                        body.push(SequenceBodyItem::Box(pbox));
                        state = ParseState::Top;
                    } else {
                        // 尝试解析参与者声明
                        if let Some(res) = try_parse_participant(t, ln)? {
                            let (id, _disp) = res;
                            participant_ids.push(id.clone());
                            ensure_participant(&mut participants, &id, _disp);
                        }
                        // 保持 InBox 状态继续收集
                        state = ParseState::InBox {
                            title,
                            color,
                            participant_ids,
                        };
                    }
                }
                _ => unreachable!(),
            }
            continue;
        }

        if try_parse_lifeline_control(t, ln, &mut act)? {
            continue;
        }
        if try_handle_skinparam(t, ln)? {
            continue;
        }
        if try_handle_autonumber(t, ln, &mut autonumber_start)? {
            continue;
        }

        if matches!(state, ParseState::Top) {
            if let Some(td) = try_parse_kw_block(t, ln, "title", MAX_TITLE_CHARS, "标题")? {
                match td {
                    BlockDirective::Set(text) => {
                        diagram_title = Some(text);
                    }
                    BlockDirective::OpenBlock => {
                        state = ParseState::InTitle { lines: vec![] };
                    }
                }
                continue;
            }
            if let Some(td) = try_parse_kw_block(t, ln, "header", MAX_TITLE_CHARS, "页眉")? {
                match td {
                    BlockDirective::Set(text) => {
                        diagram_page_header = Some(text);
                    }
                    BlockDirective::OpenBlock => {
                        state = ParseState::InHeader { lines: vec![] };
                    }
                }
                continue;
            }
            if let Some(td) = try_parse_kw_block(t, ln, "footer", MAX_TITLE_CHARS, "页脚")? {
                match td {
                    BlockDirective::Set(text) => {
                        diagram_page_footer = Some(text);
                    }
                    BlockDirective::OpenBlock => {
                        state = ParseState::InFooter { lines: vec![] };
                    }
                }
                continue;
            }
            if let Some(align) = try_parse_legend_open(t) {
                state = ParseState::InLegend {
                    align,
                    lines: vec![],
                };
                continue;
            }
            // `box` 仅顶层有效
            if let Some((title, color)) = try_parse_box_open(t) {
                state = ParseState::InBox {
                    title,
                    color,
                    participant_ids: vec![],
                };
                continue;
            }
        } else {
            if try_parse_kw_block(t, ln, "title", MAX_TITLE_CHARS, "标题")?.is_some() {
                return Err(parse_err(
                    ln,
                    "`title` 仅能出现在图顶层（fragment 内不可用）",
                ));
            }
            if try_parse_kw_block(t, ln, "header", MAX_TITLE_CHARS, "页眉")?.is_some() {
                return Err(parse_err(
                    ln,
                    "`header` 仅能出现在图顶层（fragment 内不可用）",
                ));
            }
            if try_parse_kw_block(t, ln, "footer", MAX_TITLE_CHARS, "页脚")?.is_some() {
                return Err(parse_err(
                    ln,
                    "`footer` 仅能出现在图顶层（fragment 内不可用）",
                ));
            }
            if try_parse_legend_open(t).is_some() {
                return Err(parse_err(
                    ln,
                    "`legend` 仅能出现在图顶层（fragment 内不可用）",
                ));
            }
            if try_parse_box_open(t).is_some() {
                return Err(parse_err(
                    ln,
                    "`box` 仅能出现在图顶层（fragment 内不可用）",
                ));
            }
        }

        if let Some(ns) = parse_note_line(t, ln)? {
            ensure_participants_for_note_start(&ns, &mut participants);
            match ns {
                NoteStart::Single(note) => {
                    match &mut state {
                        ParseState::Top => {
                            body.push(SequenceBodyItem::Note(note));
                        }
                        ParseState::InAlt(a) | ParseState::InPar(a) => {
                            a.cur_body.push(SequenceBodyItem::Note(note));
                        }
                        ParseState::InOpt(o) | ParseState::InLoop(o) | ParseState::InGroup(o) => {
                            o.body.push(SequenceBodyItem::Note(note));
                        }
                        ParseState::InBox { .. } => {
                            // box 内不支持 note（静默跳过）
                        }
                        ParseState::InNote { .. } => {
                            unreachable!("InNote handled before note 单行解析");
                        }
                        ParseState::InTitle { .. } => {
                            unreachable!("InTitle handled before note 解析");
                        }
                        ParseState::InLegend { .. } => {
                            unreachable!("InLegend handled before note 解析");
                        }
                        ParseState::InHeader { .. } => {
                            unreachable!("InHeader handled before note 解析");
                        }
                        ParseState::InFooter { .. } => {
                            unreachable!("InFooter handled before note 解析");
                        }
                    }
                    continue;
                }
                NoteStart::Multi(placement, shape) => {
                    let resume = std::mem::replace(&mut state, ParseState::Top);
                    state = ParseState::InNote {
                        placement,
                        lines: vec![],
                        resume: Box::new(resume),
                        shape,
                    };
                    continue;
                }
            }
        }

        if let Some((id, display)) = try_parse_create_line(t, ln)? {
            // 添加参与者，并标记为创建的
            ensure_participant(&mut participants, &id, display.clone());
            // 标记参与者为已创建
            if let Some(p) = participants.iter_mut().find(|p| p.id == id) {
                p.is_created = true;
            }
            push_create_step(&mut state, &mut body, id);
            continue;
        }

        if let Some(pid) = try_parse_destroy_line(t, ln)? {
            ensure_participant(&mut participants, &pid, None);
            act.deactivate_all_for(&pid);
            push_destroy_step(&mut state, &mut body, pid);
            continue;
        }

        if let Some(kind) = try_parse_delay_line(t) {
            push_delay_step(&mut state, &mut body, kind);
            continue;
        }

        if let Some(divider) = try_parse_divider_line(t) {
            push_divider_step(&mut state, &mut body, divider);
            continue;
        }

        if let Some(ref_item) = try_parse_ref_line(t, ln)? {
            // 确保参与者存在
            for p in &ref_item.participants {
                ensure_participant(&mut participants, p, None);
            }
            push_ref_step(&mut state, &mut body, ref_item);
            continue;
        }

        if let Some(title) = try_parse_newpage_line(t) {
            push_newpage_step(&mut state, &mut body, title);
            continue;
        }

        match &mut state {
            ParseState::Top => {
                if is_standalone_end(t) {
                    return Err(parse_err(
                        ln,
                        "多余的 `end`（无匹配的 alt/opt/loop/par/group）",
                    ));
                }
                if let Some(alt_label) = try_alt_header(t) {
                    state = ParseState::InAlt(AltParse {
                        sections: vec![],
                        cur_label: alt_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if let Some(label) = try_opt_header(t) {
                    state = ParseState::InOpt(OptParse {
                        label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(label) = try_loop_header(t) {
                    state = ParseState::InLoop(OptParse {
                        label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(label) = try_group_header(t) {
                    state = ParseState::InGroup(OptParse {
                        label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(par_label) = try_par_header(t) {
                    state = ParseState::InPar(AltParse {
                        sections: vec![],
                        cur_label: par_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if try_else_header(t).is_some() {
                    return Err(parse_err(ln, "`else` 仅能出现在 `alt` / `par` 块内"));
                }
                if try_and_header(t).is_some() {
                    return Err(parse_err(ln, "`and` 仅能出现在 `par` 块内"));
                }
                if contains_arrow(t) {
                    let msg = parse_message_line(t, ln)?;
                    ensure_participant(&mut participants, &msg.from, None);
                    ensure_participant(&mut participants, &msg.to, None);
                    body.push(SequenceBodyItem::Message(msg.clone()));
                    act.on_push_message();
                    process_inline_activation(&msg, &mut act, ln)?;
                    continue;
                }
                if let Some(res) = try_parse_participant(t, ln)? {
                    let (id, disp) = res;
                    ensure_participant(&mut participants, &id, disp);
                    continue;
                }
                let _ = ln;
                continue;
            }
            ParseState::InAlt(a) => {
                // 支持嵌套：检测新的fragment关键字
                if let Some(alt_label) = try_alt_header(t) {
                    // 压栈当前状态，进入嵌套alt
                    state_stack.push(ParseState::InAlt(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    *a = AltParse {
                        sections: vec![],
                        cur_label: alt_label,
                        cur_body: vec![],
                    };
                    continue;
                }
                if let Some(opt_label) = try_opt_header(t) {
                    // 压栈当前状态，进入嵌套opt
                    state_stack.push(ParseState::InAlt(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InOpt(OptParse {
                        label: opt_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(loop_label) = try_loop_header(t) {
                    // 压栈当前状态，进入嵌套loop
                    state_stack.push(ParseState::InAlt(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InLoop(OptParse {
                        label: loop_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(group_label) = try_group_header(t) {
                    // 压栈当前状态，进入嵌套group
                    state_stack.push(ParseState::InAlt(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InGroup(OptParse {
                        label: group_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(par_label) = try_par_header(t) {
                    // 压栈当前状态，进入嵌套par
                    state_stack.push(ParseState::InAlt(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InPar(AltParse {
                        sections: vec![],
                        cur_label: par_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if try_and_header(t).is_some() {
                    return Err(parse_err(ln, "`and` 仅允许出现在 par 块内"));
                }
                if try_parse_box_open(t).is_some() {
                    return Err(parse_err(ln, "`box` 仅能出现在图顶层（fragment 内不可用）"));
                }
                if is_standalone_end(t) {
                    a.sections.push(AltSection {
                        label: std::mem::take(&mut a.cur_label),
                        body: std::mem::take(&mut a.cur_body),
                    });
                    let sections = std::mem::take(&mut a.sections);
                    let item = SequenceBodyItem::Alt { sections };

                    // 检查状态栈，如果有父状态则恢复
                    if let Some(parent_state) = state_stack.pop() {
                        // 将完成的fragment添加到父状态的body中
                        match parent_state {
                            ParseState::InAlt(mut parent_alt) => {
                                parent_alt.cur_body.push(item);
                                state = ParseState::InAlt(parent_alt);
                            }
                            ParseState::InOpt(mut parent_opt) => {
                                parent_opt.body.push(item);
                                state = ParseState::InOpt(parent_opt);
                            }
                            ParseState::InLoop(mut parent_loop) => {
                                parent_loop.body.push(item);
                                state = ParseState::InLoop(parent_loop);
                            }
                            ParseState::InGroup(mut parent_group) => {
                                parent_group.body.push(item);
                                state = ParseState::InGroup(parent_group);
                            }
                            ParseState::InPar(mut parent_par) => {
                                parent_par.cur_body.push(item);
                                state = ParseState::InPar(parent_par);
                            }
                            ParseState::Top | ParseState::InBox { .. } |
                            ParseState::InNote { .. } | ParseState::InTitle { .. } |
                            ParseState::InHeader { .. } | ParseState::InFooter { .. } |
                            ParseState::InLegend { .. } => {
                                body.push(item);
                                state = ParseState::Top;
                            }
                        }
                    } else {
                        body.push(item);
                        state = ParseState::Top;
                    }
                    continue;
                }
                if let Some(next_label) = try_else_header(t) {
                    a.sections.push(AltSection {
                        label: std::mem::take(&mut a.cur_label),
                        body: std::mem::take(&mut a.cur_body),
                    });
                    a.cur_label = next_label;
                    continue;
                }
                if contains_arrow(t) {
                    let msg = parse_message_line(t, ln)?;
                    ensure_participant(&mut participants, &msg.from, None);
                    ensure_participant(&mut participants, &msg.to, None);
                    a.cur_body.push(SequenceBodyItem::Message(msg));
                    act.on_push_message();
                    continue;
                }
                if let Some(res) = try_parse_participant(t, ln)? {
                    let (id, disp) = res;
                    ensure_participant(&mut participants, &id, disp);
                    continue;
                }
                let _ = ln;
                continue;
            }
            ParseState::InOpt(o) => {
                // 支持嵌套：检测新的fragment关键字
                if let Some(alt_label) = try_alt_header(t) {
                    state_stack.push(ParseState::InOpt(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InAlt(AltParse {
                        sections: vec![],
                        cur_label: alt_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if let Some(opt_label) = try_opt_header(t) {
                    state_stack.push(ParseState::InOpt(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InOpt(OptParse {
                        label: opt_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(loop_label) = try_loop_header(t) {
                    state_stack.push(ParseState::InOpt(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InLoop(OptParse {
                        label: loop_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(group_label) = try_group_header(t) {
                    state_stack.push(ParseState::InOpt(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InGroup(OptParse {
                        label: group_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(par_label) = try_par_header(t) {
                    state_stack.push(ParseState::InOpt(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InPar(AltParse {
                        sections: vec![],
                        cur_label: par_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if try_and_header(t).is_some() {
                    return Err(parse_err(ln, "`and` 仅允许出现在 par 块内"));
                }
                if try_parse_box_open(t).is_some() {
                    return Err(parse_err(ln, "`box` 仅能出现在图顶层（fragment 内不可用）"));
                }
                if try_else_header(t).is_some() {
                    return Err(parse_err(
                        ln,
                        "`opt` / `loop` / `group` 块内不能使用 `else`",
                    ));
                }
                if is_standalone_end(t) {
                    let label = std::mem::take(&mut o.label);
                    let inner_body = std::mem::take(&mut o.body);
                    let item = SequenceBodyItem::Opt { label, body: inner_body };

                    // 检查状态栈，如果有父状态则恢复
                    if let Some(parent_state) = state_stack.pop() {
                        match parent_state {
                            ParseState::InAlt(mut parent_alt) => {
                                parent_alt.cur_body.push(item);
                                state = ParseState::InAlt(parent_alt);
                            }
                            ParseState::InOpt(mut parent_opt) => {
                                parent_opt.body.push(item);
                                state = ParseState::InOpt(parent_opt);
                            }
                            ParseState::InLoop(mut parent_loop) => {
                                parent_loop.body.push(item);
                                state = ParseState::InLoop(parent_loop);
                            }
                            ParseState::InGroup(mut parent_group) => {
                                parent_group.body.push(item);
                                state = ParseState::InGroup(parent_group);
                            }
                            ParseState::InPar(mut parent_par) => {
                                parent_par.cur_body.push(item);
                                state = ParseState::InPar(parent_par);
                            }
                            ParseState::Top | ParseState::InBox { .. } |
                            ParseState::InNote { .. } | ParseState::InTitle { .. } |
                            ParseState::InHeader { .. } | ParseState::InFooter { .. } |
                            ParseState::InLegend { .. } => {
                                body.push(item);
                                state = ParseState::Top;
                            }
                        }
                    } else {
                        body.push(item);
                        state = ParseState::Top;
                    }
                    continue;
                }
                if contains_arrow(t) {
                    let msg = parse_message_line(t, ln)?;
                    ensure_participant(&mut participants, &msg.from, None);
                    ensure_participant(&mut participants, &msg.to, None);
                    o.body.push(SequenceBodyItem::Message(msg));
                    act.on_push_message();
                    continue;
                }
                if let Some(res) = try_parse_participant(t, ln)? {
                    let (id, disp) = res;
                    ensure_participant(&mut participants, &id, disp);
                    continue;
                }
                let _ = ln;
                continue;
            }
            ParseState::InLoop(o) => {
                // 支持嵌套：检测新的fragment关键字
                if let Some(alt_label) = try_alt_header(t) {
                    state_stack.push(ParseState::InLoop(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InAlt(AltParse {
                        sections: vec![],
                        cur_label: alt_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if let Some(opt_label) = try_opt_header(t) {
                    state_stack.push(ParseState::InLoop(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InOpt(OptParse {
                        label: opt_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(loop_label) = try_loop_header(t) {
                    state_stack.push(ParseState::InLoop(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InLoop(OptParse {
                        label: loop_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(group_label) = try_group_header(t) {
                    state_stack.push(ParseState::InLoop(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InGroup(OptParse {
                        label: group_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(par_label) = try_par_header(t) {
                    state_stack.push(ParseState::InLoop(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InPar(AltParse {
                        sections: vec![],
                        cur_label: par_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if try_and_header(t).is_some() {
                    return Err(parse_err(ln, "`and` 仅允许出现在 par 块内"));
                }
                if try_parse_box_open(t).is_some() {
                    return Err(parse_err(ln, "`box` 仅能出现在图顶层（fragment 内不可用）"));
                }
                if try_else_header(t).is_some() {
                    return Err(parse_err(ln, "`loop` / `group` 块内不能使用 `else`"));
                }
                if is_standalone_end(t) {
                    let label = std::mem::take(&mut o.label);
                    let inner_body = std::mem::take(&mut o.body);
                    let item = SequenceBodyItem::Loop { label, body: inner_body };

                    // 检查状态栈，如果有父状态则恢复
                    if let Some(parent_state) = state_stack.pop() {
                        match parent_state {
                            ParseState::InAlt(mut parent_alt) => {
                                parent_alt.cur_body.push(item);
                                state = ParseState::InAlt(parent_alt);
                            }
                            ParseState::InOpt(mut parent_opt) => {
                                parent_opt.body.push(item);
                                state = ParseState::InOpt(parent_opt);
                            }
                            ParseState::InLoop(mut parent_loop) => {
                                parent_loop.body.push(item);
                                state = ParseState::InLoop(parent_loop);
                            }
                            ParseState::InGroup(mut parent_group) => {
                                parent_group.body.push(item);
                                state = ParseState::InGroup(parent_group);
                            }
                            ParseState::InPar(mut parent_par) => {
                                parent_par.cur_body.push(item);
                                state = ParseState::InPar(parent_par);
                            }
                            ParseState::Top | ParseState::InBox { .. } |
                            ParseState::InNote { .. } | ParseState::InTitle { .. } |
                            ParseState::InHeader { .. } | ParseState::InFooter { .. } |
                            ParseState::InLegend { .. } => {
                                body.push(item);
                                state = ParseState::Top;
                            }
                        }
                    } else {
                        body.push(item);
                        state = ParseState::Top;
                    }
                    continue;
                }
                if contains_arrow(t) {
                    let msg = parse_message_line(t, ln)?;
                    ensure_participant(&mut participants, &msg.from, None);
                    ensure_participant(&mut participants, &msg.to, None);
                    o.body.push(SequenceBodyItem::Message(msg));
                    act.on_push_message();
                    continue;
                }
                if let Some(res) = try_parse_participant(t, ln)? {
                    let (id, disp) = res;
                    ensure_participant(&mut participants, &id, disp);
                    continue;
                }
                let _ = ln;
                continue;
            }
            ParseState::InGroup(o) => {
                // 支持嵌套：检测新的fragment关键字
                if let Some(alt_label) = try_alt_header(t) {
                    state_stack.push(ParseState::InGroup(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InAlt(AltParse {
                        sections: vec![],
                        cur_label: alt_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if let Some(opt_label) = try_opt_header(t) {
                    state_stack.push(ParseState::InGroup(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InOpt(OptParse {
                        label: opt_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(loop_label) = try_loop_header(t) {
                    state_stack.push(ParseState::InGroup(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InLoop(OptParse {
                        label: loop_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(group_label) = try_group_header(t) {
                    state_stack.push(ParseState::InGroup(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InGroup(OptParse {
                        label: group_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(par_label) = try_par_header(t) {
                    state_stack.push(ParseState::InGroup(std::mem::replace(
                        o,
                        OptParse {
                            label: String::new(),
                            body: vec![],
                        },
                    )));
                    state = ParseState::InPar(AltParse {
                        sections: vec![],
                        cur_label: par_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if try_and_header(t).is_some() {
                    return Err(parse_err(ln, "`and` 仅允许出现在 par 块内"));
                }
                if try_parse_box_open(t).is_some() {
                    return Err(parse_err(ln, "`box` 仅能出现在图顶层（fragment 内不可用）"));
                }
                if try_else_header(t).is_some() {
                    return Err(parse_err(ln, "`group` 块内不能使用 `else`"));
                }
                if is_standalone_end(t) {
                    let label = std::mem::take(&mut o.label);
                    let inner_body = std::mem::take(&mut o.body);
                    let item = SequenceBodyItem::Group { label, body: inner_body };

                    // 检查状态栈，如果有父状态则恢复
                    if let Some(parent_state) = state_stack.pop() {
                        match parent_state {
                            ParseState::InAlt(mut parent_alt) => {
                                parent_alt.cur_body.push(item);
                                state = ParseState::InAlt(parent_alt);
                            }
                            ParseState::InOpt(mut parent_opt) => {
                                parent_opt.body.push(item);
                                state = ParseState::InOpt(parent_opt);
                            }
                            ParseState::InLoop(mut parent_loop) => {
                                parent_loop.body.push(item);
                                state = ParseState::InLoop(parent_loop);
                            }
                            ParseState::InGroup(mut parent_group) => {
                                parent_group.body.push(item);
                                state = ParseState::InGroup(parent_group);
                            }
                            ParseState::InPar(mut parent_par) => {
                                parent_par.cur_body.push(item);
                                state = ParseState::InPar(parent_par);
                            }
                            ParseState::Top | ParseState::InBox { .. } |
                            ParseState::InNote { .. } | ParseState::InTitle { .. } |
                            ParseState::InHeader { .. } | ParseState::InFooter { .. } |
                            ParseState::InLegend { .. } => {
                                body.push(item);
                                state = ParseState::Top;
                            }
                        }
                    } else {
                        body.push(item);
                        state = ParseState::Top;
                    }
                    continue;
                }
                if contains_arrow(t) {
                    let msg = parse_message_line(t, ln)?;
                    ensure_participant(&mut participants, &msg.from, None);
                    ensure_participant(&mut participants, &msg.to, None);
                    o.body.push(SequenceBodyItem::Message(msg));
                    act.on_push_message();
                    continue;
                }
                if let Some(res) = try_parse_participant(t, ln)? {
                    let (id, disp) = res;
                    ensure_participant(&mut participants, &id, disp);
                    continue;
                }
                let _ = ln;
                continue;
            }
            ParseState::InPar(a) => {
                // 支持嵌套：检测新的fragment关键字
                if let Some(alt_label) = try_alt_header(t) {
                    state_stack.push(ParseState::InPar(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InAlt(AltParse {
                        sections: vec![],
                        cur_label: alt_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if let Some(opt_label) = try_opt_header(t) {
                    state_stack.push(ParseState::InPar(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InOpt(OptParse {
                        label: opt_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(loop_label) = try_loop_header(t) {
                    state_stack.push(ParseState::InPar(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InLoop(OptParse {
                        label: loop_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(group_label) = try_group_header(t) {
                    state_stack.push(ParseState::InPar(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InGroup(OptParse {
                        label: group_label,
                        body: vec![],
                    });
                    continue;
                }
                if let Some(par_label) = try_par_header(t) {
                    state_stack.push(ParseState::InPar(std::mem::replace(
                        a,
                        AltParse {
                            sections: vec![],
                            cur_label: String::new(),
                            cur_body: vec![],
                        },
                    )));
                    state = ParseState::InPar(AltParse {
                        sections: vec![],
                        cur_label: par_label,
                        cur_body: vec![],
                    });
                    continue;
                }
                if try_parse_box_open(t).is_some() {
                    return Err(parse_err(ln, "`box` 仅能出现在图顶层（fragment 内不可用）"));
                }
                if is_standalone_end(t) {
                    a.sections.push(AltSection {
                        label: std::mem::take(&mut a.cur_label),
                        body: std::mem::take(&mut a.cur_body),
                    });
                    let sections = std::mem::take(&mut a.sections);
                    let item = SequenceBodyItem::Par { sections };

                    // 检查状态栈，如果有父状态则恢复
                    if let Some(parent_state) = state_stack.pop() {
                        match parent_state {
                            ParseState::InAlt(mut parent_alt) => {
                                parent_alt.cur_body.push(item);
                                state = ParseState::InAlt(parent_alt);
                            }
                            ParseState::InOpt(mut parent_opt) => {
                                parent_opt.body.push(item);
                                state = ParseState::InOpt(parent_opt);
                            }
                            ParseState::InLoop(mut parent_loop) => {
                                parent_loop.body.push(item);
                                state = ParseState::InLoop(parent_loop);
                            }
                            ParseState::InGroup(mut parent_group) => {
                                parent_group.body.push(item);
                                state = ParseState::InGroup(parent_group);
                            }
                            ParseState::InPar(mut parent_par) => {
                                parent_par.cur_body.push(item);
                                state = ParseState::InPar(parent_par);
                            }
                            ParseState::Top | ParseState::InBox { .. } |
                            ParseState::InNote { .. } | ParseState::InTitle { .. } |
                            ParseState::InHeader { .. } | ParseState::InFooter { .. } |
                            ParseState::InLegend { .. } => {
                                body.push(item);
                                state = ParseState::Top;
                            }
                        }
                    } else {
                        body.push(item);
                        state = ParseState::Top;
                    }
                    continue;
                }
                if let Some(next_label) = try_else_header(t).or_else(|| try_and_header(t)) {
                    a.sections.push(AltSection {
                        label: std::mem::take(&mut a.cur_label),
                        body: std::mem::take(&mut a.cur_body),
                    });
                    a.cur_label = next_label;
                    continue;
                }
                if contains_arrow(t) {
                    let msg = parse_message_line(t, ln)?;
                    ensure_participant(&mut participants, &msg.from, None);
                    ensure_participant(&mut participants, &msg.to, None);
                    a.cur_body.push(SequenceBodyItem::Message(msg));
                    act.on_push_message();
                    continue;
                }
                if let Some(res) = try_parse_participant(t, ln)? {
                    let (id, disp) = res;
                    ensure_participant(&mut participants, &id, disp);
                    continue;
                }
                let _ = ln;
                continue;
            }
            ParseState::InNote { .. } => unreachable!("InNote handled before match"),
            ParseState::InTitle { .. } => unreachable!("InTitle handled before match"),
            ParseState::InHeader { .. } => unreachable!("InHeader handled before match"),
            ParseState::InFooter { .. } => unreachable!("InFooter handled before match"),
            ParseState::InLegend { .. } => unreachable!("InLegend handled before match"),
            ParseState::InBox { .. } => unreachable!("InBox handled before match"),
        }
    }

    if matches!(state, ParseState::InTitle { .. }) {
        return Err(parse_err(
            lines.len().max(1),
            "多行 title 未闭合：缺少 `end title`",
        ));
    }

    if matches!(state, ParseState::InLegend { .. }) {
        return Err(parse_err(
            lines.len().max(1),
            "多行 legend 未闭合：缺少 `end legend`",
        ));
    }

    if matches!(state, ParseState::InHeader { .. }) {
        return Err(parse_err(
            lines.len().max(1),
            "多行 header 未闭合：缺少 `end header`",
        ));
    }

    if matches!(state, ParseState::InFooter { .. }) {
        return Err(parse_err(
            lines.len().max(1),
            "多行 footer 未闭合：缺少 `end footer`",
        ));
    }

    if !matches!(state, ParseState::Top) {
        return Err(parse_err(lines.len().max(1), "缺少 `end`：fragment 未闭合"));
    }

    if !ended {
        return Err(parse_err(lines.len().max(1), "缺少 @enduml".to_string()));
    }

    let activation_spans = act.finish(lines.len().max(1))?;

    Ok(SequenceDiagram {
        title: diagram_title,
        page_header: diagram_page_header,
        page_footer: diagram_page_footer,
        legend: diagram_legend,
        participants,
        boxes,
        body,
        activation_spans,
        autonumber_start,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_ok(src: &str) -> SequenceDiagram {
        parse_sequence_diagram(src).expect("parse")
    }

    #[test]
    fn minimal_participant_and_solid_arrow() {
        let ir = parse_ok(
            "@startuml\nparticipant Alice\nparticipant Bob\nAlice -> Bob : hello\n@enduml",
        );
        assert_eq!(
            ir.participants,
            vec![
                SequenceParticipant::id_only("Alice"),
                SequenceParticipant::id_only("Bob")
            ]
        );
        let msgs = ir.all_messages();
        assert_eq!(msgs.len(), 1);
        let m = msgs[0];
        assert_eq!(m.from, "Alice");
        assert_eq!(m.to, "Bob");
        assert_eq!(m.label, "hello");
        assert_eq!(m.arrow, MessageArrow::Solid);
    }

    #[test]
    fn dashed_arrow() {
        let ir = parse_ok("@startuml\nA --> B : async\n@enduml");
        assert_eq!(ir.all_messages()[0].arrow, MessageArrow::Dashed);
    }

    #[test]
    fn async_arrow_solid() {
        let ir = parse_ok("@startuml\nA ->> B : rpc\n@enduml");
        assert_eq!(ir.all_messages()[0].arrow, MessageArrow::AsyncSolid);
    }

    #[test]
    fn async_arrow_dashed() {
        let ir = parse_ok("@startuml\nA -->> B : async\n@enduml");
        assert_eq!(ir.all_messages()[0].arrow, MessageArrow::AsyncDashed);
    }

    #[test]
    fn reverse_arrow_solid() {
        // Bob <- Alice 等价于 Alice -> Bob
        let ir = parse_ok("@startuml\nBob <- Alice : hi\n@enduml");
        let msg = ir.all_messages()[0];
        assert_eq!(msg.from, "Alice");
        assert_eq!(msg.to, "Bob");
        assert_eq!(msg.label, "hi");
        assert_eq!(msg.arrow, MessageArrow::Solid);
    }

    #[test]
    fn reverse_arrow_dashed() {
        // Bob <-- Alice 等价于 Alice --> Bob
        let ir = parse_ok("@startuml\nBob <-- Alice : return\n@enduml");
        let msg = ir.all_messages()[0];
        assert_eq!(msg.from, "Alice");
        assert_eq!(msg.to, "Bob");
        assert_eq!(msg.label, "return");
        assert_eq!(msg.arrow, MessageArrow::Dashed);
    }

    #[test]
    fn reverse_arrow_async_solid() {
        // Bob <<- Alice 等价于 Alice ->> Bob
        let ir = parse_ok("@startuml\nBob <<- Alice : async\n@enduml");
        let msg = ir.all_messages()[0];
        assert_eq!(msg.from, "Alice");
        assert_eq!(msg.to, "Bob");
        assert_eq!(msg.label, "async");
        assert_eq!(msg.arrow, MessageArrow::AsyncSolid);
    }

    #[test]
    fn reverse_arrow_async_dashed() {
        // Bob <<-- Alice 等价于 Alice -->> Bob
        let ir = parse_ok("@startuml\nBob <<-- Alice : async dashed\n@enduml");
        let msg = ir.all_messages()[0];
        assert_eq!(msg.from, "Alice");
        assert_eq!(msg.to, "Bob");
        assert_eq!(msg.label, "async dashed");
        assert_eq!(msg.arrow, MessageArrow::AsyncDashed);
    }

    #[test]
    fn implicit_participants_from_messages() {
        let ir = parse_ok("@startuml\nX -> Y :\n@enduml");
        assert_eq!(
            ir.participants,
            vec![
                SequenceParticipant::id_only("X"),
                SequenceParticipant::id_only("Y")
            ]
        );
        assert!(ir.all_messages()[0].label.is_empty());
    }

    #[test]
    fn actor_keyword() {
        let ir = parse_ok("@startuml\nactor User\nUser -> System : login\n@enduml");
        assert!(ir.participants.iter().any(|p| p.id == "User"));
        assert!(ir.participants.iter().any(|p| p.id == "System"));
    }

    #[test]
    fn boundary_keyword() {
        let ir = parse_ok("@startuml\nboundary UI\nUI -> Server : request\n@enduml");
        assert!(ir.participants.iter().any(|p| p.id == "UI"));
        assert!(ir.participants.iter().any(|p| p.id == "Server"));
    }

    #[test]
    fn control_keyword() {
        let ir = parse_ok("@startuml\ncontrol Controller\nController -> Model : update\n@enduml");
        assert!(ir.participants.iter().any(|p| p.id == "Controller"));
    }

    #[test]
    fn entity_keyword() {
        let ir = parse_ok("@startuml\nentity User\nUser -> Database : query\n@enduml");
        assert!(ir.participants.iter().any(|p| p.id == "User"));
    }

    #[test]
    fn database_keyword() {
        let ir = parse_ok("@startuml\ndatabase DB\nApp -> DB : save\n@enduml");
        assert!(ir.participants.iter().any(|p| p.id == "DB"));
    }

    #[test]
    fn collections_keyword() {
        let ir = parse_ok("@startuml\ncollections Items\nItems -> List : add\n@enduml");
        assert!(ir.participants.iter().any(|p| p.id == "Items"));
    }

    #[test]
    fn class_keyword_errors_with_line() {
        let err = parse_sequence_diagram("@startuml\nclass Foo\n@enduml").unwrap_err();
        match err {
            NativeError::Parse { line, detail } => {
                assert_eq!(line, 2);
                assert!(detail.contains("序列图"), "{detail}");
            }
            e => panic!("unexpected {e:?}"),
        }
    }

    /// 回归：`rejects_as_non_sequence` 曾用 `line[..kw.len()]`，`abstract`(8 字节) 与 `title 接口…` 组合会在 UTF-8 边界外切片 panic。
    #[test]
    fn title_with_cjk_after_skinparam_does_not_panic() {
        let src = concat!(
            "@startuml\n",
            "skinparam defaultFontName \"Microsoft YaHei\"\n",
            "title 接口调用序列图\n",
            "@enduml"
        );
        let ir = parse_ok(src);
        assert_eq!(ir.title.as_deref(), Some("接口调用序列图"));
    }

    #[test]
    fn quoted_participant_as_id() {
        let ir = parse_ok("@startuml\nparticipant \"Display\" as d\nd -> d : self\n@enduml");
        assert_eq!(ir.participants.len(), 1);
        assert_eq!(ir.participants[0].id, "d");
        assert_eq!(ir.participants[0].display.as_deref(), Some("Display"));
        assert_eq!(ir.all_messages().len(), 1);
    }

    #[test]
    fn actor_quoted_as_id() {
        let ir = parse_ok("@startuml\nactor \"End User\" as U\nU -> S : hi\n@enduml");
        let u = ir.participants.iter().find(|p| p.id == "U").unwrap();
        assert_eq!(u.display.as_deref(), Some("End User"));
        assert!(ir.participants.iter().any(|p| p.id == "S"));
    }

    #[test]
    fn quoted_display_allows_escape_quote() {
        let src = concat!(
            "@startuml\nparticipant \"Say \\\"Hi\\\"\" as x\n",
            "x -> x : ok\n@enduml"
        );
        let ir = parse_ok(src);
        assert_eq!(ir.participants[0].display.as_deref(), Some("Say \"Hi\""));
    }

    #[test]
    fn quoted_participant_requires_as() {
        let err = parse_sequence_diagram("@startuml\nparticipant \"Only\"\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn quoted_string_unclosed_errors() {
        let err =
            parse_sequence_diagram("@startuml\nparticipant \"oops as x\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn unknown_extras_skipped_message_still_parsed() {
        let ir = parse_ok(
            "@startuml\nskinparam monochrome true\nalt z\nAlice -> Bob : ok\nend\n@enduml",
        );
        assert_eq!(ir.all_messages().len(), 1);
        assert_eq!(ir.all_messages()[0].label, "ok");
        assert!(matches!(
            ir.body[0],
            SequenceBodyItem::Alt { ref sections } if sections.len() == 1 && sections[0].label == "z"
        ));
    }

    #[test]
    fn alt_with_else_two_branches() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "alt success\n",
            "A -> B : ok\n",
            "else fail\n",
            "A -> B : err\n",
            "end\n",
            "@enduml"
        ));
        assert_eq!(ir.all_messages().len(), 2);
        let alt = match &ir.body[0] {
            SequenceBodyItem::Alt { sections } => sections,
            _ => panic!("expected alt"),
        };
        assert_eq!(alt.len(), 2);
        assert_eq!(alt[0].label, "success");
        assert_eq!(alt[0].body.len(), 1);
        assert_eq!(alt[1].label, "fail");
        let SequenceBodyItem::Message(m) = &alt[1].body[0] else {
            panic!("expected message");
        };
        assert_eq!(m.label, "err");
    }

    #[test]
    fn opt_block_single_section() {
        let ir = parse_ok("@startuml\nopt maybe\nX -> Y : z\nend\n@enduml");
        assert_eq!(ir.all_messages().len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Opt { label, body } => {
                assert_eq!(label, "maybe");
                assert_eq!(body.len(), 1);
            }
            _ => panic!("expected opt"),
        }
    }

    #[test]
    fn nested_alt_parses_as_inner_messages() {
        // 嵌套 fragment 支持：在 alt 内可以嵌套另一个 alt
        let src = concat!(
            "@startuml\n",
            "alt outer\n",
            "A -> B : m1\n",
            "alt inner\n",
            "C -> D : m2\n",
            "end\n",
            "end\n",
            "@enduml"
        );
        // 现在支持嵌套：内层 alt 会成为外层 alt body 的一部分
        let ir = parse_sequence_diagram(src).expect("nested alt should parse");
        assert_eq!(ir.all_messages().len(), 2);

        // 验证嵌套结构
        match &ir.body[0] {
            SequenceBodyItem::Alt { sections } => {
                assert_eq!(sections.len(), 1);
                assert_eq!(sections[0].label, "outer");
                assert_eq!(sections[0].body.len(), 2); // m1 + inner alt

                // 第一个元素是消息
                match &sections[0].body[0] {
                    SequenceBodyItem::Message(m) => {
                        assert_eq!(m.label, "m1");
                    }
                    _ => panic!("expected message"),
                }

                // 第二个元素是嵌套的 alt
                match &sections[0].body[1] {
                    SequenceBodyItem::Alt { sections: inner_sections } => {
                        assert_eq!(inner_sections.len(), 1);
                        assert_eq!(inner_sections[0].label, "inner");
                        assert_eq!(inner_sections[0].body.len(), 1); // m2

                        match &inner_sections[0].body[0] {
                            SequenceBodyItem::Message(m) => {
                                assert_eq!(m.label, "m2");
                            }
                            _ => panic!("expected message in nested alt"),
                        }
                    }
                    _ => panic!("expected nested alt"),
                }
            }
            _ => panic!("expected alt"),
        }
    }

    #[test]
    fn stray_end_rejected() {
        let err = parse_sequence_diagram("@startuml\nend\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn nested_opt_inside_alt() {
        // 在 alt 内嵌套 opt
        let src = concat!(
            "@startuml\n",
            "alt outer\n",
            "A -> B : m1\n",
            "opt maybe\n",
            "C -> D : m2\n",
            "end\n",
            "end\n",
            "@enduml"
        );
        let ir = parse_sequence_diagram(src).expect("nested opt in alt should parse");
        assert_eq!(ir.all_messages().len(), 2);

        match &ir.body[0] {
            SequenceBodyItem::Alt { sections } => {
                assert_eq!(sections[0].body.len(), 2);
                match &sections[0].body[1] {
                    SequenceBodyItem::Opt { label, body } => {
                        assert_eq!(label, "maybe");
                        assert_eq!(body.len(), 1);
                    }
                    _ => panic!("expected nested opt"),
                }
            }
            _ => panic!("expected alt"),
        }
    }

    #[test]
    fn nested_loop_inside_group() {
        // 在 group 内嵌套 loop
        let src = concat!(
            "@startuml\n",
            "group mygroup\n",
            "A -> B : m1\n",
            "loop 10 times\n",
            "C -> D : m2\n",
            "end\n",
            "end\n",
            "@enduml"
        );
        let ir = parse_sequence_diagram(src).expect("nested loop in group should parse");
        assert_eq!(ir.all_messages().len(), 2);

        match &ir.body[0] {
            SequenceBodyItem::Group { label, body } => {
                assert_eq!(label, "mygroup");
                assert_eq!(body.len(), 2);
                match &body[1] {
                    SequenceBodyItem::Loop { label, body } => {
                        assert_eq!(label, "10 times");
                        assert_eq!(body.len(), 1);
                    }
                    _ => panic!("expected nested loop"),
                }
            }
            _ => panic!("expected group"),
        }
    }

    #[test]
    fn deeply_nested_fragments() {
        // 三层嵌套：alt -> loop -> opt
        let src = concat!(
            "@startuml\n",
            "alt condition\n",
            "A -> B : m1\n",
            "loop forever\n",
            "C -> D : m2\n",
            "opt optional\n",
            "E -> F : m3\n",
            "end\n",
            "end\n",
            "end\n",
            "@enduml"
        );
        let ir = parse_sequence_diagram(src).expect("deeply nested should parse");
        assert_eq!(ir.all_messages().len(), 3);

        match &ir.body[0] {
            SequenceBodyItem::Alt { sections } => {
                match &sections[0].body[1] {
                    SequenceBodyItem::Loop { label, body } => {
                        assert_eq!(label, "forever");
                        match &body[1] {
                            SequenceBodyItem::Opt { label, .. } => {
                                assert_eq!(label, "optional");
                            }
                            _ => panic!("expected nested opt"),
                        }
                    }
                    _ => panic!("expected nested loop"),
                }
            }
            _ => panic!("expected alt"),
        }
    }

    #[test]
    fn alt_without_end_before_enduml_rejected() {
        let err = parse_sequence_diagram("@startuml\nalt x\nA -> B : m\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn activate_deactivate_creates_span() {
        let ir = parse_ok("@startuml\nactivate A\nA -> B : m\ndeactivate A\n@enduml");
        assert_eq!(ir.activation_spans.len(), 1);
        assert_eq!(ir.activation_spans[0].participant_id, "A");
        assert_eq!(ir.activation_spans[0].start_msg_index, 0);
        assert_eq!(ir.activation_spans[0].end_msg_index, 1);
    }

    #[test]
    fn activate_without_deactivate_auto_closes() {
        // 激活但未停用时，自动关闭到图结束
        let ir = parse_ok("@startuml\nactivate A\nA -> B : m\n@enduml");
        assert_eq!(ir.activation_spans.len(), 1);
        assert_eq!(ir.activation_spans[0].participant_id, "A");
        assert_eq!(ir.activation_spans[0].start_msg_index, 0);
        assert_eq!(ir.activation_spans[0].end_msg_index, 1);
    }

    #[test]
    fn stray_deactivate_errors() {
        let err = parse_sequence_diagram("@startuml\ndeactivate A\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn activate_deactivate_without_message() {
        let ir = parse_ok("@startuml\nactivate A\ndeactivate A\n@enduml");
        assert_eq!(ir.activation_spans.len(), 1);
        assert_eq!(
            ir.activation_spans[0].start_msg_index,
            ir.activation_spans[0].end_msg_index
        );
    }

    #[test]
    fn loop_end_wraps_messages() {
        let ir = parse_ok("@startuml\nloop retry\nA -> B : x\nend\n@enduml");
        match &ir.body[0] {
            SequenceBodyItem::Loop { label, body } => {
                assert_eq!(label, "retry");
                assert_eq!(body.len(), 1);
            }
            _ => panic!("expected loop"),
        }
    }

    #[test]
    fn par_else_two_paths() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "par one\n",
            "A -> B : a\n",
            "else two\n",
            "A -> C : b\n",
            "end\n",
            "@enduml"
        ));
        assert_eq!(ir.all_messages().len(), 2);
        match &ir.body[0] {
            SequenceBodyItem::Par { sections } => assert_eq!(sections.len(), 2),
            _ => panic!("expected par"),
        }
    }

    #[test]
    fn par_and_separates_branches_like_else() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "par one\n",
            "A -> B : a\n",
            "and two\n",
            "A -> C : b\n",
            "end\n@enduml"
        ));
        assert_eq!(ir.all_messages().len(), 2);
        match &ir.body[0] {
            SequenceBodyItem::Par { sections } => {
                assert_eq!(sections[1].label, "two");
            }
            _ => panic!("expected par"),
        }
    }

    #[test]
    fn and_outside_par_errors() {
        let err = parse_sequence_diagram("@startuml\nand x\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn and_inside_alt_errors() {
        let err = parse_sequence_diagram("@startuml\nalt a\nand x\nA -> B : m\nend\n@enduml")
            .unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn skinparam_unknown_errors() {
        let err = parse_sequence_diagram("@startuml\nskinparam foo 1\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn autonumber_sets_start() {
        let ir = parse_ok("@startuml\nautonumber 5\nA -> B : hi\n@enduml");
        assert_eq!(ir.autonumber_start, Some(5));
    }

    #[test]
    fn autonumber_stop_clears() {
        let ir = parse_ok("@startuml\nautonumber\nautonumber stop\nA -> B : x\n@enduml");
        assert!(ir.autonumber_start.is_none());
    }

    #[test]
    fn missing_startuml() {
        let err = parse_sequence_diagram("Alice -> Bob : x\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn missing_enduml() {
        let err = parse_sequence_diagram("@startuml\nA -> B : x").unwrap_err();
        match err {
            NativeError::Parse { detail, .. } => assert!(detail.contains("enduml"), "{detail}"),
            e => panic!("{e:?}"),
        }
    }

    #[test]
    fn skip_blank_and_comment_lines() {
        let ir = parse_ok("@startuml\n\n' cmt\n  \nA -> B : ok\n@enduml");
        assert_eq!(ir.all_messages().len(), 1);
    }

    #[test]
    fn skips_injected_theme_line() {
        let ir = parse_ok("@startuml\n!theme bluegray\nA -> B : x\n@enduml");
        assert_eq!(ir.all_messages().len(), 1);
        assert_eq!(ir.all_messages()[0].label, "x");
    }

    #[test]
    fn title_single_line() {
        let ir = parse_ok("@startuml\ntitle Hello Diagram\nA -> B : m\n@enduml");
        assert_eq!(ir.title.as_deref(), Some("Hello Diagram"));
    }

    #[test]
    fn title_multiline_end_title() {
        let ir = parse_ok(concat!(
            "@startuml\ntitle\n",
            "  First line\n",
            "  Second\n",
            "end title\n",
            "X -> Y : z\n@enduml"
        ));
        assert!(ir.title.as_deref().unwrap().contains("First line"));
        assert!(ir.title.as_deref().unwrap().contains("Second"));
    }

    #[test]
    fn title_in_alt_errors() {
        let err = parse_sequence_diagram("@startuml\nalt a\ntitle bad\nA -> B : m\nend\n@enduml")
            .unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn header_single_line() {
        let ir = parse_ok("@startuml\nheader Top note\nA -> B : m\n@enduml");
        assert_eq!(ir.page_header.as_deref(), Some("Top note"));
    }

    #[test]
    fn header_multiline_end_header() {
        let ir = parse_ok(concat!(
            "@startuml\nheader\n",
            "  H1\n",
            "  H2\n",
            "end header\n",
            "X -> Y : z\n@enduml"
        ));
        let h = ir.page_header.as_deref().unwrap();
        assert!(h.contains("H1"));
        assert!(h.contains("H2"));
    }

    #[test]
    fn footer_single_line() {
        let ir = parse_ok("@startuml\nfooter Bottom line\nA -> B : m\n@enduml");
        assert_eq!(ir.page_footer.as_deref(), Some("Bottom line"));
    }

    #[test]
    fn header_in_alt_errors() {
        let err = parse_sequence_diagram("@startuml\nalt a\nheader bad\nA -> B : m\nend\n@enduml")
            .unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn footer_in_alt_errors() {
        let err = parse_sequence_diagram("@startuml\nopt x\nfooter bad\nA -> B : m\nend\n@enduml")
            .unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn message_label_preserves_colons_after_first() {
        let ir = parse_ok("@startuml\nA -> B : a : b : c\n@enduml");
        assert_eq!(ir.all_messages()[0].label, "a : b : c");
    }

    #[test]
    fn message_label_unescapes_plantuml_newline() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "A -> B : line1\\nline2\n",
            "@enduml"
        ));
        assert_eq!(ir.all_messages()[0].label, "line1\nline2");
    }

    #[test]
    fn legend_center_end_legend() {
        use crate::plantuml_native::ir::LegendAlign;
        let ir = parse_ok(concat!(
            "@startuml\nlegend center\n",
            "  Line A\n",
            "  Line B\n",
            "end legend\n",
            "X -> Y : z\n@enduml"
        ));
        let leg = ir.legend.as_ref().expect("legend");
        assert_eq!(leg.align, LegendAlign::Center);
        assert!(leg.text.contains("Line A"));
        assert!(leg.text.contains("Line B"));
    }

    #[test]
    fn legend_default_right_on_bare_legend() {
        use crate::plantuml_native::ir::LegendAlign;
        let ir = parse_ok("@startuml\nlegend\none\nend legend\n@enduml");
        assert_eq!(ir.legend.as_ref().unwrap().align, LegendAlign::Right);
    }

    #[test]
    fn legend_in_alt_errors() {
        let err = parse_sequence_diagram("@startuml\nalt a\nlegend\nx\nend legend\nend\n@enduml")
            .unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn note_over_one_line() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "participant A\nparticipant B\n",
            "A -> B : hi\n",
            "note over A : hello note\n",
            "@enduml"
        ));
        assert_eq!(ir.layout_row_count(), 2);
        assert_eq!(ir.all_messages().len(), 1);
        assert!(matches!(ir.body[1], SequenceBodyItem::Note(_)));
    }

    #[test]
    fn note_multiline_end_note() {
        let ir = parse_ok(concat!(
            "@startuml\nparticipant A\nparticipant B\n",
            "note over A, B\n",
            "line one\n",
            "line two\n",
            "end note\n",
            "A -> B : done\n",
            "@enduml"
        ));
        assert_eq!(ir.layout_row_count(), 2);
        let note = match &ir.body[0] {
            SequenceBodyItem::Note(n) => n,
            _ => panic!("expected top note"),
        };
        assert!(note.text.contains("line one"));
        assert!(note.text.contains("line two"));
    }

    #[test]
    fn group_wraps_steps() {
        let ir = parse_ok(concat!(
            "@startuml\ngroup Auth\n",
            "U -> S : login\n",
            "note right of S : ok\n",
            "end\n@enduml"
        ));
        match &ir.body[0] {
            SequenceBodyItem::Group { label, body } => {
                assert_eq!(label, "Auth");
                assert_eq!(body.len(), 2);
            }
            _ => panic!("expected group"),
        }
    }

    #[test]
    fn box_end_box_parses() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "box \"Services\" #LightBlue\n",
            "participant A\n",
            "participant B\n",
            "end box\n",
            "A -> B : hello\n",
            "@enduml"
        ));
        assert_eq!(ir.boxes.len(), 1);
        assert_eq!(ir.boxes[0].title.as_deref(), Some("Services"));
        assert_eq!(ir.boxes[0].color.as_deref(), Some("#LightBlue"));
        assert_eq!(ir.boxes[0].participant_ids, vec!["A", "B"]);
        // body 中也应当有 Box 项
        match &ir.body[0] {
            SequenceBodyItem::Box(pbox) => {
                assert_eq!(pbox.title.as_deref(), Some("Services"));
            }
            _ => panic!("expected Box item in body"),
        }
    }

    #[test]
    fn box_without_title_or_color() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "box\n",
            "participant X\n",
            "end box\n",
            "X -> X : self\n",
            "@enduml"
        ));
        assert_eq!(ir.boxes.len(), 1);
        assert!(ir.boxes[0].title.is_none());
        assert!(ir.boxes[0].color.is_none());
        assert_eq!(ir.boxes[0].participant_ids, vec!["X"]);
    }

    #[test]
    fn box_in_alt_errors() {
        let err = parse_sequence_diagram(concat!(
            "@startuml\n",
            "alt test\n",
            "box \"Bad\"\n",
            "A -> B : x\n",
            "end box\n",
            "end\n",
            "@enduml"
        )).unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn destroy_inside_opt() {
        let ir = parse_ok(concat!(
            "@startuml\nparticipant A\nparticipant B\n",
            "A -> B : ping\n",
            "destroy B\n",
            "A -> A : after\n",
            "@enduml"
        ));
        assert_eq!(ir.layout_row_count(), 3);
        assert_eq!(ir.all_messages().len(), 2);
        assert!(matches!(
            ir.body[1],
            SequenceBodyItem::Destroy { ref participant_id } if participant_id == "B"
        ));
    }

    #[test]
    fn destroy_inside_opt_nested() {
        let ir = parse_ok(concat!(
            "@startuml\nopt x\n",
            "A -> B : m\n",
            "destroy B\n",
            "end\n@enduml"
        ));
        match &ir.body[0] {
            SequenceBodyItem::Opt { body, .. } => {
                assert_eq!(body.len(), 2);
                assert!(matches!(
                    body[1],
                    SequenceBodyItem::Destroy { ref participant_id } if participant_id == "B"
                ));
            }
            _ => panic!("expected opt"),
        }
    }

    #[test]
    fn destroy_without_id_errors() {
        let err = parse_sequence_diagram("@startuml\ndestroy\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn destroy_closes_open_activate_stack() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "A -> B : m\n",
            "activate B\n",
            "destroy B\n",
            "@enduml"
        ));
        assert_eq!(ir.activation_spans.len(), 1);
        assert_eq!(ir.activation_spans[0].participant_id, "B");
        assert_eq!(ir.activation_spans[0].end_msg_index, 1);
    }

    #[test]
    fn delay_dots_line_parses() {
        use crate::plantuml_native::ir::SequenceDelayKind;
        let ir = parse_ok(concat!(
            "@startuml\nparticipant A\nparticipant B\n",
            "A -> B : hi\n",
            "......\n",
            "B -> A : back\n",
            "@enduml"
        ));
        assert_eq!(ir.layout_row_count(), 3);
        assert_eq!(ir.all_messages().len(), 2);
        match &ir.body[1] {
            SequenceBodyItem::Delay(d) => {
                assert_eq!(d.kind, SequenceDelayKind::Dots);
                assert!(d.text.is_none());
            }
            _ => panic!("expected delay"),
        }
    }

    #[test]
    fn delay_bars_line_parses() {
        use crate::plantuml_native::ir::SequenceDelayKind;
        let ir = parse_ok("@startuml\n|||\nA -> B : x\n@enduml");
        match &ir.body[0] {
            SequenceBodyItem::Delay(d) => {
                assert_eq!(d.kind, SequenceDelayKind::Bars);
                assert!(d.text.is_none());
            }
            _ => panic!("expected delay"),
        }
    }

    #[test]
    fn delay_dots_with_text() {
        let ir = parse_ok("@startuml\n... 5 minutes later ...\nA -> B : x\n@enduml");
        match &ir.body[0] {
            SequenceBodyItem::Delay(d) => {
                assert_eq!(d.kind, SequenceDelayKind::Dots);
                assert_eq!(d.text.as_deref(), Some("5 minutes later"));
            }
            _ => panic!("expected delay"),
        }
    }

    #[test]
    fn delay_bars_with_text() {
        let ir = parse_ok("@startuml\n||| processing |||\nA -> B : x\n@enduml");
        match &ir.body[0] {
            SequenceBodyItem::Delay(d) => {
                assert_eq!(d.kind, SequenceDelayKind::Bars);
                assert_eq!(d.text.as_deref(), Some("processing"));
            }
            _ => panic!("expected delay"),
        }
    }

    #[test]
    fn delay_two_dots_not_recognized() {
        let ir = parse_ok("@startuml\n..\nA -> B : ok\n@enduml");
        assert_eq!(ir.body.len(), 1);
        assert!(matches!(ir.body[0], SequenceBodyItem::Message(_)));
    }

    #[test]
    fn divider_with_label() {
        let ir = parse_ok("@startuml\n== Initialization ==\nA -> B : start\n@enduml");
        assert_eq!(ir.body.len(), 2);
        match &ir.body[0] {
            SequenceBodyItem::Divider(d) => {
                assert_eq!(d.label.as_deref(), Some("Initialization"));
            }
            _ => panic!("expected divider"),
        }
    }

    #[test]
    fn divider_without_label() {
        let ir = parse_ok("@startuml\n== ==\nA -> B : msg\n@enduml");
        assert_eq!(ir.body.len(), 2);
        match &ir.body[0] {
            SequenceBodyItem::Divider(d) => {
                assert!(d.label.is_none());
            }
            _ => panic!("expected divider"),
        }
    }

    #[test]
    fn divider_inside_fragment() {
        let ir = parse_ok("@startuml\nalt success\n== Step 1 ==\nA -> B : x\nend\n@enduml");
        assert_eq!(ir.all_messages().len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Alt { sections } => {
                assert_eq!(sections[0].body.len(), 2);
                match &sections[0].body[0] {
                    SequenceBodyItem::Divider(d) => {
                        assert_eq!(d.label.as_deref(), Some("Step 1"));
                    }
                    _ => panic!("expected divider in fragment"),
                }
            }
            _ => panic!("expected alt"),
        }
    }

    #[test]
    fn create_participant_basic() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "create B\n",
            "A -> B : hello\n",
            "@enduml"
        ));
        assert_eq!(ir.layout_row_count(), 2);
        assert_eq!(ir.all_messages().len(), 1);
        assert!(matches!(
            ir.body[0],
            SequenceBodyItem::Create { ref participant_id } if participant_id == "B"
        ));
        // 验证参与者 B 被标记为已创建
        let b = ir.participants.iter().find(|p| p.id == "B");
        assert!(b.is_some());
        assert!(b.unwrap().is_created);
    }

    #[test]
    fn create_with_display_name() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "create \"Service\" as S\n",
            "A -> S : request\n",
            "@enduml"
        ));
        assert!(matches!(
            ir.body[0],
            SequenceBodyItem::Create { ref participant_id } if participant_id == "S"
        ));
        let s = ir.participants.iter().find(|p| p.id == "S");
        assert!(s.is_some());
        assert_eq!(s.unwrap().display.as_deref(), Some("Service"));
        assert!(s.unwrap().is_created);
    }

    #[test]
    fn create_inside_fragment() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "alt success\n",
            "create B\n",
            "A -> B : init\n",
            "end\n",
            "@enduml"
        ));
        match &ir.body[0] {
            SequenceBodyItem::Alt { sections } => {
                assert_eq!(sections[0].body.len(), 2);
                assert!(matches!(
                    sections[0].body[0],
                    SequenceBodyItem::Create { ref participant_id } if participant_id == "B"
                ));
                // 验证参与者 B 被标记为已创建
                let b = ir.participants.iter().find(|p| p.id == "B");
                assert!(b.is_some());
                assert!(b.unwrap().is_created);
            }
            _ => panic!("expected alt"),
        }
    }

    #[test]
    fn create_without_id_errors() {
        let err = parse_sequence_diagram("@startuml\ncreate\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn create_invalid_id_errors() {
        let err = parse_sequence_diagram("@startuml\ncreate bad-name\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn hnote_over_one_line() {
        use crate::plantuml_native::ir::NoteShape;
        let ir = parse_ok("@startuml\nparticipant A\nhnote over A : hex note\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Note(n) => {
                assert_eq!(n.shape, NoteShape::Hexagonal);
                assert_eq!(n.text, "hex note");
            }
            _ => panic!("expected note"),
        }
    }

    #[test]
    fn rnote_over_one_line() {
        use crate::plantuml_native::ir::NoteShape;
        let ir = parse_ok("@startuml\nparticipant A\nrnote over A : rect note\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Note(n) => {
                assert_eq!(n.shape, NoteShape::Rectangular);
                assert_eq!(n.text, "rect note");
            }
            _ => panic!("expected note"),
        }
    }

    #[test]
    fn hnote_multiline_end_note() {
        use crate::plantuml_native::ir::NoteShape;
        let ir = parse_ok(concat!(
            "@startuml\n",
            "hnote over A\n",
            "line one\n",
            "line two\n",
            "end note\n",
            "@enduml"
        ));
        match &ir.body[0] {
            SequenceBodyItem::Note(n) => {
                assert_eq!(n.shape, NoteShape::Hexagonal);
                assert!(n.text.contains("line one"));
                assert!(n.text.contains("line two"));
            }
            _ => panic!("expected note"),
        }
    }

    #[test]
    fn rnote_left_of() {
        use crate::plantuml_native::ir::NoteShape;
        let ir = parse_ok("@startuml\nparticipant A\nrnote left of A : note text\n@enduml");
        match &ir.body[0] {
            SequenceBodyItem::Note(n) => {
                assert_eq!(n.shape, NoteShape::Rectangular);
                assert!(matches!(n.placement, NotePlacement::LeftOf(_)));
            }
            _ => panic!("expected note"),
        }
    }

    #[test]
    fn hnote_right_of() {
        use crate::plantuml_native::ir::NoteShape;
        let ir = parse_ok("@startuml\nparticipant A\nhnote right of A : note text\n@enduml");
        match &ir.body[0] {
            SequenceBodyItem::Note(n) => {
                assert_eq!(n.shape, NoteShape::Hexagonal);
                assert!(matches!(n.placement, NotePlacement::RightOf(_)));
            }
            _ => panic!("expected note"),
        }
    }

    #[test]
    fn activate_target_shorthand() {
        let ir = parse_ok("@startuml\nA -> B ++ : request\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Message(m) => {
                assert!(m.activate_target);
                assert!(!m.deactivate_source);
            }
            _ => panic!("expected message"),
        }
        // 验证激活 span 正确生成
        assert_eq!(ir.activation_spans.len(), 1);
        assert_eq!(ir.activation_spans[0].participant_id, "B");
        assert_eq!(ir.activation_spans[0].start_msg_index, 0);
    }

    #[test]
    fn deactivate_source_shorthand() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "activate B\n",
            "A -> B : request\n",
            "B -- -> A : response\n",
            "@enduml"
        ));
        assert_eq!(ir.all_messages().len(), 2);
        let msg = ir.all_messages()[1];
        assert!(msg.deactivate_source);
        assert!(!msg.activate_target);
        // 验证激活 span 正确生成
        assert_eq!(ir.activation_spans.len(), 1);
        assert_eq!(ir.activation_spans[0].participant_id, "B");
    }

    #[test]
    fn both_activate_and_deactivate_shorthand() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "activate A\n",
            "A -- -> B ++ : transfer\n",
            "@enduml"
        ));
        // body 只包含消息，不包含 activate 指令
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Message(m) => {
                assert!(m.activate_target, "activate_target should be true");
                assert!(m.deactivate_source, "deactivate_source should be true");
            }
            _ => panic!("expected message"),
        }
        // 验证激活 spans: A被停用，B被激活
        println!("activation_spans: {:?}", ir.activation_spans);
        assert!(ir.activation_spans.len() >= 1, "should have at least 1 span");
    }

    #[test]
    fn arrow_color_red() {
        let ir = parse_ok("@startuml\nA -> B #red : message\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Message(m) => {
                assert_eq!(m.color.as_deref(), Some("red"));
            }
            _ => panic!("expected message"),
        }
    }

    #[test]
    fn arrow_color_hex() {
        let ir = parse_ok("@startuml\nA -> B #FF8833 : message\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Message(m) => {
                assert_eq!(m.color.as_deref(), Some("ff8833")); // normalized to lowercase
            }
            _ => panic!("expected message"),
        }
    }

    #[test]
    fn arrow_color_blue_with_activation() {
        let ir = parse_ok("@startuml\nA -> B ++ #blue : message\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Message(m) => {
                assert_eq!(m.color.as_deref(), Some("blue"));
                assert!(m.activate_target);
            }
            _ => panic!("expected message"),
        }
    }

    #[test]
    fn arrow_no_color() {
        let ir = parse_ok("@startuml\nA -> B : message\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Message(m) => {
                assert!(m.color.is_none());
            }
            _ => panic!("expected message"),
        }
    }

    #[test]
    fn ref_over_single_participant() {
        let ir = parse_ok("@startuml\nparticipant A\nref over A : some reference\n@enduml");
        assert_eq!(ir.body.len(), 1);
        match &ir.body[0] {
            SequenceBodyItem::Ref(r) => {
                assert_eq!(r.participants, vec!["A"]);
                assert_eq!(r.text, "some reference");
            }
            _ => panic!("expected ref"),
        }
    }

    #[test]
    fn ref_over_multiple_participants() {
        let ir = parse_ok("@startuml\nA -> B : msg\nref over A, B : interaction details\n@enduml");
        assert_eq!(ir.body.len(), 2);
        match &ir.body[1] {
            SequenceBodyItem::Ref(r) => {
                assert_eq!(r.participants, vec!["A", "B"]);
                assert_eq!(r.text, "interaction details");
            }
            _ => panic!("expected ref"),
        }
    }

    #[test]
    fn ref_over_inside_fragment() {
        let ir = parse_ok(concat!(
            "@startuml\n",
            "opt test\n",
            "ref over A : reference\n",
            "end\n",
            "@enduml"
        ));
        match &ir.body[0] {
            SequenceBodyItem::Opt { body, .. } => {
                assert_eq!(body.len(), 1);
                assert!(matches!(&body[0], SequenceBodyItem::Ref(_)));
            }
            _ => panic!("expected opt"),
        }
    }

    #[test]
    fn ref_over_without_text_errors() {
        let err = parse_sequence_diagram("@startuml\nref over A\n@enduml").unwrap_err();
        assert!(matches!(err, NativeError::Parse { .. }));
    }

    #[test]
    fn newpage_basic() {
        let ir = parse_ok("@startuml\nA -> B : msg\nnewpage\nB -> C : msg2\n@enduml");
        assert_eq!(ir.body.len(), 3);
        assert!(matches!(&ir.body[0], SequenceBodyItem::Message(_)));
        assert!(matches!(&ir.body[1], SequenceBodyItem::Newpage { .. }));
        assert!(matches!(&ir.body[2], SequenceBodyItem::Message(_)));
    }

    #[test]
    fn newpage_with_title() {
        let ir = parse_ok("@startuml\nA -> B : msg\nnewpage Page 2\nB -> C : msg2\n@enduml");
        assert_eq!(ir.body.len(), 3);
        match &ir.body[1] {
            SequenceBodyItem::Newpage { title } => {
                assert_eq!(title.as_deref(), Some("Page 2"));
            }
            _ => panic!("expected newpage"),
        }
    }

    #[test]
    fn newpage_without_title() {
        let ir = parse_ok("@startuml\nA -> B : msg\nnewpage\nB -> C : msg2\n@enduml");
        assert_eq!(ir.body.len(), 3);
        match &ir.body[1] {
            SequenceBodyItem::Newpage { title } => {
                assert!(title.is_none());
            }
            _ => panic!("expected newpage"),
        }
    }
}
