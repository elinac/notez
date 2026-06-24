//! 组件图 / 序列图共用的颜色 token 工具（`#name`、`#RRGGBB`）。

/// 校验 `#` 后的颜色载荷（与 `parse/sequence.rs` 中逻辑对齐）。
pub(crate) fn is_valid_color_payload(s: &str) -> bool {
    !s.is_empty()
        && (s.chars().all(|c| c.is_ascii_alphabetic())
            || (s.len() == 6 && s.chars().all(|c| c.is_ascii_hexdigit())))
}

pub(crate) fn normalize_color_token(s: &str) -> String {
    s.to_ascii_lowercase()
}

/// 从字符串末尾剥离 `<<...>>`，返回 (构造型 inner, 剩余前缀)。
pub(crate) fn strip_suffix_stereotype(s: &str) -> (Option<String>, &str) {
    let t = s.trim_end();
    if t.len() < 4 || !t.ends_with(">>") {
        return (None, s);
    }
    let inner_end = t.rfind(">>").expect("ends_with >>");
    let before_close = &t[..inner_end];
    let Some(inner_start) = before_close.rfind("<<") else {
        return (None, s);
    };
    let inner = before_close[inner_start + 2..].trim();
    if inner.is_empty() {
        return (None, s);
    }
    let before = before_close[..inner_start].trim_end();
    (Some(inner.to_string()), before)
}

/// 从字符串末尾剥离 `#name` / `#RRGGBB`（与构造型顺序无关，由调用方循环剥离）。
pub(crate) fn strip_suffix_color(s: &str) -> (Option<String>, &str) {
    let t = s.trim_end();
    if let Some(pos) = t.rfind('#') {
        let after = &t[pos + 1..];
        let end = after
            .find(|c: char| !c.is_ascii_alphanumeric())
            .unwrap_or(after.len());
        if end > 0 {
            let payload = &after[..end];
            if is_valid_color_payload(payload) {
                let before = t[..pos].trim_end();
                return (Some(normalize_color_token(payload)), before);
            }
        }
    }
    (None, s)
}

/// 从行首解析 `#red` / `#aabbcc`（用于边行尾等着色 token）。
pub(crate) fn take_leading_hash_color(s: &str) -> Option<(String, &str)> {
    let s = s.trim_start();
    if !s.starts_with('#') {
        return None;
    }
    let after = &s[1..];
    let end = after
        .find(|c: char| !c.is_ascii_alphanumeric())
        .unwrap_or(after.len());
    if end == 0 {
        return None;
    }
    let payload = &after[..end];
    if !is_valid_color_payload(payload) {
        return None;
    }
    Some((normalize_color_token(payload), &after[end..]))
}

/// 从 `]` / `)` 后的 remainder 反复剥离行尾 `<<st>>` 与 `#color`（支持两种顺序）。
pub(crate) fn peel_trailing_stereotype_and_color(s: &str) -> (Option<String>, Option<String>, &str) {
    let mut stereotype = None;
    let mut color = None;
    let mut work = s.trim();
    loop {
        let (st, r) = strip_suffix_stereotype(work);
        if let Some(inner) = st {
            stereotype = Some(inner);
            work = r.trim();
            continue;
        }
        let (co, r) = strip_suffix_color(work);
        if let Some(c) = co {
            color = Some(c);
            work = r.trim();
            continue;
        }
        break;
    }
    (stereotype, color, work)
}
