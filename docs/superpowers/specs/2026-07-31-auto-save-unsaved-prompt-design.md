# 自动保存开关与未保存提示 设计文档

**日期**: 2026-07-31  
**状态**: 设计已确认  
**范围**: 设置「编辑器」分类 + 自动保存门控 + 关 tab / 退出时三选一保存提示

---

## 1. 背景与动机

### 1.1 现状

- `App.tsx` 在活动标签内容变更后 **始终** debounce 约 1s 调用自动保存（无设置门控）。
- 关 dirty 标签经 `confirmAndCloseTabs`（`src/utils/confirmCloseTabs.ts`）走 `confirmAction`：**关闭 | 取消**（丢弃确认），不是「是否保存」。
- 点 X、Ctrl+W、标签右键关闭族共用该入口（见 `2026-07-29-tab-context-menu-design.md`）。
- **无** 应用退出前的 dirty 拦截（无 `CloseRequested` / 有效的「保存再退出」流）。
- 设置分类现为：外观 / AI / PlantUML / 关于（`settingsTypes.ts`）。

### 1.2 目标

1. 设置中增加「自动保存」，**默认关**；仅开启后才自动写盘。
2. 关闭含未保存更改的标签时，提示 **保存 | 不保存 | 取消**。
3. 退出应用时若有未保存文件，同样提示；保存成功或不保存后才退出。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 关闭 / 退出对话框 | **三选一**：保存 / 不保存 / 取消 |
| 多 dirty（批量关或退出） | **一次**提示「有 N 个…」；保存则全部按序保存，不保存则全部丢弃，取消则中止 |
| 无 path 的新建标签 | **不**自动保存；手动另存为拿到 path 后才参与自动保存 |
| 设置位置 | **新增「编辑器」分类**，放自动保存开关 |
| 实现方案 | **方案 1**：设置门控 + **应用内**三按钮对话框；退出用 Tauri `CloseRequested` + 浏览器 `beforeunload` |
| 自动保存 debounce | 保持现有约 **1s**（本需求不做成可配置） |

### 2.1 不在范围内

- 自动保存间隔可配置
- 无 path 文件静默写入默认目录，或自动保存时弹另存为
- 原生系统三按钮对话框（Windows MessageBox 等）
- 逐文件循环弹三选一（批量场景）
- 改动 PlantUML / AI / 外观主题体系

### 2.2 已知限制

1. **浏览器退出**：`beforeunload` 仅能触发系统默认「离开？」类提示，**无法**展示应用内三按钮；关 tab 仍用应用内三选一。
2. **另存为取消 / 写盘失败**：整次「保存后关闭/退出」中止；已成功保存的标签保持 clean，其余仍 dirty，不关闭、不退出。
3. **行为变更**：关 dirty tab 从「关闭=丢弃」变为「保存 | 不保存 | 取消」；与旧文案「关闭后修改将丢失」不再一致。
4. **行为变更**：自动保存从「始终开」变为「默认关」——升级后需用户在设置中手动打开才会自动写盘。

---

## 3. 方案选择

| 方案 | 描述 | 评价 |
|------|------|------|
| **1（采用）** | `autoSaveEnabled` 门控现有 debounce；应用内三按钮；`confirmCloseTabs` 扩展为保存/丢弃；退出拦截共用决策逻辑 | 跨平台一致、三按钮可控、改动集中 |
| 2 | 同上，但三按钮走原生系统对话框 | 更「原生」，实现与测试成本高，浏览器仍需 fallback |
| 3 | 仅门控自动保存，关闭维持二选一丢弃确认 | 不满足「是否保存」 |

---

## 4. 架构与边界

| 单元 | 职责 | 依赖 |
|------|------|------|
| `useSettingsStore` | 持久化 `autoSaveEnabled`（默认 `false`） | 现有 settings.json / localStorage |
| 设置「编辑器」页 | 开关 UI + 说明文案 | settings store |
| `App.tsx` 自动保存 effect | 仅当 `autoSaveEnabled && 有效 path && isDirty` 时 1s debounce 写盘 | settings + `saveMarkdownFileTauri` |
| 保存决策辅助（建议抽自 `confirmCloseTabs` 旁） | 对 dirty 列表：弹窗 → save/discard/cancel；顺序保存 | 三按钮对话框 + save API |
| `confirmAndCloseTabs` | 关 tab 前走保存决策；成功后再执行现有 close 族 | 保存决策辅助 |
| 退出拦截 | Tauri `CloseRequested`；浏览器 `beforeunload` | 同一套保存决策（浏览器退出除外） |
| 应用内三按钮对话框 | 返回 `'save' \| 'discard' \| 'cancel'` | React UI，不依赖 plugin-dialog 的 `ask` |

---

## 5. 数据模型与持久化

### 5.1 Store 字段

在 `useSettingsStore` 增加：

| 项 | 约定 |
|----|------|
| 字段 | `autoSaveEnabled: boolean` |
| 默认 | `false` |
| Setter | `setAutoSaveEnabled(enabled: boolean)`：`set` 后立即 `persist`（与多数开关类设置一致） |

### 5.2 持久化

- 扩展 `PersistedSettings`：`autoSaveEnabled?: boolean`
- `initSettings`：缺省 / 非法 → `false`
- 存储路径不变：Tauri `<appLocalDataDir>/settings.json` / 浏览器 `localStorage`（`notez-settings`）
- **升级兼容**：旧配置无此字段 → `false`（自动保存关闭，符合「默认关」；与升级前「始终自动保存」行为不同，见 §2.2）

---

## 6. 设置 UI

### 6.1 分类

- `SettingsCategory` 增加 `'editor'`
- `CATEGORY_LABELS.editor = '编辑器'`
- `SettingsSidebar` / `SettingsDialog` 增加该分类与内容面板

### 6.2 控件

新建例如 `EditorSettings.tsx`：

- 开关：「自动保存」
- 说明：「开启后，已保存到磁盘的文件在编辑停顿约 1 秒后自动写入。新建未命名文件不会自动保存。」
- 样式对齐现有设置页（小字说明、简洁开关）

---

## 7. 交互与文案

### 7.1 关标签

触发：点 X、Ctrl+W、右键关闭 / 关闭其他 / 左 / 右 / 全部（均经 `confirmAndCloseTabs`）。

| 条件 | 行为 |
|------|------|
| 目标中无 dirty | 直接关闭（逻辑不变） |
| 单 dirty | 文案：`「{标题}」有未保存的更改。是否保存？` |
| 多 dirty | 文案：`有 N 个标签有未保存的更改。是否全部保存？` |
| 按钮 | **保存** \| **不保存** \| **取消** |

- **保存**：按目标列表顺序保存；有 path 直写；无 path 走现有另存为（`saveMarkdownFileTauri`）。全部成功后再执行关闭。任一另存为取消或写盘失败 → **中止关闭**；已成功者保持 `isDirty=false`，失败/未处理者仍 dirty；可用 `showMessage` 提示错误。
- **不保存**：不写盘，执行关闭。
- **取消**：no-op。

确认后锚点已消失等竞态：沿用现有 `confirmCloseTabs` 快照 / no-op 约定（见标签菜单 design）。

### 7.2 退出应用

- 任意打开标签 `isDirty` 时拦截。
- 文案规则同 §7.1（按全部 dirty 的 N）。
- **保存** 全成功或不保存 → 允许退出；**取消** 或保存失败 → 留在应用。

**Tauri**：监听窗口 `CloseRequested`，先 `preventDefault`，跑决策；仅允许退出时再 `destroy` / 等价退出。

**浏览器**：有 dirty 时注册 `beforeunload`（系统默认文案）；关 tab 仍用应用内三按钮。

### 7.3 自动保存

```
content / isDirty 变化
  → autoSaveEnabled === true?
  → active file tab 且有有效磁盘 path?（非空，且非「仅 title」占位）
  → debounce ~1s
  → 直写（不弹另存为）
  → 成功：isDirty=false；失败：console.error，保持 dirty
```

关闭开关、切到无 path 标签、或 effect cleanup 时清除 pending timer。

浏览器模式下现有 auto-save 会「仅标 clean、不下载」——门控关闭后默认不再发生；开启后门控行为保持与现实现一致（本需求不单独重做浏览器落盘）。

---

## 8. 模块与 API 建议

### 8.1 三按钮对话框

- 新增应用内模态（可放 `src/utils/` 旁组件或 `src/components/`），API 形如：

```ts
type SavePromptChoice = 'save' | 'discard' | 'cancel';

function promptSaveChanges(message: string): Promise<SavePromptChoice>;
```

- 不复用 `confirmAction`（仅二选一）。Esc / 点遮罩视为 `cancel`（与「取消」一致）。

### 8.2 保存决策

- 建议纯/半纯辅助：给定 dirty tab 列表 → `promptSaveChanges` → 顺序调用现有 save → 返回 `'proceed' | 'abort'`（proceed 含 discard 与全部 save 成功）。
- `confirmAndCloseTabs` 与退出拦截均调用该辅助，避免两套逻辑。

### 8.3 有效 path

- 与 `saveMarkdownFileTauri` 一致：无 path 或 path 等于 title 时视为需另存为；**自动保存跳过**此类文件。

---

## 9. 错误处理

| 情况 | 处理 |
|------|------|
| 自动保存写盘失败 | 日志；保持 dirty；不弹阻塞框（避免打字时打扰） |
| 用户触发的保存（关/退出选「保存」）失败 | `showMessage`（或等价）提示；中止关闭/退出 |
| 另存为对话框取消 | 视为该次保存未完成 → 中止关闭/退出 |
| 退出决策进行中再次点关闭 | 应忽略重复 CloseRequested 或串行化，避免双重对话框（实现时用 in-flight 锁） |

---

## 10. 测试要点

### 10.1 单测（优先）

- settings：默认 `autoSaveEnabled === false`；setter 进入 persist 载荷形状。
- 关 tab 决策（扩展 `confirmCloseTabs` 测试）：无 dirty 不弹；cancel 不关；discard 关；save 成功后关；中途取消另存为 / 失败则不关且部分已 clean。
- 批量：一次对话框；保存顺序覆盖有 path + 无 path。
- 自动保存门控：关 → 不调用 save；开 + 无 path → 不调用；开 + 有 path + dirty → fake timer 后调用。

### 10.2 手工（桌面）

- 默认关；打开后已落盘文件停顿约 1s 落盘；无标题不落盘。
- 关 dirty tab / 关全部 / Ctrl+W / 退出：三按钮各路径。
- 只读路径等保存失败时不退出、不关 tab。

### 10.3 不测

- 不为 `beforeunload` 写脆弱 E2E。
- 不测原生系统三按钮。

---

## 11. 与既有文档关系

- **取代** `2026-07-29-tab-context-menu-design.md` §2.1 / §2.2 中「无应用退出 dirty 拦截」「Dirty 为丢弃确认」的**产品结论**（该文档历史决策保留；**实现以本文为准**）。
- 关闭目标集合算法（`tabCloseTargets`）不变；仅替换确认/保存步骤。
