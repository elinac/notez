# 统一格式化工具栏

**状态：** 审核修订 v2  
**日期：** 2026-07-04  
**修订：** 2026-07-04 R2（二次源码验证——升级必要性下调、一致性修正）  
**范围：** 新增固定顶部格式化工具栏，三种编辑模式（源码 / 分屏 / 全屏）统一可用

---

## 审核摘要

> **R1 审核**：发现 1 项重大可行性发现、6 项命令映射错误、3 项缺失逻辑。推荐 Strategy C（升级 + 统一 React 工具栏 + 复用 TopBar 命令模式）。
>
> **R2 二次审核（源码验证）**：发现 R1 高估了升级必要性——所有专用命令（`insertTableCommand`、`wrapInHeadingCommand` 等）在 **7.19 中已存在**。升级 7.21 降为**可选**，前置任务（阶段 0）删除，工期缩短 0.5 天至 2.5 天。同时修正了 4 项一致性/完整性问题（WYSIWYG 表格描述矛盾、`isMarkActive` 缺变量来源、任务列表实现过于模糊、strategy 描述与实际选择矛盾）。

---

## 假设

> 如有偏差请立即指出，我将据此修正。

1. 「顶部工具栏」指的是一个**新增的 Markdown 格式化工具栏**（加粗、标题、列表等），而非现有的模式切换栏
2. 工具栏**固定**在编辑器顶部，不随滚动消失（非浮动选区工具栏）
3. 在源码 / 分屏模式下通过 **CodeMirror 6 API** 插入 Markdown 语法
4. 在全屏模式下通过 **Milkdown 命令 API** 执行格式化
5. Milkdown 原有的**浮动选区工具栏**保留不删除，两者共存
6. 工具栏 UI 风格与现有模式切换栏一致（Tailwind CSS、lucide-react 图标）
7. 不引入额外依赖（二次审核确认：所有专用命令在 7.19 中已存在，升级 7.21 为**可选**而非必需）

---

## 可行性审核：Milkdown 7.21 TopBar 发现

### 发现

**Milkdown Crepe 7.21.2**（2026-06-02 发布）新增了 `CrepeFeature.TopBar`——一个**固定在编辑器顶部的格式化工具栏**，默认禁用，与本规格的目标高度重叠。

TopBar 内置按钮分组：

| 组 | 按钮 |
|----|------|
| Heading | 标题下拉菜单（Paragraph / H1–H6） |
| Formatting | Bold, Italic, Strikethrough, Inline Code |
| List | Bullet list, Ordered list, Task list |
| Insert | Link, Image, Table |
| Block | Code block, Math (LaTeX) |
| More | Quote, Horizontal rule |

NoteZ 当前 `package.json` 中 `"@milkdown/crepe": "^7.19.2"`，semver `^` 允许升级到 7.21.2。但项目因 patch 锁定在 7.19.2（见 milkdown-toolbar-governance-design spec）。

### 三种策略对比

| 策略 | WYSIWYG 工作量 | Source/Split 工作量 | UI 一致性 | 维护成本 | 前置条件 |
|------|---------------|-------------------|---------|---------|---------|
| **A**: 启用 Crepe TopBar + 仅 Source/Split 自定义 | 无（内置） | 高 | **低**（TopBar 是 Vue 组件，渲染在 Milkdown 容器内部，位置/样式与 React 自定义栏不统一） | 低 | 升级 7.21 |
| **B**: 全自定义（原始规格） | 高（且命令映射有误） | 高 | **高** | 高 | 无 |
| **C（推荐）**: 统一 React 自定义 + 使用 preset 专用命令（7.19 已足够；升级 7.21 可选） | 中（专用命令调用 + 边界逻辑） | 高 | **高** | **中** | 无（7.19 已具备全部 API） |

**推荐 Strategy C（修订后）的理由：**

1. **命令精确性**：通过源码审计确认 7.19 preset 已导出全部所需专用命令，与 keymap 绑定一致
2. **UI 一致性**：不启用 Crepe 内置 TopBar（它是 Vue 组件，渲染在 Milkdown 容器内部），而是用自己的 React 组件放在 `MarkdownEditor` 层——三种模式下位置和样式完全统一
3. ~~**升级收益**~~：**二次审核修正**——所有专用命令（`insertTableCommand`、`wrapInHeadingCommand` 等）在 7.19 中已存在。升级到 7.21 为**可选**（bug 修复 + TopBar 参考），不是前置条件
4. ~~**Table API**~~：**二次审核修正**——`insertTableCommand` 在 7.19 中已存在，内部使用 `createTable()` 并自动处理光标定位

### 前置任务

> ~~需先完成 milkdown-toolbar-governance-design 的**阶段 1-alt**（mini-patch 31 行），才能升级 Milkdown。~~
>
> **二次审核修正**：升级 Milkdown 不再是前置条件。7.19 已具备全部所需 API。mini-patch 治理工作可独立并行推进。

---

## 目标

1. 提供一个固定在编辑器顶部的格式化工具栏，降低 Markdown 语法的记忆门槛
2. 三种编辑模式下行为统一——同一个按钮在不同模式下执行等价操作
3. 支持键盘快捷键（与 Milkdown / 主流 Markdown 编辑器一致）
4. 不影响现有功能：模式切换、大纲面板、图表渲染、PlantUML/Mermaid 管线

---

## 技术栈

| 层 | 技术 |
|----|------|
| UI 组件 | React 19 + Tailwind CSS 4 + lucide-react |
| 源码 / 分屏引擎 | CodeMirror 6（`@codemirror/view`、`@codemirror/state`） |
| 全屏引擎 | Milkdown Crepe **7.19+**（`@milkdown/kit/preset/commonmark`、`@milkdown/kit/preset/gfm`） |
| 状态管理 | Zustand（`EditorMode` 决定分发路径） |

---

## 按钮集合（审核修正）

> 以下 Milkdown 命令列已根据 preset 源码（7.19 实际安装版本）逐一验证。

| 组 | 按钮 | 图标 (lucide) | Markdown 语法 | 快捷键 | Milkdown 命令（精确调用） |
|----|------|---------------|---------------|--------|--------------------------|
| **文本格式** | 加粗 | `Bold` | `**text**` | `Ctrl+B` | `commands.call(toggleStrongCommand.key)` |
| | 斜体 | `Italic` | `*text*` | `Ctrl+I` | `commands.call(toggleEmphasisCommand.key)` |
| | 删除线 | `Strikethrough` | `~~text~~` | `Ctrl+Alt+X`（Milkdown keymap: `Mod-Alt-x`） | `commands.call(toggleStrikethroughCommand.key)` |
| | 行内代码 | `Code` | `` `code` `` | `Ctrl+E` | ⚠️ 需特殊处理空选区（见下方「行内代码」小节） |
| **块级结构** | 标题（下拉） | `Heading` + `ChevronDown` | `# `…`###### ` | `Ctrl+Alt+1~6` | `commands.call(wrapInHeadingCommand.key, level)` — 专用命令，直接传 level 数字 |
| | 正文（标题下拉内） | — | 去除 `#` 前缀 | — | `commands.call(wrapInHeadingCommand.key, 0)` 或 `commands.call(turnIntoTextCommand.key)` |
| | 引用 | `Quote` | `> ` | `Ctrl+Shift+B`（Milkdown keymap: `Mod-Shift-b`） | `commands.call(wrapInBlockquoteCommand.key)` — 专用命令，无参数 |
| | 无序列表 | `List` | `- ` | `Ctrl+Alt+8`（Milkdown keymap: `Mod-Alt-8`） | `commands.call(wrapInBulletListCommand.key)` — 专用命令，无参数 |
| | 有序列表 | `ListOrdered` | `1. ` | `Ctrl+Alt+7`（Milkdown keymap: `Mod-Alt-7`） | `commands.call(wrapInOrderedListCommand.key)` — 专用命令，无参数 |
| | 任务列表 | `ListChecks` | `- [ ] ` | — | ⚠️ GFM **无导出 toggle 命令**，自定义实现（见下方「任务列表」小节） |
| **插入** | 代码块 | `FileCode` | ` ```\n\n``` ` | — | `commands.call(createCodeBlockCommand.key, '')` — 专用命令，参数为 language |
| | 分割线 | `Minus` | `---` | — | `commands.call(insertHrCommand.key)` — 专用命令，内部自动处理光标定位到新段落 |
| | 链接 | `Link` | `[text](url)` | `Ctrl+K` | `commands.call(toggleLinkCommand.key)` ⚠️ 来自 `@milkdown/kit/component/link-tooltip`；需空选区特殊处理 |
| | 图片 | `Image` | `![alt](url)` | — | `commands.call(insertImageCommand.key, { src: '', alt: '', title: '' })` — 专用命令 |
| | 表格（grid picker） | `Table` | GFM table skeleton | — | `commands.call(insertTableCommand.key, { row, col })` — GFM 专用命令，默认 3×3 |

### 原规格命令映射纠错清单

| # | 原规格写法 | 问题 | 修正为专用命令 |
|---|-----------|------|--------------|
| 1 | `setBlockTypeCommand({ headingSchema, level })` | 有更简洁的专用命令 | `wrapInHeadingCommand.key, level` |
| 2 | `wrapInBlockTypeCommand({ blockquoteSchema })` | 有零参数专用命令 | `wrapInBlockquoteCommand.key` |
| 3 | `addBlockTypeCommand({ codeBlockSchema })` | **命令错误** + 有专用命令 | `createCodeBlockCommand.key, language?` |
| 4 | `addBlockTypeCommand({ imageSchema })` | **Schema 错误** + 有专用命令 | `insertImageCommand.key, { src?, alt?, title? }` |
| 5 | `GFM insert table` | 有专用命令 | `insertTableCommand.key, { row?, col? }` |
| 6 | `GFM task list toggle` | **无导出命令**：需自定义实现 | 自行 `wrapInBulletList` + `setNodeMarkup({ checked: false })` |
| 7 | `addBlockTypeCommand({ hrSchema })` | 有专用命令（含光标定位） | `insertHrCommand.key`（无参数） |

### 专用命令 vs 通用命令对照

> TopBar `config.ts`（7.21）使用通用命令，但 preset（7.19 即有）同时导出了更简洁的专用命令。本规格**选择专用命令**，理由：
> 1. 参数更少，无需手动 resolve `schema.type(ctx)`
> 2. 内置边界处理（如 `insertHrCommand` 自动插入段落并移动光标）
> 3. 与 Milkdown keymap 绑定一致（keymap 使用 `wrapInHeadingCommand`）

### 缺失逻辑（从 TopBar 源码发现）

#### 1. 行内代码空选区处理

`toggleInlineCodeCommand` 不支持空选区。TopBar 的处理方式：

```ts
if (state.selection.empty) {
  const markType = inlineCodeSchema.type(ctx);
  const has = isMarkActive(ctx, markType);
  if (has) {
    view.dispatch(state.tr.removeStoredMark(markType));
  } else {
    view.dispatch(state.tr.addStoredMark(markType.create()));
  }
} else {
  commands.call(toggleInlineCodeCommand.key);
}
```

#### 2. `isMarkActive` 需检查 storedMarks 和 cursor marks

仅 `isMarkSelectedCommand` 不够。完整实现（需在 `editor.action(ctx => ...)` 内调用）：

```ts
import { TextSelection } from '@milkdown/kit/prose/state';

function isMarkActive(ctx: Ctx, markType: MarkType): boolean {
  const commands = ctx.get(commandsCtx);
  const view = ctx.get(editorViewCtx);
  const selected = commands.call(isMarkSelectedCommand.key, markType);
  if (selected) return true;

  const { state } = view;
  if (state.storedMarks) {
    return state.storedMarks.some(m => m.type === markType);
  }
  if (state.selection instanceof TextSelection) {
    const { $cursor } = state.selection;
    if ($cursor) {
      return $cursor.marks().some(m => m.type === markType);
    }
  }
  return false;
}
```

#### 3. Link 空选区处理

当光标在链接内部且选区为空时，TopBar 移除 storedMark 而非 toggle link：

```ts
if (state.selection.empty && isMarkActive(ctx, linkSchema.type(ctx))) {
  view.dispatch(state.tr.removeStoredMark(linkSchema.type(ctx)));
  return;
}
commands.call(toggleLinkCommand.key);
```

#### 4. 任务列表——GFM 无专用 toggle 命令

GFM preset 中 `extendListItemSchemaForTask` 扩展了 `listItemSchema`，添加 `checked` 属性，但没有导出 toggle 命令。自定义实现：

```ts
function insertTaskList(ctx: Ctx): void {
  const commands = ctx.get(commandsCtx);
  const view = ctx.get(editorViewCtx);
  // 先创建无序列表
  commands.call(wrapInBulletListCommand.key);
  // 再设置 checked 属性
  const { state } = view;
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0) {
    const node = $from.node(depth);
    if (node.type.name === 'list_item') {
      const pos = $from.before(depth);
      view.dispatch(state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs, checked: false,
      }));
      break;
    }
    depth--;
  }
}
```

#### 5. 表格插入——专用命令已内置光标处理

`insertTableCommand.key, { row, col }` 内部使用 `createTable()` + `Selection.findFrom()` 自动定位光标。7.19 中已可用。

---

## 架构

```
MarkdownEditor.tsx
  ├─ 模式切换栏（现有，不变）
  ├─ FormattingToolbar  ← 新增
  │    ├─ 读取 editorMode（Zustand）
  │    ├─ mode === 'edit' | 'split' → cmToolbarActions(viewRef)
  │    └─ mode === 'wysiwyg'       → milkdownToolbarActions(crepeRef)
  └─ 编辑器内容区（不变）
```

### 组件层次

| 组件 | 文件 | 职责 |
|------|------|------|
| `FormattingToolbar` | `src/components/FormattingToolbar.tsx` | 纯 UI — 渲染按钮，onClick 调用 action |
| `HeadingDropdown` | `src/components/HeadingDropdown.tsx` | 标题级别下拉菜单 |
| `TableGridPicker` | `src/components/TableGridPicker.tsx` | 表格行列选择器 |
| `cmToolbarActions` | `src/utils/cmToolbarActions.ts` | CodeMirror 操作集：wrap selection / insert prefix |
| `milkdownToolbarActions` | `src/utils/milkdownToolbarActions.ts` | Milkdown 操作集：使用 preset 专用命令 + TopBar 边界逻辑 |

### 数据流

```
用户点击「加粗」按钮
  → FormattingToolbar.onClick('bold')
  → if (editorMode === 'wysiwyg')
      → crepeRef.current.editor.action(ctx => {
          const commands = ctx.get(commandsCtx);
          commands.call(toggleStrongCommand.key);
        })
  → else
      → cmToolbarActions.wrapSelection(viewRef.current, '**')
```

### Ref 传递

- `viewRef`（CodeMirror `EditorView`）：已在 `MarkdownEditor` 中创建，通过 prop 传入 `FormattingToolbar`
- `crepeRef`（Milkdown `Crepe`）：需从 `WysiwygEditor` 暴露出来（当前为组件内部 ref），通过回调 prop `onCrepeReady(crepe)` 传递给 `MarkdownEditor`

### Milkdown 命令调用模式

所有 Milkdown 操作通过 `Crepe.editor.action()` 执行：

```ts
crepeRef.current.editor.action(ctx => {
  const status = ctx.get(editorCtx).status;
  if (status !== EditorStatus.Created) return; // 守卫：editor 未就绪则跳过
  const commands = ctx.get(commandsCtx);
  commands.call(someCommand.key, payload);
});
```

需要的 import：

```ts
import { commandsCtx, editorCtx, EditorStatus, editorViewCtx } from '@milkdown/kit/core';
import {
  toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand,
  wrapInHeadingCommand, turnIntoTextCommand,
  wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  createCodeBlockCommand, insertHrCommand, insertImageCommand,
  headingSchema, inlineCodeSchema, strongSchema, emphasisSchema, linkSchema,
  isMarkSelectedCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  toggleStrikethroughCommand, strikethroughSchema,
  insertTableCommand,
} from '@milkdown/kit/preset/gfm';
import { toggleLinkCommand } from '@milkdown/kit/component/link-tooltip';
```

---

## CodeMirror 操作策略

对于 `cmToolbarActions`，每个按钮的操作分三类：

### 1. Inline Mark（wrap selection）

加粗、斜体、删除线、行内代码：

```ts
function wrapSelection(view: EditorView, marker: string): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);

  // 也检查选区外侧是否有 marker（光标在 marker 内部但未选中 marker 本身）
  const before = view.state.sliceDoc(Math.max(0, from - marker.length), from);
  const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + marker.length));
  if (before === marker && after === marker) {
    view.dispatch({ changes: [
      { from: from - marker.length, to: from },
      { from: to, to: to + marker.length },
    ]});
  } else if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > marker.length * 2) {
    const inner = selected.slice(marker.length, -marker.length);
    view.dispatch({ changes: { from, to, insert: inner } });
  } else {
    const text = selected || 'text';
    view.dispatch({
      changes: { from, to, insert: `${marker}${text}${marker}` },
      selection: { anchor: from + marker.length, head: from + marker.length + text.length },
    });
  }
  view.focus();
}
```

### 2. Block Prefix（line prefix toggle）

标题、引用、列表：

```ts
function toggleLinePrefix(view: EditorView, prefix: string): void {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  if (line.text.startsWith(prefix)) {
    view.dispatch({ changes: { from: line.from, to: line.from + prefix.length } });
  } else {
    // 标题互斥：先去除已有的 # 前缀
    const headingMatch = line.text.match(/^#{1,6}\s/);
    const removeLen = headingMatch ? headingMatch[0].length : 0;
    view.dispatch({ changes: { from: line.from, to: line.from + removeLen, insert: prefix } });
  }
  view.focus();
}
```

### 3. Block Insert（insert template）

代码块、分割线、表格：在光标位置插入模板文本。

```ts
function insertBlock(view: EditorView, template: string): void {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  // 确保在新行插入
  const needNewline = line.text.length > 0 ? '\n' : '';
  view.dispatch({
    changes: { from, insert: `${needNewline}${template}\n` },
  });
  view.focus();
}

function insertTable(view: EditorView, cols: number, rows: number): void {
  const header = '| ' + Array(cols).fill('  ').join(' | ') + ' |';
  const separator = '| ' + Array(cols).fill('---').join(' | ') + ' |';
  const dataRow = '| ' + Array(cols).fill('  ').join(' | ') + ' |';
  const lines = [header, separator, ...Array(rows - 1).fill(dataRow)];
  insertBlock(view, lines.join('\n'));
}
```

---

## UI 设计

工具栏紧贴模式切换栏下方，高度约 32px，与模式切换栏风格统一：

```
┌──────────────────────────────────────────────────────────────┐
│ 文件名       │ 源码 │ 分屏 │ 全屏 │    📑 大纲              │  ← 现有模式切换栏
├──────────────────────────────────────────────────────────────┤
│ B I S ` │ ▾标题 │ ❝ • 1. ☐ │ </> — 🔗 🖼 ⊞ │       ▲ │  ← 新工具栏（▲=折叠按钮）
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                       编辑器内容区                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 样式规格

- 按钮尺寸：16px 图标，28px 高度，hover 背景 `bg-gray-100`
- 分组分隔：1px 竖线 `bg-gray-300`
- 按钮激活态（当前选区含该格式）：`bg-blue-100 text-blue-600`
- 整体背景：`bg-gray-50 border-b border-gray-200`（与模式切换栏一致）
- **折叠按钮**：工具栏最右侧 `ChevronUp` / `ChevronDown` 图标，点击隐藏/显示工具栏按钮区。折叠状态 persist 到 Zustand store
- 折叠时工具栏整行隐藏，编辑区域获得更多垂直空间

### 标题下拉菜单

点击「▾标题」弹出下拉列表：

| 选项 | Markdown | 显示 |
|------|----------|------|
| 正文 | （去除 `#` 前缀） | 正文 |
| 标题 1 | `# ` | **H1** |
| 标题 2 | `## ` | **H2** |
| 标题 3 | `### ` | **H3** |
| 标题 4 | `#### ` | **H4** |
| 标题 5 | `##### ` | **H5** |
| 标题 6 | `###### ` | **H6** |

当前光标行若已是标题，下拉按钮显示对应级别（如「H2」）。

**WYSIWYG 模式标题感知**（从 TopBar `getCurrentHeading` 移植）：

```ts
function getCurrentHeading(ctx: Ctx): { label: string; level: number | null } {
  const view = ctx.get(editorViewCtx);
  const { $from } = view.state.selection;
  const node = $from.parent;
  if (node.type === headingSchema.type(ctx)) {
    return { label: `H${node.attrs.level}`, level: node.attrs.level };
  }
  return { label: '正文', level: null };
}
```

### 表格行列选择器

点击表格按钮弹出 grid picker（类似 Word/Notion）：

- 最大 8×6 网格（8列 × 6行）
- hover 高亮已选范围
- 底部显示 `3×2` 等尺寸文字
- 点击确认后：
  - **源码/分屏**：插入 GFM 表格 Markdown 文本
  - **WYSIWYG**：调用 `insertTableCommand.key, { row, col }` 插入表格（内部使用 `createTable` + 自动光标定位）

### 选区状态感知

- **WYSIWYG 模式**：使用上述 `isMarkActive` 函数（检查 `isMarkSelectedCommand` + `storedMarks` + `$cursor.marks()`）
- **源码 / 分屏模式**：通过 CodeMirror selection 检测光标周围的 Markdown marker，激活对应按钮

---

## 项目结构（变更文件）

```
src/
  components/
    FormattingToolbar.tsx        ← 新增：工具栏 UI 组件
    HeadingDropdown.tsx          ← 新增：标题级别下拉菜单
    TableGridPicker.tsx          ← 新增：表格行列选择器
    MarkdownEditor.tsx           ← 修改：插入 FormattingToolbar、传递 ref
    WysiwygEditor.tsx            ← 修改：暴露 Crepe ref（onCrepeReady 回调）
  utils/
    cmToolbarActions.ts          ← 新增：CodeMirror 格式化操作
    milkdownToolbarActions.ts    ← 新增：Milkdown 格式化操作（使用 preset 专用命令 + 边界逻辑）
  store/
    useAppStore.ts               ← 修改：新增 showFormattingToolbar 持久化状态
```

---

## 测试策略

| 层级 | 工具 | 覆盖 |
|------|------|------|
| 单元测试 | Vitest | `cmToolbarActions` 的 wrap / prefix / insert 逻辑 |
| 组件测试 | Vitest + @testing-library/react | `FormattingToolbar` 按钮渲染、onClick 回调 |
| 手工冒烟 | Tauri dev | 三种模式下逐个按钮验证；格式化后内容同步无丢失 |

### 验收用例

1. 源码模式：选中文本 → 点击「加粗」→ 文本被 `**...**` 包裹
2. 源码模式：光标在空行 → 点击「H2」→ 行首插入 `## `
3. 源码模式：已有 `## ` 的行 → 切换为 H3 → 变成 `### `（互斥替换）
4. 分屏模式：点击「代码块」→ 左侧插入 ``` 模板 → 右侧预览实时渲染
5. 分屏模式：grid picker 选择 3×2 → 左侧插入 GFM 表格 → 右侧渲染表格
6. 全屏模式：选中文本 → 点击「加粗」→ 文本变为粗体（Milkdown 渲染）
7. 全屏模式：光标在段落 → 点击「H1」→ 段落变为一级标题
8. 全屏模式：空选区 → 点击「行内代码」→ 后续输入应用 code mark（storedMarks）
9. 全屏模式：grid picker 选择 4×3 → 插入 ProseMirror 表格节点 → 光标在第一个单元格
10. 模式切换 edit → wysiwyg → edit：工具栏始终可见，内容不丢失
11. 已加粗的文本 → 再次点击「加粗」→ 取消加粗（toggle 行为）
12. 折叠按钮 → 工具栏隐藏 → 刷新后仍为折叠状态

---

## 边界

- **Always**：
  - 按钮操作后 focus 回编辑器
  - 操作可 Undo（CodeMirror / Milkdown 均内置 undo stack）
  - lucide-react 图标，不引入额外图标库
  - WYSIWYG 命令执行前检查 `EditorStatus.Created` 守卫

- **Ask first**：
  - 新增按钮（超出上述集合）
  - 修改快捷键绑定
  - 修改 Milkdown 浮动工具栏的行为

- **Never**：
  - 删除 Milkdown 浮动选区工具栏
  - 启用 Crepe 内置 TopBar（避免 Vue 渲染 + 位置不统一）
  - 修改 CodeMirror 核心配置

---

## 成功标准

- [ ] 三种模式下工具栏始终可见（折叠状态除外）
- [ ] 文本格式组（加粗、斜体、删除线、行内代码）在三种模式下功能正确
- [ ] 行内代码空选区时正确处理 storedMarks
- [ ] 块级结构组（标题下拉 H1-H6 + 正文、引用、无序/有序/任务列表）在三种模式下功能正确
- [ ] 标题下拉菜单能感知当前行级别并高亮；切换标题级别互斥替换
- [ ] 插入组（代码块、分割线、链接、图片、表格 grid picker）在三种模式下功能正确
- [ ] 表格 grid picker 可选行列数，WYSIWYG 模式用 `insertTableCommand` 插入 + 自动光标定位
- [ ] 折叠按钮可隐藏/显示工具栏，状态 persist
- [ ] 所有操作可 Undo
- [ ] 操作后焦点回归编辑器
- [ ] `npx vitest run` 新增测试通过
- [ ] 模式切换后工具栏状态正确、内容不丢失

---

## 决策记录

| 日期 | 问题 | 决策 |
|------|------|------|
| 2026-07-04 | 标题按钮交互 | **下拉菜单**（H1–H6 + 正文），节省水平空间 |
| 2026-07-04 | MVP 范围 | **全量交付**，不分阶段裁剪 |
| 2026-07-04 | 工具栏可折叠 | **需要**，右侧提供 toggle 按钮 |
| 2026-07-04 | 表格插入 UI | **弹出行列选择器**（grid picker） |
| 2026-07-04 | R1 审核：策略选择 | **Strategy C**：统一 React 自定义工具栏 + 使用 preset 专用命令，不启用 Crepe 内置 TopBar |
| 2026-07-04 | R1 审核：命令映射 | 7 处纠错——改用专用命令（`wrapInHeadingCommand` 等）替代通用命令；3 处缺失逻辑补充（inline code 空选区、isMarkActive、link 空选区）；Task list 需自定义实现 |
| 2026-07-04 | R2 审核：升级必要性 | **7.21 升级从「必需」降为「可选」**——源码验证所有专用命令在 7.19 中已存在；阶段 0 删除，工期 3→2.5 天 |
| 2026-07-04 | R2 审核：一致性修正 | 4 处修正：WYSIWYG 表格描述统一为 `insertTableCommand`、`isMarkActive` 补全变量来源、任务列表补充具体代码、strategy 描述与实际选择对齐 |

---

## 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| ~~Milkdown 7.21 升级破坏现有功能~~ | — | — | **二次审核删除**：升级不再是前置条件，7.19 已足够 |
| Crepe ref 暴露引入内存泄漏 | 低 | 中 | `WysiwygEditor` unmount 时清理 ref |
| WYSIWYG 模式下命令调用时 editor 未 ready | 中 | 低 | `EditorStatus.Created` 守卫 + `editor.action()` 模式 |
| CodeMirror wrapSelection toggle 检测不够鲁棒 | 中 | 低 | 检查选区外侧 marker + 选区内部 marker 两种情况 |
| 工具栏占用垂直空间影响小屏体验 | 低 | 低 | 折叠按钮 + persist |
| 快捷键与系统 / Tauri 冲突 | 低 | 低 | 仅复用已有的标准快捷键 (Ctrl+B/I/E/K)；标题快捷键 `Ctrl+Alt+1~6` 由 Milkdown keymap 自带 |
| ~~`createTable` 在 7.19 不可用~~ | ~~确定~~ | — | **二次审核删除**：`insertTableCommand` 在 7.19 中已存在，内部使用 `createTable` |

### 收益 / 损失分析

| 维度 | 收益 | 损失 / 代价 |
|------|------|-----------|
| 用户体验 | 三种模式统一的格式化入口；降低 Markdown 记忆门槛 | 工具栏占用 ~32px 垂直空间（可折叠） |
| 代码质量 | 命令调用精确复制官方实现，减少 bug | 新增 ~5 个文件 |
| Milkdown 升级 | ~~解锁 7.21~~ 不再是前置条件 | 可独立并行推进 |
| 维护成本 | Milkdown 命令变更时有官方 TopBar 作为参照 | 需跟踪 Milkdown 升级时命令 API 变动 |
| 替代方案成本 | — | 若启用 Crepe 内置 TopBar 则省 WYSIWYG 工作，但 UI 不一致 |

---

## 实施阶段（修订）

| 阶段 | 内容 | 工期 |
|------|------|------|
| ~~0~~ | ~~前置：Milkdown 升级至 7.21~~ **二次审核删除**——7.19 已具备全部 API | — |
| 1 | `cmToolbarActions`（全部操作含改进的 wrapSelection）+ 单元测试 | 0.5 天 |
| 2 | `milkdownToolbarActions`（专用命令 + isMarkActive + 任务列表自定义）+ `WysiwygEditor` 暴露 Crepe ref | 0.5 天 |
| 3 | `FormattingToolbar` UI + `HeadingDropdown` + `TableGridPicker` + 折叠按钮 + Zustand 状态 | 1 天 |
| 4 | `MarkdownEditor` 集成 + 三模式全量测试 + 手工冒烟 | 0.5 天 |
| **合计** | | **2.5 天** |
