//! 序列图中间表示（附录 A v0 子集）。

use serde::Serialize;

/// 多图类扩展入口（附录 B 队列）；当前管线已支持序列图与组件图。
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum DiagramKind {
    Sequence,
    Component,
    // 后续：Class, Activity, State, … 每类独立 parse/layout/svg 后再在此枚举登记。
}

/// 序列图参与者：`id` 用于消息与布局键；`display` 为表头展示名（`participant "…" as id`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SequenceParticipant {
    pub id: String,
    pub display: Option<String>,
    /// 标记参与者是否通过 `create` 关键字创建（用于渲染时添加创建标记）
    #[serde(default)]
    pub is_created: bool,
}

impl SequenceParticipant {
    /// 测试与手写 IR 构造用；解析路径走 `SequenceParticipant { id, display }`。
    #[allow(dead_code)] // 仅子模块 #[cfg(test)] 调用；lib 构建仍报 unused
    pub fn id_only(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            display: None,
            is_created: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum NotePlacement {
    LeftOf(String),
    RightOf(String),
    Over1(String),
    Over2(String, String),
}

/// 注释形状样式（PlantUML 支持 note / hnote / rnote 三种）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub enum NoteShape {
    /// 默认样式：折角矩形（note 关键字）
    #[default]
    Standard,
    /// 六边形注释（hnote 关键字）
    Hexagonal,
    /// 矩形注释（rnote 关键字）
    Rectangular,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SequenceNote {
    pub placement: NotePlacement,
    pub text: String,
    /// 注释形状样式（默认为 Standard）
    #[serde(default)]
    pub shape: NoteShape,
}

/// 延迟 / 停顿行（`...` 与 `|||`），不计入 `all_messages`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SequenceDelay {
    /// 延迟类型（点或竖线）
    pub kind: SequenceDelayKind,
    /// 可选的文案（如 `... 5 minutes later ...` 中的 "5 minutes later"）
    pub text: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SequenceDelayKind {
    /// 整行至少 3 个 `.`（可两端空白）。
    Dots,
    /// 整行至少 3 个 `|`。
    Bars,
}

/// 分割线（`== title ==`），用于在序列图中分隔不同部分。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SequenceDivider {
    /// 分割线标题（可选）
    pub label: Option<String>,
}

/// `ref over` 引用块（跨参与者显示引用信息）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SequenceRef {
    /// 参与者列表（1个或多个）
    pub participants: Vec<String>,
    /// 引用文本
    pub text: String,
}

/// `box` / `end box` 分组：包含一组参与者和可选的背景色/标题。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ParticipantBox {
    /// `box` 后紧跟的可选标题（如 `box "Services"`）
    pub title: Option<String>,
    /// 可选的背景色（如 `box #LightBlue` 或 `box rgb(200,200,255)`）
    pub color: Option<String>,
    /// 该 box 内的参与者 ID 列表（按声明顺序）
    pub participant_ids: Vec<String>,
}

/// `alt` / `par` 分支中的一段（支持嵌套）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AltSection {
    pub label: String,
    /// 支持嵌套：可包含消息、注释、延迟或子 fragment
    pub body: Vec<SequenceBodyItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum SequenceBodyItem {
    Message(SequenceMessage),
    Note(SequenceNote),
    /// 创建参与者 `create ParticipantName`
    Create {
        participant_id: String,
    },
    Destroy {
        participant_id: String,
    },
    Delay(SequenceDelay),
    /// 分割线 `== title ==`（可选标题）
    Divider(SequenceDivider),
    /// `ref over` 引用块
    Ref(SequenceRef),
    /// `newpage` 分页（可选标题）
    Newpage {
        title: Option<String>,
    },
    /// `box` / `end box` 分组（仅顶层有效，fragment 内跳过）
    Box(ParticipantBox),
    /// `alt` / `else` / `end`（支持嵌套）。
    Alt {
        sections: Vec<AltSection>,
    },
    /// `opt` / `end`（支持嵌套）。
    Opt {
        label: String,
        body: Vec<SequenceBodyItem>,
    },
    /// `loop` / `end`（支持嵌套）。
    Loop {
        label: String,
        body: Vec<SequenceBodyItem>,
    },
    /// `group` / `end`（支持嵌套）。
    Group {
        label: String,
        body: Vec<SequenceBodyItem>,
    },
    /// `par` / `else` / `and` / `end`（支持嵌套）。
    Par {
        sections: Vec<AltSection>,
    },
}

/// 沿参与者生命线的激活条（消息索引为 `all_messages()` 顺序，半开区间 `[start, end)`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActivationSpan {
    pub participant_id: String,
    pub start_msg_index: usize,
    pub end_msg_index: usize,
}

/// 图例对齐（`legend` / `legend left` / `legend right` / `legend center`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub enum LegendAlign {
    Left,
    #[default]
    Right,
    Center,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiagramLegend {
    pub text: String,
    pub align: LegendAlign,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct SequenceDiagram {
    /// 图标题（`title …` 或 `title` / `end title` 块）；无则为 `None`。
    pub title: Option<String>,
    /// 页眉（`header …` 或 `header` / `end header`）；无则为 `None`。
    pub page_header: Option<String>,
    /// 页脚（`footer …` 或 `footer` / `end footer`）；无则为 `None`。
    pub page_footer: Option<String>,
    /// 图例（`legend` … `end legend`）；无则为 `None`。
    pub legend: Option<DiagramLegend>,
    /// 参与者出现顺序（显式声明 + 消息中隐式首次出现）
    pub participants: Vec<SequenceParticipant>,
    /// 分组框（`box` / `end box`），按声明顺序
    pub boxes: Vec<ParticipantBox>,
    pub body: Vec<SequenceBodyItem>,
    pub activation_spans: Vec<ActivationSpan>,
    /// `autonumber` / `autonumber n` 后为 `Some(首条消息序号)`；`autonumber stop` 为 `None`。
    pub autonumber_start: Option<u32>,
}

/// 布局 / SVG 一行：消息箭头、注释块、销毁或延迟行。
#[derive(Debug, Clone, Copy)]
pub enum LayoutRow<'a> {
    Message(&'a SequenceMessage),
    Note(&'a SequenceNote),
    Create { participant_id: &'a str },
    Destroy { participant_id: &'a str },
    Delay(&'a SequenceDelay),
    Divider(&'a SequenceDivider),
    Ref(&'a SequenceRef),
    /// `newpage` 分页标记
    Newpage { title: Option<&'a str> },
}

impl SequenceDiagram {
    /// 文档顺序展开所有消息（激活条、autonumber 序号仅计消息）。
    pub fn all_messages(&self) -> Vec<&SequenceMessage> {
        let mut v = Vec::new();
        for b in &self.body {
            collect_messages_item(b, &mut v);
        }
        v
    }

    /// 布局行数（消息 + 注释），与 `for_each_layout_row` 一致。
    pub fn layout_row_count(&self) -> usize {
        let mut n = 0;
        self.for_each_layout_row(|_| n += 1);
        n
    }

    pub fn for_each_layout_row<F: FnMut(LayoutRow<'_>)>(&self, mut f: F) {
        for item in &self.body {
            walk_layout_item(item, &mut f);
        }
    }
}

fn collect_messages_item<'a>(b: &'a SequenceBodyItem, v: &mut Vec<&'a SequenceMessage>) {
    match b {
        SequenceBodyItem::Message(m) => v.push(m),
        SequenceBodyItem::Note(_)
        | SequenceBodyItem::Create { .. }
        | SequenceBodyItem::Destroy { .. }
        | SequenceBodyItem::Delay(_)
        | SequenceBodyItem::Divider(_)
        | SequenceBodyItem::Ref(_)
        | SequenceBodyItem::Newpage { .. }
        | SequenceBodyItem::Box(_) => {}
        SequenceBodyItem::Alt { sections } => {
            for s in sections {
                collect_messages_body(&s.body, v);
            }
        }
        SequenceBodyItem::Opt { body, .. }
        | SequenceBodyItem::Loop { body, .. }
        | SequenceBodyItem::Group { body, .. } => {
            collect_messages_body(body, v);
        }
        SequenceBodyItem::Par { sections } => {
            for s in sections {
                collect_messages_body(&s.body, v);
            }
        }
    }
}

fn collect_messages_body<'a>(body: &'a [SequenceBodyItem], v: &mut Vec<&'a SequenceMessage>) {
    for b in body {
        collect_messages_item(b, v);
    }
}

fn walk_layout_item<F: FnMut(LayoutRow<'_>)>(b: &SequenceBodyItem, f: &mut F) {
    match b {
        SequenceBodyItem::Message(m) => f(LayoutRow::Message(m)),
        SequenceBodyItem::Note(n) => f(LayoutRow::Note(n)),
        SequenceBodyItem::Create { participant_id } => f(LayoutRow::Create {
            participant_id: participant_id.as_str(),
        }),
        SequenceBodyItem::Destroy { participant_id } => f(LayoutRow::Destroy {
            participant_id: participant_id.as_str(),
        }),
        SequenceBodyItem::Delay(d) => f(LayoutRow::Delay(d)),
        SequenceBodyItem::Divider(d) => f(LayoutRow::Divider(d)),
        SequenceBodyItem::Ref(r) => f(LayoutRow::Ref(r)),
        SequenceBodyItem::Newpage { title } => f(LayoutRow::Newpage {
            title: title.as_deref(),
        }),
        SequenceBodyItem::Box(_) => {
            // box 不产生布局行
        }
        SequenceBodyItem::Alt { sections } => {
            for s in sections {
                walk_layout_body(&s.body, f);
            }
        }
        SequenceBodyItem::Opt { body, .. }
        | SequenceBodyItem::Loop { body, .. }
        | SequenceBodyItem::Group { body, .. } => {
            walk_layout_body(body, f);
        }
        SequenceBodyItem::Par { sections } => {
            for s in sections {
                walk_layout_body(&s.body, f);
            }
        }
    }
}

fn walk_layout_body<F: FnMut(LayoutRow<'_>)>(body: &[SequenceBodyItem], f: &mut F) {
    for b in body {
        walk_layout_item(b, f);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SequenceMessage {
    pub from: String,
    pub to: String,
    pub label: String,
    pub arrow: MessageArrow,
    /// 消息后激活目标参与者（`A -> B ++ : msg` 语法）
    #[serde(default)]
    pub activate_target: bool,
    /// 消息后停用源参与者（`B --> A -- : msg` 语法）
    #[serde(default)]
    pub deactivate_source: bool,
    /// 箭头颜色（`A -> B #red : msg` 语法），支持颜色名或十六进制
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum MessageArrow {
    Solid,
    Dashed,
    /// `->>` 空心箭头（异步风格，与 JAR 非像素级一致）。
    AsyncSolid,
    /// `-->>` 虚线 + 空心箭头。
    AsyncDashed,
}

/// 组件图节点类型。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComponentNode {
    /// 节点 ID（用于边引用）
    pub id: String,
    /// 展示名称
    pub label: String,
    /// 节点形状样式
    pub shape: ComponentShape,
    /// 可选的背景色（如 `#LightBlue`）
    pub color: Option<String>,
    /// 可选的构造型（如 `<<interface>>`）
    pub stereotype: Option<String>,
    /// 父容器 ID（用于嵌套 package 层级关系）
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub enum ComponentShape {
    /// 矩形（默认组件形状）
    #[default]
    Rectangle,
    /// 椭圆形（用于 interface 等）
    Ellipse,
    /// 圆柱形（database）
    Cylinder,
    /// 菱形（cloud）
    Diamond,
    /// 文件夹形（folder）
    Folder,
}

/// 组件图边（连接）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComponentEdge {
    pub from: String,
    pub to: String,
    /// 可选的连接标签
    pub label: Option<String>,
    /// 箭头样式
    pub arrow: ComponentArrowStyle,
    /// 行内 `-[#color]->` 或行尾 `#color`（小写或 hex，与序列图一致）
    #[serde(default)]
    pub color: Option<String>,
    /// `-[hidden]-` / `-[norank]-`：不参与布局连线、不绘制（子集语义）
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub enum ComponentArrowStyle {
    #[default]
    Solid,
    Dashed,
}

/// 组件图体元素。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum ComponentBodyItem {
    Node(ComponentNode),
    Edge(ComponentEdge),
}

/// 组件图注释（note）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComponentNote {
    /// 注释位置：关联的组件 ID
    pub target_id: String,
    /// `note over A, B` 时第二目标；左/右注释为 `None`
    #[serde(default)]
    pub target_id_secondary: Option<String>,
    /// 注释方位：left / right / over
    pub position: NotePosition,
    /// 注释文本内容
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub enum NotePosition {
    #[default]
    Right,
    Left,
    Over,
}

/// 组件图中间表示。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct ComponentDiagram {
    /// 单行或多行 `title`/`end title` 合并后的正文
    #[serde(default)]
    pub title: Option<String>,
    /// 单行或多行 `caption`/`end caption` 合并后的正文
    #[serde(default)]
    pub caption: Option<String>,
    /// `skinparam defaultFontName ...` 白名单解析结果（仅影响 SVG 字体栈）
    #[serde(default)]
    pub skinparam_default_font_name: Option<String>,
    pub nodes: Vec<ComponentNode>,
    pub edges: Vec<ComponentEdge>,
    /// 注释列表
    #[serde(default)]
    pub notes: Vec<ComponentNote>,
}
