# 全屏（WYSIWYG）内容宽度百分比 设计文档

**日期**: 2026-07-31  
**状态**: Draft（已按 2026-07-31 方案审核修订）  
**范围**: 外观设置新增项 + WYSIWYG 正文列宽 CSS 变量

---

## 1. 目标

在设置「外观」中增加控件，控制**全屏（WYSIWYG）模式**下正文内容区相对 **WYSIWYG 编辑区**（`.wysiwyg-editor` / `.milkdown` 宽度，非 `window`）的宽度百分比，正文居中、两侧留白，以改善宽屏阅读体验。

### 非目标

- 不改变源码模式、分屏模式或分屏右侧预览的宽度
- 不涉及操作系统窗口全屏
- 不引入像素级最大宽度钳制（如 `max(80%, 900px)`）
- 不新建设置分类；不改 PlantUML / AI / 主题体系
- 不依赖 Crepe JS API 配置列宽（官方 `CrepeFeatureConfig` 无 content/reading width；以 CSS 覆盖为准）

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 作用范围 | 仅全屏（WYSIWYG / Milkdown Crepe） |
| 控件 | 滑块（`range`）+ 旁侧百分比数字 |
| 范围 | 整数 **50–100**（含端点） |
| 默认 | **100**（与升级前「满宽 + 主题边距」观感对齐，避免缺省收窄） |
| 步进 | **1** |
| 实现路径 | CSS 变量覆盖 Crepe 水平 padding（策略 A，见 §5.3）；`N=100` 还原 `120px` |
| UI 即时性 | 拖动中立刻更新 store → CSS；设置模态可能挡住预览，关闭后可见，不做设置内嵌预览 |
| 持久化时机 | **拖动中不写盘**；松手（`change`）或 debounce（约 300ms）后再 `persist` |

---

## 3. 数据模型与持久化

### 3.1 Store 字段

在 `useSettingsStore`（`src/store/useSettingsStore.ts`）增加：

| 项 | 约定 |
|----|------|
| 字段 | `wysiwygContentWidthPercent: number` |
| Setter（内存） | `setWysiwygContentWidthPercent(n: number)`：归一化后 `set`，**默认不**调用 `persist` |
| 持久化 | `persistWysiwygContentWidthPercent()` 或 setter 可选参数 `{ persist?: boolean }`；UI 在松手 / debounce 结束时触发 |
| 归一化 | `Math.round` 后 clamp 到 `[50, 100]`；非法/非有限数字 → 默认 **100** |
| 默认值 | `100` |

### 3.2 常量

新增（建议路径 `src/constants/wysiwygContentWidth.ts`，与 `fontDefaults` 风格一致）：

- `WYSIWYG_CONTENT_WIDTH_MIN = 50`
- `WYSIWYG_CONTENT_WIDTH_MAX = 100`
- `WYSIWYG_CONTENT_WIDTH_DEFAULT = 100`

必须导出 `normalizeWysiwygContentWidthPercent(raw: unknown): number`，供 setter 与 `initSettings` 共用。

### 3.3 持久化

- 扩展 `PersistedSettings`：可选字段 `wysiwygContentWidthPercent?: number`
- 正式落盘时由 `persist()` 写入该字段（与其它设置同一 `settings.json` 载荷）
- `initSettings`：缺省或非法 → `WYSIWYG_CONTENT_WIDTH_DEFAULT`（100）；合法则归一化后恢复
- 存储路径不变：Tauri `<appData>/settings.json` / 浏览器 `localStorage`
- **升级兼容**：旧配置无此字段 → 100，视觉与升级前一致（仍受 Crepe 主题垂直 padding 等既有样式影响，但不因本功能默认收窄）

---

## 4. 设置 UI

### 4.1 位置

`AppearanceSettings`（`src/components/settings/AppearanceSettings.tsx`）：

- 放在「文档主题」及其说明文案（「主要作用于全屏（WYSIWYG）模式」）**之后**、「代码块语法高亮」**之前**

### 4.2 控件规格

- 标签：**全屏内容宽度**
- `<input type="range" min={50} max={100} step={1} />`
- 右侧只读展示：`{value}%`
- **拖动中**（`input`）：只调 `setWysiwygContentWidthPercent`（内存 + CSS），不写盘
- **松手**（`change`）或 debounce ≈300ms：触发持久化
- 辅助说明（`text-[10px] text-gray-400`）：仅作用于全屏（WYSIWYG）模式；源码/分屏不受影响。百分比相对编辑区宽度；小于 100% 时两侧留白由本设置控制（覆盖主题水平 padding）
- 视觉：与现有外观项一致（`text-xs`、适度 `max-w`），不引入新设计语言

---

## 5. 样式生效

### 5.1 数据流

```
AppearanceSettings 滑块
  →（input）setWysiwygContentWidthPercent → store（内存）
  → WysiwygEditor 订阅 → --notez-wysiwyg-pad-inline
  → App.css 覆盖 .ProseMirror 水平 padding
  →（change / debounce）persist → settings.json
```

### 5.2 WysiwygEditor

按 §5.3 计算 `padInline`，注入根节点 style：

```ts
{
  '--notez-wysiwyg-pad-inline': padInline,
}
```

从 `useSettingsStore` 订阅 `wysiwygContentWidthPercent`。宽度变化**不得**加入父级 `key={...}`（当前含 `editorThemeId` / `effectiveColorMode` / `codeBlockThemeId`），避免 Crepe remount。
### 5.3 App.css（策略 A：覆盖 Crepe 水平 padding）

**背景（工程证据）**：`@milkdown/crepe` 主题 `common/reset.css` 为：

```css
.milkdown .ProseMirror {
  padding: 60px 120px;
}
```

主题**无** ProseMirror `max-width`。若只加 `max-width` 而保留 `120px` 水平 padding，百分比与固定边距会双重压缩（窄窗 + 50% 时尤甚）。故采用策略 A：用水平 padding 塑造「内容约占编辑区 N%」，并**覆盖**主题水平 `120px`；垂直 padding 保持 `60px`。

**实现约定（唯一）** — 在 `box-sizing: border-box` 且 `width: 100%` 下，侧边距承担「收窄」：

| `N` | `width` | `padding-inline` | 内容区约占比 |
|-----|---------|------------------|--------------|
| `100` | `100%` | `120px` | 与 Crepe reset 一致（升级无视觉回归） |
| `< 100` | `100%` | `max(24px, calc((100% - N%) / 2))` | ≈ `N%`（百分比相对 containing block，即 `.milkdown` 宽） |

`WysiwygEditor` 按当前 `N` 注入：

- `--notez-wysiwyg-content-width: N`（纯数字，供说明/调试；可选）
- `--notez-wysiwyg-pad-inline`：`N === 100` → `120px`；否则 → `max(24px, calc((100% - N%) / 2))`（由 React 写成最终可用的 CSS 值，或写入 `N` 后由下方公式计算）

推荐由 React 直接算出 pad 字符串，避免双变量歧义：

```ts
const padInline =
  wysiwygContentWidthPercent >= 100
    ? '120px'
    : `max(24px, calc((100% - ${wysiwygContentWidthPercent}%) / 2))`;
// style: { '--notez-wysiwyg-pad-inline': padInline }
```

`App.css`（选择器须高于 `.milkdown .ProseMirror`；保留既有 `font-size` 规则）：

```css
.wysiwyg-editor .milkdown .ProseMirror {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding-top: 60px;
  padding-bottom: 60px;
  padding-inline: var(--notez-wysiwyg-pad-inline, 120px);
}
```

不设 `margin-inline: auto` + 缩小 `width`：在 border-box 下会与大 padding 叠算，导致实际正文远窄于标称 `N%`。
### 5.4 边界行为

- 不额外做「最大 px」钳制
- 图表、代码块随正文列宽；横向溢出沿用现有滚动逻辑
- 窄窗（约 800px 宽）+ 50%：须可读、无异常整页横向滚动（见 §6.2）

---

## 6. 测试与验收

### 6.1 自动化（轻量）

- Store / normalize：clamp（如 49→50、101→100、80.6→81）；非法 → 100
- 加载：缺省字段 → **100**；已存合法值 → 恢复
- 持久化：连续多次仅内存更新时不应每次写盘；松手 / debounce 后载荷含正确百分比
- UI：可选；以 store 单测为主

### 6.2 手动验收

1. 设置 → 外观 → 拖「全屏内容宽度」，关闭对话框后 WYSIWYG 正文变窄/变宽且居中
2. 切换源码 / 分屏，布局无变化
3. 重启应用后百分比保持
4. **新装 / 无该字段的旧配置**：打开全屏，水平边距与升级前 Crepe 主题一致（100% + `padding-inline: 120px`）
5. **窄窗**（约 800px）下将宽度调至 50%：正文仍可读，无异常整页横向滚动

---

## 7. 涉及文件（预期）

| 文件 | 变更 |
|------|------|
| `src/constants/wysiwygContentWidth.ts` | 新增常量 / 归一化 |
| `src/store/useSettingsStore.ts` | 字段、setter（可分离 persist）、init |
| `src/components/settings/AppearanceSettings.tsx` | 滑块 UI + 松手/debounce 持久化 |
| `src/components/WysiwygEditor.tsx` | 注入 `--notez-wysiwyg-pad-inline` |
| `src/App.css` | 覆盖水平 padding（策略 A） |
| `src/store/__tests__/*`（或邻近测例） | clamp、缺省 100、持久化时机 |

---

## 8. 实现顺序建议

1. 常量 + store 字段 / 归一化 / 分离 persist + 单测  
2. `App.css` + `WysiwygEditor` 接线（`N=100` → `120px`；`N<100` → 侧边距公式）  
3. `AppearanceSettings` 滑块（input 内存 / change·debounce 落盘）  
4. 手动验收 §6.2 五条

---

## 9. 审核修订摘要（2026-07-31）

| 项 | 原方案 | 修订后 |
|----|--------|--------|
| 默认值 | 80 | **100**（避免升级视觉回归） |
| 与 Crepe padding | 未处理；只盯 max-width | **策略 A**：覆盖水平 padding 塑造内容占比；`N=100` 还原 120px |
| 百分比语义 | 「相对编辑器视口」 | **相对 WYSIWYG 编辑区**；实现为 `padding-inline` 公式 |
| CSS 手段 | `max-width: N%` + margin 居中 | `width: 100%` + 可变 `padding-inline`（避免 border-box 叠算） |
| 持久化 | 每次 onChange 写盘 | **松手 / debounce** 再写盘 |
| 验收 | 3 条 | 增加升级观感 + 窄窗 50% |
