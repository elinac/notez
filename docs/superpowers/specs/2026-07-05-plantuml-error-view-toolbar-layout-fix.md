# PlantUML 内联错误视图 — 工具栏缺失与布局不足根因分析

> **日期**: 2026-07-05  
> **状态**: 待修复  
> **关联**: `2026-07-04-plantuml-error-inline-code-view.md`（已实现）  
> **方法**: Systematic Debugging（Phase 1–3 完成，Phase 4 为建议方案，未改代码）

---

## 1. 问题描述

| # | 现象 | 截图 |
|---|------|------|
| P1 | 图表代码块工具栏中，原有的「复制文字/图片」「切换代码/预览」按钮消失，仅剩缩放控件（− / 100% / + / 重置） | 截图 1 |
| P2 | 错误内联代码视图区域高度/宽度不足，错误行气泡被裁切、摘要显示不全 | 截图 2 |

---

## 2. Phase 1：根因调查

### 2.1 近期变更

内联错误视图功能（commit `8ec72ce`…`2921f37`）引入：

1. **`PlantUMLErrorCodeView`** React 组件替代旧 `formatPlantUmlErrorHtml` 卡片  
2. **分屏**：`createPortal` 挂载到 `.plantuml-container`  
3. **WYSIWYG**：`renderDiagramPreview` 对错误结果 **跳过** `diagram-preview` + zoom 包裹，直接 `applyPreview(errorHost)`  
4. **CSS**（`App.css:748-752`）：
   ```css
   .diagram-block:has(.puml-error-code-view) .diagram-tools,
   .diagram-preview:has(.puml-error-code-view) .diagram-zoom-viewport {
     display: none;
   }
   ```

### 2.2 工具栏架构（现状）

| 模式 | 工具栏 DOM | 复制 | 代码/预览切换 | 缩放 |
|------|-----------|------|--------------|------|
| **分屏预览** | `.diagram-block > .diagram-tools`（`diagramBlockShellHtml` 静态 HTML） | ❌ 从未实现 | ❌ 从未实现 | ✅ 内置 |
| **WYSIWYG** | Milkdown `.milkdown-code-block > .tools > .tools-button-group` | ✅ `diagramCopy.ts` MutationObserver 注入 `.diagram-copy-group` | ✅ Milkdown 原生 `.preview-toggle-button` | ✅ `diagramZoom.ts` Observer 注入 |

关键依赖（WYSIWYG）：

```typescript
// diagramZoom.ts:284-285
const zoomRoot = block.querySelector('[data-diagram-zoom-root], .diagram-preview');
if (!group || !zoomRoot) continue; // 无 preview 根节点则跳过整段注入

// diagramCopy.ts:121-122
function getDiagramZoomRoot(block: Element): HTMLElement | null {
  return block.querySelector('[data-diagram-zoom-root], .diagram-preview');
}
```

Milkdown patch（`patches/@milkdown+components+7.19.2.patch`）：

- 若 preview 为带 **`diagram-preview` class** 的 Element → `appendChild`（保留 DOM/React）  
- 否则 Element/string → `innerHTML = DOMPurify.sanitize(...)`（**破坏 React 挂载**）

### 2.3 P1 根因

#### 根因 A（WYSIWYG — 主因）：错误预览破坏了 `diagram-preview` 容器契约

**位置**：`src/components/diagramRenderers.ts:133-136`

```typescript
if (typeof result !== 'string' && result.querySelector?.('.puml-error-code-view')) {
  applyPreview(result); // 直接 apply，无 diagram-preview 包裹
  return true;
}
```

**错误 host**（`renderPlantUmlErrorToElement.tsx`）仅有 `puml-error-code-view-wysiwyg-host`，**没有**：

- `diagram-preview` class  
- `data-diagram-zoom-root` 属性  

**后果链**：

1. **Milkdown PreviewPanel** 走 DOMPurify `innerHTML` 分支 → React 错误视图可能被序列化/剥离，预览 DOM 不稳定  
2. **`ensureWysiwygDiagramZoomToolbars`**：首次错误渲染时 `zoomRoot === null` → 不注入缩放；若先前成功渲染过则旧 zoom 按钮残留（与截图 1「只剩缩放」一致）  
3. **`ensureWysiwygDiagramCopyToolbars`**：`getDiagramZoomRoot()` 为 null → 「复制图片」失效；若 `.copy-button` 在 observer 竞态时未就绪 → **复制按钮未升级为 `.diagram-copy-group`**  
4. **`.preview-toggle-button`**：Milkdown 原生按钮；预览 DOM 异常重绘时可能未渲染或被挤出可视区（Crepe 对非直接子元素 `opacity: 0`，需 hover 才显示）

#### 根因 B（分屏 — 次因/预期差）：`diagram-tools` 被整体隐藏，且历史上无复制/切换

**位置**：`App.css:749`

```css
.diagram-block:has(.puml-error-code-view) .diagram-tools {
  display: none;
}
```

此规则继承旧 `.plantuml-error` 行为（`App.css:385-387`），设计意图是错误态隐藏缩放。

- 分屏 `diagramBlockShellHtml` **从未包含**复制/预览切换，仅缩放（`diagramZoom.ts:236-244`）  
- 若用户在分屏错误态仍看到缩放（截图 1），说明可能是 **WYSIWYG 工具栏** 或 **错误渲染前的中间态**；纯分屏错误态应 **整栏隐藏**（含缩放）

#### 根因 C（WYSIWYG — 辅因）：工具栏按钮溢出 / Crepe 透明度

缩放按钮注入在 copy 锚点之前（`diagramZoom.ts:312-316`）。工具栏宽度有限时，后方的 **复制组** 与 **preview-toggle** 可能被挤出可视区域；Crepe 默认仅对 `.tools-button-group > button` 做 hover 显隐，`.diagram-copy-group` 需额外 CSS 才可见。

---

### 2.4 P2 根因

#### 根因 D：旧错误卡片布局 CSS 未迁移到新组件

旧 `.plantuml-error` 有完整布局规则（`App.css:367-404`）：

```css
.diagram-zoom-content:has(.plantuml-error) { width: 100%; min-width: 0; }
.plantuml-container:has(.plantuml-error) { width: 100%; padding: 0; ... }
.diagram-block:has(.plantuml-error) .diagram-zoom-viewport { min-height: 0 !important; }
```

新 `.puml-error-code-view` **未移植**上述规则，仍保留 `.plantuml-container` 的 `p-4 bg-gray-50`（`diagramBlockShellHtml`），有效宽度变窄。

#### 根因 E：气泡 `position: absolute` 不撑开滚动容器

**位置**：`PlantUMLErrorCodeView.tsx` + `App.css:646-716`

- 容器 `max-height: 400px; overflow: auto`  
- 气泡绝对定位在错误行下方（`useLayoutEffect` 设 `top`）  
- **绝对定位元素不计入父元素 scrollHeight** → 气泡底部被 `overflow: auto` 裁切（截图 2）

#### 根因 F：`max-height: 400px` 与分屏 viewport 叠加

分屏结构：

```
.diagram-block
  .diagram-tools (错误态 hidden)
  .diagram-zoom-viewport (overflow: auto)
    .diagram-zoom-content
      .plantuml-container.p-4
        .puml-error-code-view (max-height: 400px, overflow: auto)
```

双重 scroll + 无 `min-height` → 可视区域偏小，错误摘要与 AI 按钮易被截断。

---

## 3. Phase 2：模式对比

| 维度 | 旧 `plantuml-error` HTML 卡片 | 新 `PlantUMLErrorCodeView` |
|------|------------------------------|---------------------------|
| WYSIWYG 容器 | 走正常 `diagram-preview` 包裹 + zoom init | **跳过** 包裹，破坏 toolbar 契约 |
| 分屏工具栏 | 隐藏 `.diagram-tools`（仅 zoom） | 同左 |
| 宽度 | `:has(.plantuml-error)` 拉满 100% | 无等价规则 |
| 气泡布局 | 卡片内 flow 布局，可撑高 | absolute，不撑高 |
| 源码展示 | 可折叠，长文截断 ±2 行 | 全文 + max-height 400px |

---

## 4. Phase 3：假设（待验证）

| ID | 假设 | 验证方式 |
|----|------|----------|
| H1 | WYSIWYG 错误态恢复 `diagram-preview` 包裹后，复制/预览切换重新出现 | 手工：WYSIWYG plantuml 错误块检查 `.tools-button-group` 子节点 |
| H2 | 为 `.puml-error-code-view` 补布局 CSS + 气泡改 flow 后，P2 消失 | 手工 + 截图对比 |
| H3 | 分屏若需复制/切换，必须在 `diagramBlockShellHtml` 新增按钮（非回归） | 产品确认需求 |

---

## 5. 修改方案（推荐）

### 5.1 P1 — 恢复 WYSIWYG 预览容器契约（推荐，必做）

**文件**：`src/components/diagramRenderers.ts`

错误路径 **不再** 裸 `applyPreview(errorHost)`，改为与成功路径一致的外壳，仅禁用 zoom：

```typescript
// 伪代码
if (isErrorElement(result)) {
  const wrapper = document.createElement('div');
  wrapper.className = 'diagram-preview diagram-plantuml diagram-color-fix diagram-preview--error p-2';
  wrapper.dataset.diagramZoomRoot = '';
  wrapper.dataset.diagramErrorPreview = '1'; // 供 CSS/JS 识别
  wrapper.appendChild(result); // puml-error-code-view-wysiwyg-host
  applyPreview(wrapper);
  return true;
}
```

**不要**对错误 preview 调用 `initDiagramZoom()`。

**文件**：`patches/@milkdown+components+7.19.2.patch`（可选增强）

扩展 appendChild 条件：

```javascript
previewContent.classList.contains('diagram-preview')
// 或 previewContent.dataset.diagramErrorPreview === '1'
```

**文件**：`src/App.css`

将隐藏规则从「整栏 tools / 整个 viewport」改为「仅隐藏 zoom 控件」：

```css
/* 替换现有 748-752 行 */
.diagram-block:has(.puml-error-code-view) .diagram-zoom-out,
.diagram-block:has(.puml-error-code-view) .diagram-zoom-in,
.diagram-block:has(.puml-error-code-view) .diagram-zoom-reset,
.diagram-block:has(.puml-error-code-view) .diagram-zoom-label,
.diagram-preview--error .diagram-zoom-out,
.diagram-preview--error .diagram-zoom-in,
.diagram-preview--error .diagram-zoom-reset,
.diagram-preview--error .diagram-zoom-label {
  display: none;
}
```

**不要** `display: none` 整个 `.diagram-tools` 或 `.diagram-zoom-viewport`（后者会把内容一起隐藏）。

---

### 5.2 P1 — 加固 toolbar Observer（推荐，必做）

**文件**：`src/components/diagramZoom.ts`、`src/components/diagramCopy.ts`

1. `ensureWysiwygDiagramZoomToolbars` / `ensureWysiwygDiagramCopyToolbars`：  
   - 对 plantuml/mermaid 语言块，若存在 `.puml-error-code-view` 或 `[data-diagram-error-preview]`，**仍执行 copy 注入**  
   - zoom 注入改为：有 error preview 时 **跳过**（或注入后立即 hide）

2. `getDiagramZoomRoot` 扩展：

```typescript
block.querySelector('[data-diagram-zoom-root], .diagram-preview, .puml-error-code-view-wysiwyg-host')
```

3. 在 `renderDiagramPreview` 错误分支 `applyPreview` 后 **主动调用**：

```typescript
ensureWysiwygDiagramCopyToolbars(wysiwygRoot);
// zoom 可选：ensureWysiwygDiagramZoomToolbars 但 CSS 隐藏
```

（`wysiwygRoot` 从 editor container 获取，与 `WysiwygEditor` 现有 observer 一致。）

---

### 5.3 P1 — 分屏是否补齐复制/预览（产品决策，可选）

若需求是 **分屏也要有** 复制/切换（截图 1 用户预期）：

**文件**：`src/components/diagramZoom.ts` — `diagramBlockShellHtml` 增加复制按钮占位；**新文件**或扩展 `diagramCopy.ts` 支持 split `.diagram-block`。

若需求仅是 **WYSIWYG 回归**，则分屏保持现状（仅编辑器侧改代码），文档说明分屏无切换按钮。

**推荐**：本迭代只修 WYSIWYG 回归；分屏复制作为 follow-up。

---

### 5.4 P2 — 布局 CSS 迁移（必做）

**文件**：`src/App.css`

在 `.puml-error-code-view` 区块追加（移植并改写旧规则）：

```css
.diagram-zoom-content:has(.puml-error-code-view),
.plantuml-container:has(.puml-error-code-view) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.plantuml-container:has(.puml-error-code-view) {
  padding: 0;
  background: transparent;
}

.diagram-block:has(.puml-error-code-view) .diagram-zoom-viewport {
  min-height: min(480px, 60vh);
  overflow: auto;
}

.puml-error-code-view {
  width: 100%;
  min-width: 0;
  max-height: none; /* 由外层 viewport 控制滚动 */
  min-height: 240px;
  padding-bottom: 1rem;
}
```

---

### 5.5 P2 — 气泡改为文档流布局（必做）

**文件**：`src/components/plantuml-offline/PlantUMLErrorCodeView.tsx`

**方案（推荐）**：气泡不再 `position: absolute`，改为 **紧跟错误行之后** 的 flow 块：

```tsx
{lines.map(...)}
{errorLine !== undefined && (
  <div className="puml-error-code-view__bubble puml-error-code-view__bubble--inline" role="alert">
    ...
  </div>
)}
{errorLine === undefined && (
  <div className="puml-error-code-view__bubble puml-error-code-view__bubble--bottom" ...>
)}
```

删除 `bubbleRef` + `useLayoutEffect` top 计算。

**文件**：`src/App.css`

```css
.puml-error-code-view__bubble--inline {
  position: static;
  margin: 0.25rem 0.75rem 0.75rem 3rem;
}
```

优点：气泡自然撑高容器，不被裁切；与 spec 中「气泡在错误行下方」一致。

---

### 5.6 测试补充

| 测试 | 文件 |
|------|------|
| WYSIWYG 错误 preview 仍带 `diagram-preview` + `data-diagram-zoom-root` | `diagramRenderers.plantuml.test.ts` |
| 错误态不调用 `initDiagramZoom` | 同上 |
| 气泡 inline 布局存在 `__bubble--inline` | `PlantUMLErrorCodeView.test.tsx` |
| 分屏 portal 渲染后容器宽度 100% | 可选 DOM 单测 |

---

## 6. 实施优先级

| 优先级 | 项 | 解决 |
|--------|-----|------|
| P0 | 5.1 WYSIWYG 恢复 preview 包裹 + 修正 CSS 隐藏范围 | P1 |
| P0 | 5.5 气泡改 flow 布局 | P2 |
| P0 | 5.4 布局 CSS 迁移 | P2 |
| P1 | 5.2 Observer 加固 + applyPreview 后主动 refresh copy | P1 兜底 |
| P2 | 5.3 分屏复制/切换 | 产品确认后做 |

---

## 7. 验收标准

### P1 工具栏

- [ ] WYSIWYG + plantuml 语法错误：工具栏可见 **复制（代码/图片）** 与 **Edit/预览切换**  
- [ ] 同上场景：**不显示**缩放按钮（或显示但 disabled/hidden）  
- [ ] 复制代码：clipboard 为编辑器内 PlantUML 源码  
- [ ] 点击 Edit：可切回 CodeMirror 编辑源码  

### P2 布局

- [ ] 错误视图在分屏/WYSIWYG 下 **宽度占满** 预览区  
- [ ] 错误行红色高亮 + 下方气泡 **完整可见**（含摘要与 AI 修复）  
- [ ] 长源码可滚动，气泡不被 `overflow` 裁切  
- [ ] 最小高度 ≥ 240px（或 60vh 内可读）

---

## 8. 不在本次修复范围

- 分屏模式新增复制/预览切换（除非产品确认 P0）  
- PlantUML 语法高亮  
- edit 纯源码模式错误提示  

---

## 9. 附录：关键代码索引

| 文件 | 行/符号 | 说明 |
|------|---------|------|
| `diagramRenderers.ts` | 133-136 | 错误路径跳过 diagram-preview |
| `renderPlantUmlErrorToElement.tsx` | 全文 | WYSIWYG error host |
| `diagramZoom.ts` | 236-244, 284-285 | 分屏 shell / zoomRoot 检测 |
| `diagramCopy.ts` | 115-123, 218-232 | copy 注入条件 |
| `App.css` | 367-404 | 旧 plantuml-error 布局 |
| `App.css` | 646-752 | 新 error view + 过度隐藏 |
| `PlantUMLErrorCodeView.tsx` | 39-43, 87-94 | 气泡 absolute 定位 |
| `patches/@milkdown+components+7.19.2.patch` | PreviewPanel | diagram-preview appendChild 分支 |
