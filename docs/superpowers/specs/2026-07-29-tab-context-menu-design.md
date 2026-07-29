# 标签栏右键菜单 — 关闭其他 / 左 / 右 / 全部

> **日期**: 2026-07-29  
> **状态**: 设计已确认  
> **类型**: 功能设计 spec

---

## 1. 背景与动机

### 1.1 现状

`TabBar`（`src/components/TabBar.tsx`）支持单击切换与 X 关闭；关闭逻辑在 `useAppStore.closeTab`。仅剩一个标签时不可关闭。文件树（`FileExplorer`）已有固定定位的右键菜单可作 UI 参考。应用 chrome 通过 `nativeChrome.ts` 抑制系统默认右键菜单。

**缺口**：无法一键关闭其他标签、关闭左侧/右侧标签或关闭全部。

### 1.2 目标

在标签上右键弹出菜单，支持：关闭、关闭其他、关闭左侧、关闭右侧、关闭全部。行为与常见编辑器一致，并与现有「至少保留一个标签」约束对齐。

---

## 2. 需求决策（brainstorming 结论）

| 决策点 | 结论 |
|--------|------|
| 菜单项 | **C** — 关闭 + 关闭其他 + 关闭左侧 + 关闭右侧 + 关闭全部 |
| 关闭全部 | **A** — 关光后 `createNewFile()` 新建空白标签 |
| Dirty 处理 | **B** — 将关闭集合中 dirty 数 > 0 时 `window.confirm` 一次 |
| 右键非当前标签 | **A** — 不先切换；操作针对被右键的锚点标签 |
| 实现方案 | **方案 1** — Store 批量关闭 API + TabBar 内联菜单（不抽公共组件） |

### 2.1 不在范围内

- 固定标签 / 关闭未固定、中键关闭、快捷键绑定
- 逐文件「保存 / 丢弃 / 取消」对话框
- 抽取共享 `ChromeContextMenu` 或改动 `FileExplorer`
- 改动 Rust / Tauri 侧

---

## 3. 方案选择

| 方案 | 描述 | 评价 |
|------|------|------|
| **1（采用）** | Store 增加 `closeOtherTabs` / `closeTabsToLeft` / `closeTabsToRight` / `closeAllTabs`；TabBar 内联菜单 + dirty 确认 | 改动面小，语义集中在 store，与现有模式一致 |
| 2 | 仅暴露 `closeTabsByIds`；四类操作在 UI 派生 | Store 更瘦，但保底标签与 active 逻辑易散落 UI |
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
- 关闭菜单：点击外部、Escape、选中任一可执行项后。

#### 禁用规则（灰显，不隐藏）

| 项 | 禁用条件 |
|----|----------|
| 关闭 | `tabs.length === 1` |
| 关闭其他 | `tabs.length === 1` |
| 关闭左侧 | 锚点已是最左（index === 0） |
| 关闭右侧 | 锚点已是最右（index === tabs.length - 1） |
| 关闭全部 | 永不禁用 |

### 4.2 Store API

在 `useAppStore` 新增（参数均为**锚点** `tabId`）：

| Action | 行为 |
|--------|------|
| `closeOtherTabs(tabId)` | 只保留锚点；`activeTabId = tabId` |
| `closeTabsToLeft(tabId)` | 移除锚点左侧全部 |
| `closeTabsToRight(tabId)` | 移除锚点右侧全部 |
| `closeAllTabs()` | 清空后创建空白 `FileEditorTab`（`createNewFile()`）；`activeTabId` 指向新标签 |

现有 `closeTab(tabId)` 保留；单关仍走它。

**Active 规则（左/右）**：若关前 `activeTabId` 落在被移除集合中，则切到锚点；否则不变。

**附属清理**：每移除一个标签，同步从 `splitPaneRatioByTabId` 删除对应条目（与 `closeTab` 一致）。

**边界**：锚点不存在时 no-op；`closeOtherTabs` / 左 / 右在无可关目标时 no-op（UI 已禁用，store 仍应防御）。

### 4.3 Dirty 确认（UI 层）

- 确认发生在调用 store **之前**；store 不感知 confirm。
- 将关闭集合中 `isFileTab(t) && t.file.isDirty` 的数量为 `N`；`N > 0` 时：

  > 有 N 个未保存的标签，关闭后修改将丢失。确定关闭？

- 取消：不修改 tabs；关闭菜单。
- 确定或 `N === 0`：执行对应 action。
- **点 X 关闭**、菜单「关闭」、以及应用内其它直接关单标签的入口（如 `App.tsx` 快捷键调 `closeTab`）共用同一确认辅助函数（单标签 dirty 时 `N=1`），避免关闭入口行为不一致。辅助函数可放在 `TabBar` 旁的小模块或 `useAppStore` 同目录的纯函数中，供多处调用；**确认逻辑不进 store action 本体**。
- 本阶段不做逐文件保存对话框。

「关闭全部」在仅 1 个且 dirty 时：先确认，再关光并新建空白标签。

### 4.4 数据流（简述）

```
右键标签 → 打开菜单（锚点 tabId）
  → 用户点菜单项
  → 计算将关闭的 tab 集合
  → 若 dirtyCount > 0 且用户取消 → 结束
  → 调用对应 store action
  → 关闭菜单
```

---

## 5. 测试计划

### 5.1 Store（Vitest，优先）

- `closeOtherTabs`：只剩锚点；active 为锚点；split ratio 仅保留锚点相关（或清空已删项）。
- `closeTabsToLeft` / `closeTabsToRight`：边界 index、中间 index；active 在被关集合内外两种情况。
- `closeAllTabs`：结果恰好 1 个空白标签；active 为新 id；旧 split ratio 清空。
- 锚点无效：no-op。

### 5.2 TabBar（可选轻量）

- 最左/最右：对应「关闭左侧/右侧」禁用。
- 仅 1 个标签：「关闭」「关闭其他」禁用；「关闭全部」可点。
- `window.confirm` mock 返回 false：tabs 不变。

---

## 6. 成功标准

1. 右键任意标签可打开菜单，且不强制切换当前标签。
2. 五项关闭行为符合 §4.2；关闭全部后始终有且仅有一个新空白标签。
3. 批量或单关涉及 dirty 时一次确认；取消则无变更。
4. X、菜单「关闭」、快捷键关单标签对 dirty 的确认行为一致。
5. 相关 store 单测通过。
`}