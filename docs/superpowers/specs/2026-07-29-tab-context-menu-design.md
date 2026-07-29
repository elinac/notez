# 标签栏右键菜单 — 关闭其他 / 左 / 右 / 全部

> **日期**: 2026-07-29  
> **状态**: 设计已确认（含代码/API 审核修订）  
> **类型**: 功能设计 spec  
> **修订**: 2026-07-29 — 审核采纳：`confirmAction`、`syncActive`、快捷键范围澄清、关闭目标纯函数、行为变更与已知限制

---

## 1. 背景与动机

### 1.1 现状

`TabBar`（`src/components/TabBar.tsx`）支持单击切换与 X 关闭；关闭逻辑在 `useAppStore.closeTab`。仅剩一个标签时不可关闭。文件树（`FileExplorer`）已有固定定位的右键菜单可作 UI 参考。应用 chrome 通过 `nativeChrome.ts` 抑制系统默认右键菜单。确认对话框已有 `src/utils/nativeDialog.ts` 的 `confirmAction`（Tauri 下走 `@tauri-apps/plugin-dialog` 的 `ask`，浏览器回退 `window.confirm`）。

**缺口**：无法一键关闭其他标签、关闭左侧/右侧标签或关闭全部。

### 1.2 目标

在标签上右键弹出菜单，支持：关闭、关闭其他、关闭左侧、关闭右侧、关闭全部。行为与常见编辑器一致，并与现有「至少保留一个标签」约束对齐。

---

## 2. 需求决策（brainstorming 结论）

| 决策点 | 结论 |
|--------|------|
| 菜单项 | **C** — 关闭 + 关闭其他 + 关闭左侧 + 关闭右侧 + 关闭全部 |
| 关闭全部 | **A** — 关光后 `createNewFile()` 新建未命名标签（与 Ctrl+N 相同，非空串） |
| Dirty 处理 | **B** — 将关闭集合中 dirty 数 > 0 时 **`await confirmAction` 一次**（不用裸 `window.confirm`） |
| 右键非当前标签 | **A** — 不先切换；操作针对被右键的锚点标签 |
| 实现方案 | **方案 1** — Store 批量关闭 API + TabBar 内联菜单（不抽公共组件） |
| 既有关闭入口 | **行为变更：是** — 点 X、菜单「关闭」、**现有 Ctrl+W** 共用 dirty 确认 |
| 快捷键范围 | **不新增快捷键**；**纳入并改动现有 Ctrl+W**（`App.tsx`） |

### 2.1 不在范围内

- 固定标签 / 关闭未固定、中键关闭
- **新增**快捷键绑定（现有 Ctrl+W 除外，见上表）
- 逐文件「保存 / 丢弃 / 取消」对话框
- 抽取共享 `ChromeContextMenu` 或改动 `FileExplorer` 菜单实现
- 改动 Rust / Tauri 侧（继续使用已注册的 dialog 插件）

### 2.2 已知限制

1. **关闭全部 + 无 dirty**：若仅有一个已保存（或未脏）标签，点「关闭全部」**不会**弹确认，直接换成新建未命名标签（当前打开的文件从标签栏消失）。这是「关全部」语义，非 bug。
2. **无应用退出前 dirty 拦截**：本需求不增加 `beforeunload` / 窗口关闭确认。

---

## 3. 方案选择

| 方案 | 描述 | 评价 |
|------|------|------|
| **1（采用）** | Store 增加 `closeOtherTabs` / `closeTabsToLeft` / `closeTabsToRight` / `closeAllTabs`；关闭目标纯函数 + TabBar 内联菜单 + `confirmAction` | 改动面小，语义集中在 store，与现有模式一致 |
| 2 | 仅暴露 `closeTabsByIds`；四类操作在 UI 派生 | Store 更瘦，但保底标签与 active / `syncActive` 逻辑易散落 UI |
| 3 | 方案 1 + 抽公共菜单组件 | 过重，本需求不值得动 FileExplorer |

---

## 4. 设计

### 4.1 菜单 UI

- 触发：标签项 `onContextMenu`；`preventDefault`；记录 `{ x, y, tabId }`。
- **不**在打开菜单时 `switchTab`。
- 项顺序：
  1. 关闭
  2. 关闭其他
  3. 关闭左侧
  4. 关闭右侧
  5. 分隔线
  6. 关闭全部
- 样式对齐文件树：`fixed`、`z-50`、`notez-panel`、`border`、`rounded`、`shadow-lg`、`text-xs`；根节点带 `data-native-context-menu`。
- 禁用项：灰显（如 `opacity-40` + `pointer-events-none` 或 `disabled`），**不隐藏**。
- 关闭菜单：点击外部、Escape、选中任一可执行项后。

#### 禁用规则（灰显，不隐藏）

| 项 | 禁用条件 |
|----|----------|
| 关闭 | `tabs.length === 1` |
| 关闭其他 | `tabs.length === 1` |
| 关闭左侧 | 锚点已是最左（index === 0） |
| 关闭右侧 | 锚点已是最右（index === tabs.length - 1） |
| 关闭全部 | 永不禁用 |

### 4.2 关闭目标纯函数

新增模块（建议路径：`src/utils/tabCloseTargets.ts`），供 UI 统计 dirty 与（可选）store 共用，避免两套规则分叉。

```ts
type TabCloseAction = 'close' | 'others' | 'left' | 'right' | 'all';

/** 返回将被关闭的 tab id 列表（不含保留的锚点；`all` 为全部现有 id） */
function getCloseTargetIds(
  tabs: EditorTab[],
  action: TabCloseAction,
  anchorTabId: string,
): string[]
```

规则：

| action | 目标 |
|--------|------|
| `close` | `[anchorTabId]`（若存在） |
| `others` | 除锚点外全部 |
| `left` | 锚点左侧（index &lt; 锚点 index） |
| `right` | 锚点右侧 |
| `all` | 当前全部 tab id |

锚点不存在时返回 `[]`。

另可提供：`countDirtyInTargets(tabs, ids) -> number`（`isFileTab(t) && t.file.isDirty`）。

### 4.3 Store API

在 `useAppStore` 新增（除 `closeAllTabs` 外，参数均为**锚点** `tabId`）：

| Action | 行为 |
|--------|------|
| `closeOtherTabs(tabId)` | 只保留锚点；`activeTabId = tabId` |
| `closeTabsToLeft(tabId)` | 移除锚点左侧全部 |
| `closeTabsToRight(tabId)` | 移除锚点右侧全部 |
| `closeAllTabs()` | 清空后创建与 Ctrl+N 相同的新建标签；`activeTabId` 指向新标签 |

现有 `closeTab(tabId)` 保留；单关仍走它。

**Active 规则（左/右）**：若关前 `activeTabId` 落在被移除集合中，则切到锚点；否则不变。`closeOtherTabs` 始终 `activeTabId = tabId`。

**镜像字段（必须）**：设定新 `activeTabId` 后，必须像 `closeTab` / `switchTab` 一样展开 `syncActive(newTabs, newActiveTabId, …)`，同步更新 `currentFile` 与 `content`。否则编辑器会显示陈旧内容。

**`closeAllTabs` 新建标签构造**（对齐 `openTab` / 初始 tab）：

```ts
const file = createNewFile(); // title「无标题」+ 默认 Markdown 模板，isDirty: false
const newTab: FileEditorTab = {
  kind: 'file',
  id: file.path ?? `tab-${Date.now()}`,
  file,
  content: file.content,
};
// tabs: [newTab], activeTabId: newTab.id, ...syncActive(...), splitPaneRatioByTabId: {}
```

**附属清理**：对被移除的每个 tab id，用现有 `removeTabSplitRatio` 迭代清理 `splitPaneRatioByTabId`（`closeAllTabs` 直接置 `{}` 亦可）。

**边界**：锚点不存在时 no-op；`closeOtherTabs` / 左 / 右在无可关目标时 no-op（UI 已禁用，store 仍应防御）。Store **不**调用 `confirmAction`。

### 4.4 Dirty 确认（UI 层，async）

- 确认发生在调用 store **之前**；store 不感知 confirm。
- 用 `getCloseTargetIds` 得到将关闭集合，再算 dirty 数 `N`。
- `N > 0` 时：

```ts
const ok = await confirmAction(
  `有 ${N} 个未保存的标签，关闭后修改将丢失。确定关闭？`,
  { okLabel: '关闭', cancelLabel: '取消' },
);
```

（`confirmAction` 在 Tauri 下已带 `kind: 'warning'` 与标题默认 `NoteZ`，见 `nativeDialog.ts`。）

- 取消 / `ok === false`：不修改 tabs；关闭菜单。
- 确定或 `N === 0`：执行对应 store action。
- **共用入口**：点 X、菜单「关闭」、**现有 Ctrl+W**（`App.tsx`）均走同一 async 辅助函数（例如 `confirmAndCloseTabs(action, anchorId)`），内部：算目标 → `confirmAction`（若需）→ 调 store。**确认逻辑不进 store action 本体**。
- 本阶段不做逐文件保存对话框。

「关闭全部」在仅 1 个且 dirty 时：先确认，再关光并按 §4.3 新建标签。

### 4.5 数据流（简述）

```
右键标签 → 打开菜单（锚点 tabId）
  → 用户点菜单项
  → getCloseTargetIds(...)
  → 若 dirtyCount > 0 且 await confirmAction 为 false → 结束
  → 调用对应 store action（含 syncActive）
  → 关闭菜单
```

---

## 5. 测试计划

### 5.1 纯函数（`tabCloseTargets`）

- 各 `action` + 锚点位置的目标 id 集合。
- 锚点无效 → `[]`。
- `countDirtyInTargets` 只计 `isDirty` 的 file tab。

### 5.2 Store（Vitest，建议文件 `src/store/__tests__/tabCloseActions.test.ts`）

参考 `ephemeralWorkspace.test.ts` 的 `setState` / `getState` 写法。

- `closeOtherTabs`：只剩锚点；`activeTabId` 为锚点；`currentFile`/`content` 与锚点一致；已删 tab 的 split ratio 清除。
- `closeTabsToLeft` / `closeTabsToRight`：边界与中间 index；active 在被关集合内外；镜像字段正确。
- `closeAllTabs`：恰好 1 个新建标签；`content`/`currentFile` 对齐新 tab；旧 split ratio 清空。
- 锚点无效：no-op。

### 5.3 TabBar / 确认（可选轻量）

- 最左/最右：对应项禁用。
- 仅 1 个标签：「关闭」「关闭其他」禁用；「关闭全部」可点。
- **mock `confirmAction`**（非裸 `window.confirm`）返回 `false`：tabs 不变。

---

## 6. 成功标准

1. 右键任意标签可打开菜单，且不强制切换当前标签。
2. 五项关闭行为符合 §4.3；关闭全部后始终有且仅有一个与 `createNewFile()` 等价的新建标签，且 `currentFile`/`content` 已同步。
3. 批量或单关涉及 dirty 时经 `confirmAction` 一次确认；取消则无变更。
4. X、菜单「关闭」、现有 Ctrl+W 对 dirty 的确认行为一致。
5. `tabCloseTargets` 与 store 相关单测通过。
`}