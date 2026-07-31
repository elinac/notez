# 自动保存开关与未保存提示 设计文档

**日期**: 2026-07-31  
**状态**: 设计已确认（含 2026-07-31 代码对照审核修订：F1–F6）  
**范围**: 设置「编辑器」分类 + 自动保存门控 + 关 tab / 退出时三选一保存提示

---

## 1. 背景与动机

### 1.1 现状

- `App.tsx` 在活动标签内容变更后 **始终** debounce 约 1s 调用自动保存（无设置门控）；且**不**预检 path，Tauri 下无 path 时会经 `saveMarkdownFileTauri` 弹出另存为。
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
| 自动保存运行环境 | **仅 Tauri 桌面端**写盘；浏览器即使开启开关也**不**跑自动保存（禁止「仅标 clean、不落盘」） |
| 批量保存正文来源 | 每个 dirty tab 使用 **`tab.content`**（非 `tab.file.content`） |
| 三按钮挂载 | App 根 `SavePromptHost` + 模块级命令式 `promptSaveChanges` Promise 队列 |
| CloseRequested | abort → `preventDefault`；proceed → **不** prevent（交给 Tauri 在 handler 结束后 `destroy`） |

### 2.1 不在范围内

- 自动保存间隔可配置
- 无 path 文件静默写入默认目录，或自动保存时弹另存为
- 原生系统三按钮对话框（Windows MessageBox 等）
- 逐文件循环弹三选一（批量场景）
- 改动 PlantUML / AI / 外观主题体系
- 浏览器端静默落盘 / 下载式自动保存

### 2.2 已知限制

1. **浏览器退出**：`beforeunload` 仅能触发系统默认「离开？」类提示，**无法**展示应用内三按钮；关 tab 仍用应用内三选一。
2. **另存为取消 / 写盘失败**：整次「保存后关闭/退出」中止；已成功保存的标签保持 clean，其余仍 dirty，不关闭、不退出。
3. **行为变更**：关 dirty tab 从「关闭=丢弃」变为「保存 | 不保存 | 取消」；与旧文案「关闭后修改将丢失」不再一致。
4. **行为变更**：自动保存从「始终开」变为「默认关」——升级后需用户在设置中手动打开才会自动写盘。
5. **浏览器自动保存**：即使设置开启，浏览器预览模式也不自动保存（见 §7.3）；避免假 clean。

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
| `App.tsx` 自动保存 effect | 仅当 **Tauri** 且 `autoSaveEnabled && 有效 path && isDirty` 时 1s debounce 直写 | settings + `saveMarkdownFileTauri` |
| 保存决策辅助 | 对 dirty 列表：清 auto-save 定时器 → 弹窗 → save/discard/cancel；顺序用 `tab.content` 保存 | 三按钮 + save API |
| `confirmAndCloseTabs` | 关 tab 前走保存决策；成功后再执行现有 close 族 | 保存决策辅助 |
| 退出拦截 | Tauri `onCloseRequested`；浏览器 `beforeunload` | 同一套保存决策（浏览器退出除外） |
| `SavePromptHost` + `promptSaveChanges` | 命令式 Promise 三按钮；Esc / 遮罩 = cancel | 挂在 `App` 根 |

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
- `persist()` 载荷必须包含该字段
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
- 说明：「开启后，**桌面端**已保存到磁盘的文件在编辑停顿约 1 秒后自动写入。新建未命名文件不会自动保存。浏览器预览模式下此选项不生效。」
- 样式对齐现有设置页（小字说明、简洁开关）

---

## 7. 交互与文案

### 7.1 关标签

触发：点 X、Ctrl+W、右键关闭 / 关闭其他 / 左 / 右 / 全部（均经 `confirmAndCloseTabs`）。

进入保存决策**之前**：

1. 清除 `App` 中 pending 的 `autoSaveTimer`（避免对话框期间或关闭后仍触发写盘）。
2. 若有进行中的自动保存写盘：等待其结束或标记 generation 使过期写回忽略（实现任选其一，不得在 tab 已关闭后 `updateTabFile`）。

| 条件 | 行为 |
|------|------|
| 目标中无 dirty | 直接关闭（逻辑不变） |
| 单 dirty | 文案：`「{标题}」有未保存的更改。是否保存？` |
| 多 dirty | 文案：`有 N 个标签有未保存的更改。是否全部保存？` |
| 按钮 | **保存** \| **不保存** \| **取消** |

- **保存**：按目标列表中 dirty tab 的顺序，对每个 tab：
  - 正文取 **`tab.content`**（**禁止**用可能滞后的 `tab.file.content`）。
  - 元数据用 `tab.file`（title / path 等）调用 `saveMarkdownFileTauri(file, tab.content)`（或抽出的等价写盘函数）。
  - 成功：`updateTabFile` 更新 path（若有）并 `isDirty: false`；可选同步 `file.content` 与 `tab.content`。
  - 有有效 path 直写；无 path 或 `path === title` 走另存为。
  - 全部成功后再执行关闭。任一另存为取消或写盘失败 → **中止关闭**；已成功者保持 clean，失败/未处理者仍 dirty；`showMessage` 提示错误。
- **不保存**：不写盘，执行关闭。
- **取消**：no-op。

确认后锚点已消失等竞态：沿用现有 `confirmCloseTabs` 快照 / no-op 约定（见标签菜单 design）。

### 7.2 退出应用

- 任意打开标签 `isDirty` 时拦截。
- 进入决策前同样：**清 auto-save timer** + 处理进行中写盘（同 §7.1）。
- 文案规则同 §7.1（按全部 dirty 的 N）。
- **保存** 全成功或不保存 → 允许退出；**取消** 或保存失败 → 留在应用。

**Tauri（`getCurrentWindow().onCloseRequested`）** — 对齐官方语义：

1. handler 内 `await` 保存决策（可先做 in-flight 锁；重复关闭在锁期间直接 `preventDefault` 并 return）。
2. **abort**（取消 / 保存失败）→ 调用 `event.preventDefault()`，窗口留下。
3. **proceed**（无 dirty、或不保存、或全部保存成功）→ **不**调用 `preventDefault`；handler 返回后由 Tauri **自动** `destroy`。
4. **不要**采用「一律先 prevent，再手动 destroy」作为默认路径（避免多余权限与双重关闭）。若实现上因特殊原因必须先 prevent，须在 capabilities 中确认 `destroy` 相关权限后再显式 `destroy`，并在实现计划中单列。

**浏览器**：有 dirty 时注册 `beforeunload`（系统默认文案）；关 tab 仍用应用内三按钮。

### 7.3 自动保存

```
content / isDirty 变化
  → isTauri() === true?
  → autoSaveEnabled === true?
  → active file tab 且有有效磁盘 path?（非空，且非 path === title）
  → debounce ~1s
  → 直写（不弹另存为）；正文用当前活动内容（与现 contentRef 一致）
  → 成功：isDirty=false；失败：console.error，保持 dirty
```

关闭开关、切到无 path 标签、非 Tauri、或 effect cleanup 时清除 pending timer。

**浏览器**：无论 `autoSaveEnabled` 为何，**不**执行自动保存分支，也**不**把 dirty 标为 clean。删除/不再沿用现有「Browser: just mark clean」路径。

---

## 8. 模块与 API 建议

### 8.1 三按钮对话框（命令式 + Host）

采用 **方案 A**：

1. 在 `App`（或根布局）挂载 `<SavePromptHost />`（样式可参照 `SettingsDialog` / FileExplorer 重命名框：遮罩 + 居中面板 + 三按钮）。
2. 模块导出：

```ts
type SavePromptChoice = 'save' | 'discard' | 'cancel';

/** 须在 SavePromptHost 已挂载后调用；排队，同时仅一个可见对话框 */
function promptSaveChanges(message: string): Promise<SavePromptChoice>;
```

3. Host 未挂载时：reject 或 resolve `'cancel'`（实现选定一种并单测）；正常路径不应发生。
4. 不复用 `confirmAction`（仅二选一）。Esc / 点遮罩 → `'cancel'`。

### 8.2 保存决策

- 辅助函数：给定 dirty **tabs**（含 id / content / file）→ `promptSaveChanges` → 若 `'save'` 则按序用 **`tab.content`** 保存 → 返回 `'proceed' | 'abort'`（`'discard'` 与全部 save 成功均为 proceed；`'cancel'` 与保存失败为 abort）。
- `confirmAndCloseTabs` 与退出拦截均调用该辅助，避免两套逻辑。
- 进入辅助前由调用方或辅助自身触发 **取消 auto-save 定时器**（见 §7.1；timer 引用需从 `App` 可访问处导出或上移到共享模块）。

### 8.3 有效 path

- 与 `saveMarkdownFileTauri` 一致：无 path 或 path 等于 title 时视为需另存为；**自动保存跳过**此类文件。

---

## 9. 错误处理

| 情况 | 处理 |
|------|------|
| 自动保存写盘失败 | 日志；保持 dirty；不弹阻塞框（避免打字时打扰） |
| 用户触发的保存（关/退出选「保存」）失败 | `showMessage`（或等价）提示；中止关闭/退出 |
| 另存为对话框取消 | 视为该次保存未完成 → 中止关闭/退出 |
| 退出决策进行中再次点关闭 | in-flight 锁：`preventDefault` 并忽略，避免双重对话框 |
| 自动保存写回时 tab 已关闭 | 忽略该次 `updateTabFile`（generation / 存在性检查） |

---

## 10. 测试要点

### 10.1 单测（优先）

- settings：默认 `autoSaveEnabled === false`；setter 进入 persist 载荷形状。
- 关 tab 决策（扩展/重写 `confirmCloseTabs` 测试，mock `promptSaveChanges` 而非仅 `confirmAction`）：无 dirty 不弹；cancel 不关；discard 关；save 成功后关；中途取消另存为 / 失败则不关且部分已 clean。
- 批量：一次对话框；保存时断言传入的是 **`tab.content`**，且顺序覆盖有 path + 无 path。
- 自动保存门控：关 → 不调用 save；开 + 无 path → 不调用；开 + 有 path + dirty + Tauri → fake timer 后调用；**非 Tauri 即使开启也不调用 / 不标 clean**。
- `promptSaveChanges`：Host 挂载后 resolve 三选一；排队行为（可选）。

### 10.2 手工（桌面）

- 默认关；打开后已落盘文件停顿约 1s 落盘；无标题不落盘。
- 关 dirty tab / 关全部 / Ctrl+W / 退出：三按钮各路径。
- 只读路径等保存失败时不退出、不关 tab。
- 编辑中打开关闭确认时，不应再弹出自动另存为或关后写盘。

### 10.3 不测

- 不为 `beforeunload` 写脆弱 E2E。
- 不测原生系统三按钮。

---

## 11. 与既有文档关系

- **取代** `2026-07-29-tab-context-menu-design.md` §2.1 / §2.2 中「无应用退出 dirty 拦截」「Dirty 为丢弃确认」的**产品结论**（该文档历史决策保留；**实现以本文为准**）。
- 关闭目标集合算法（`tabCloseTargets`）不变；仅替换确认/保存步骤。

---

## 12. 审核修订记录（2026-07-31）

对照工程代码审核后采纳：

| ID | 修订 |
|----|------|
| F1 | 明确批量/退出保存使用 `tab.content` |
| F2 | CloseRequested：abort 才 `preventDefault`；proceed 不 prevent |
| F3 | `SavePromptHost` + 命令式 `promptSaveChanges` 队列 |
| F4 | 自动保存仅 Tauri；禁止浏览器假 clean；设置文案标明桌面端 |
| F5 | 关/退出前清 timer；进行中写盘与关闭串行/忽略过期写回 |
| F6 | 默认不显式 `destroy`；特殊路径才核 capabilities |
