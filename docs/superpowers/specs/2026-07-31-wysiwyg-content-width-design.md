# 全屏（WYSIWYG）内容宽度百分比 设计文档

**日期**: 2026-07-31  
**状态**: Draft  
**范围**: 外观设置新增项 + WYSIWYG 正文列宽 CSS 变量

---

## 1. 目标

在设置「外观」中增加控件，控制**全屏（WYSIWYG）模式**下正文内容区相对编辑器视口的宽度百分比，正文居中、两侧留白，以改善宽屏阅读体验。

### 非目标

- 不改变源码模式、分屏模式或分屏右侧预览的宽度
- 不涉及操作系统窗口全屏
- 不引入像素级最大宽度钳制（如 `max(80%, 900px)`）
- 不新建设置分类；不改 PlantUML / AI / 主题体系

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 作用范围 | 仅全屏（WYSIWYG / Milkdown Crepe） |
| 控件 | 滑块（`range`）+ 旁侧百分比数字 |
| 范围 | 整数 **50–100**（含端点） |
| 默认 | **80** |
| 步进 | **1** |
| 实现路径 | CSS 变量 + `.ProseMirror` 的 `max-width` / 水平居中 |
| 即时性 | 写入 store 后立即改 CSS；设置模态可能挡住预览，关闭后可见，不做设置内嵌预览 |

---

## 3. 数据模型与持久化

### 3.1 Store 字段

在 `useSettingsStore`（`src/store/useSettingsStore.ts`）增加：

| 项 | 约定 |
|----|------|
| 字段 | `wysiwygContentWidthPercent: number` |
| Setter | `setWysiwygContentWidthPercent(n: number)` |
| 归一化 | `Math.round` 后 clamp 到 `[50, 100]`；非法/非有限数字 → 默认 80 |
| 默认值 | `80` |

### 3.2 常量

新增（建议路径 `src/constants/wysiwygContentWidth.ts`，与 `fontDefaults` 风格一致）：

- `WYSIWYG_CONTENT_WIDTH_MIN = 50`
- `WYSIWYG_CONTENT_WIDTH_MAX = 100`
- `WYSIWYG_CONTENT_WIDTH_DEFAULT = 80`

必须导出 `normalizeWysiwygContentWidthPercent(raw: unknown): number`，供 setter 与 `initSettings` 共用。

### 3.3 持久化

- 扩展 `PersistedSettings`：可选字段 `wysiwygContentWidthPercent?: number`
- `persist()` 写入该字段
- `initSettings`：缺省或非法 → `WYSIWYG_CONTENT_WIDTH_DEFAULT`；合法则归一化后恢复
- 存储路径不变：Tauri `<appData>/settings.json` / 浏览器 `localStorage`

---

## 4. 设置 UI

### 4.1 位置

`AppearanceSettings`（`src/components/settings/AppearanceSettings.tsx`）：

- 放在「文档主题」及其说明文案（「主要作用于全屏（WYSIWYG）模式」）**之后**、「代码块语法高亮」**之前**

### 4.2 控件规格

- 标签：**全屏内容宽度**
- `<input type="range" min={50} max={100} step={1} />`
- 右侧只读展示：`{value}%`
- `onChange` → `setWysiwygContentWidthPercent(Number(e.target.value))`
- 辅助说明（`text-[10px] text-gray-400`）：仅作用于全屏（WYSIWYG）模式；源码/分屏不受影响
- 视觉：与现有外观项一致（`text-xs`、适度 `max-w`），不引入新设计语言

---

## 5. 样式生效

### 5.1 数据流

```
AppearanceSettings 滑块
  → setWysiwygContentWidthPercent
  → store + settings.json
  → WysiwygEditor 订阅 wysiwygContentWidthPercent
  → 根节点 style: --notez-wysiwyg-content-width: N%
  → App.css 限制 .ProseMirror 宽度并居中
```

### 5.2 WysiwygEditor

在现有 CSS 变量（`--crepe-font-*`）旁增加：

```ts
'--notez-wysiwyg-content-width': `${wysiwygContentWidthPercent}%`
```

从 `useSettingsStore` 订阅该字段。宽度变化**不得**加入父级 `key={...}`（当前含 `editorThemeId` / `effectiveColorMode` / `codeBlockThemeId`），避免 Crepe remount。

### 5.3 App.css

扩展已有规则：

```css
.wysiwyg-editor .milkdown .ProseMirror {
  max-width: var(--notez-wysiwyg-content-width, 80%);
  margin-left: auto;
  margin-right: auto;
  /* 保留既有 font-size: var(--notez-editor-font-size, 16px); */
}
```

- 选择器限定在 `.wysiwyg-editor`，不影响分屏预览
- 实现时核对 Crepe 主题是否存在更具体的 `max-width`；若有，用同等或更高优先级覆盖

### 5.4 边界行为

- 宽屏 50% / 窄窗 100%：不额外做 px 钳制
- 图表、代码块随正文列宽；横向溢出沿用现有滚动逻辑

---

## 6. 测试与验收

### 6.1 自动化（轻量）

- Store：`setWysiwygContentWidthPercent` clamp（如 49→50、101→100、80.6→81）
- 加载：缺省字段 → 80；已存合法值 → 恢复
- UI：可选；以 store 单测为主，若现有设置测例风格允许再补 range 存在性

### 6.2 手动验收

1. 设置 → 外观 → 拖「全屏内容宽度」，关闭对话框后 WYSIWYG 正文变窄/变宽且居中
2. 切换源码 / 分屏，布局无变化
3. 重启应用后百分比保持

---

## 7. 涉及文件（预期）

| 文件 | 变更 |
|------|------|
| `src/constants/wysiwygContentWidth.ts` | 新增常量 / 归一化 |
| `src/store/useSettingsStore.ts` | 字段、setter、persist、init |
| `src/components/settings/AppearanceSettings.tsx` | 滑块 UI |
| `src/components/WysiwygEditor.tsx` | CSS 变量 |
| `src/App.css` | `max-width` / 居中 |
| `src/store/__tests__/*`（或邻近测例） | clamp + 加载 |

---

## 8. 实现顺序建议

1. 常量 + store 字段 / 归一化 / 持久化 + 单测  
2. `App.css` + `WysiwygEditor` 接线  
3. `AppearanceSettings` 滑块  
4. 手动验收三条
