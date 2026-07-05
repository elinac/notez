# PlantUML 错误视图 — 双模式统一逻辑与分屏复制

> **日期**: 2026-07-05  
> **状态**: 已实现（方案 A）  
> **关联**:  
> - `2026-07-04-plantuml-error-inline-code-view.md`（v3 已实现）  
> - `2026-07-05-plantuml-error-view-toolbar-layout-fix.md`（方案 1 已落地）  
> **工程版本**: `@milkdown/crepe` ^7.19.2（锁定 patch）| npm latest **7.21.2** | React ^19.1.0

---

## 1. 背景与动机

### 1.1 用户诉求

1. **WYSIWYG 与分屏使用相同的错误展示逻辑**（同一组件、同一交互模型）。
2. **分屏模式补齐「复制代码 / 复制图片」**，与 WYSIWYG 图表工具栏能力对齐。
3. 对 WYSIWYG Preview 区「源码重复 + 气泡不美观」问题，在统一逻辑前提下评估是否需后续 UX 微调。

### 1.2 当前实现快照（2026-07-05 代码）

| 能力 | 分屏 `PlantUMLRenderer` | WYSIWYG `diagramRenderers` |
|------|-------------------------|----------------------------|
| 错误 UI 组件 | `PlantUMLErrorCodeView`（Portal） | 同组件（`createRoot`） |
| 挂载点 | `.plantuml-container` | `.diagram-preview.diagram-preview--error` |
| 工具栏 | 仅 zoom（静态 HTML） | copy + Edit/Preview + zoom（Observer 注入） |
| 方案 1 修复 | 气泡 flow、布局 CSS、仅隐藏 zoom | 已恢复 `diagram-preview` 包裹 |

**结论**：业务 UI **已共用同一 React 组件**；差异在 **挂载方式**、**外层容器**、**工具栏注入路径**。

---

## 2. 目标方案（设计草案）

### 2.1 统一错误渲染管线

抽取共用入口，两种模式仅差「挂载策略」：

```typescript
// 新增：src/components/plantuml-offline/mountPlantUmlErrorView.ts

export type PlantUmlErrorPayload = {
  source: string;
  error: string;
  line?: number;
};

/** WYSIWYG：返回可 append 的 host（createRoot + flushSync） */
export function createPlantUmlErrorHost(payload: PlantUmlErrorPayload): HTMLElement;

/** 分屏：返回 Portal 所需 props（组件 + target node 由调用方提供） */
export type PlantUmlErrorPortalProps = PlantUmlErrorPayload;
```

**调用关系（目标态）**：

```
renderPlantUMLOffline → RenderResult { ok: false, ... }
        │
        ├─ 分屏: PlantUMLRenderer → createPortal(<PlantUMLErrorCodeView />, .plantuml-container)
        │
        └─ WYSIWYG: renderPlantUmlErrorToElement → createPlantUmlErrorHost → diagram-preview 包裹
```

`PlantUMLErrorCodeView` **不增加 mode 分支**（除非后续 WYSIWYG banner 变体，见 §5.2）。

### 2.2 分屏复制工具栏

#### DOM 目标

在 `diagramBlockShellHtml` 生成的 `.diagram-tools-button-group` 内 **prepend** `.diagram-copy-group`（与 WYSIWYG 同 class，复用 CSS）。

```
┌─ .diagram-block ─────────────────────────────────────────┐
│ .diagram-tools                                           │
│   [复制▾ 代码|图片]          −  100%  +  重置            │  ← 成功
│   [复制▾ 代码|图片]                                      │  ← 错误（zoom 隐藏）
│ .diagram-zoom-viewport                                   │
│   .plantuml-container / .puml-error-code-view            │
└──────────────────────────────────────────────────────────┘
```

#### 源码与图片解析

| 模式 | 复制代码 | 复制图片 |
|------|----------|----------|
| 分屏成功 | `data-plantuml-code` / `data-mermaid-code` decode | `block[data-diagram-zoom-root]` 内 SVG |
| 分屏错误 | 同上（属性仍在 container 父链上） | 无 SVG → 现有 `copyDiagramImage` toast |
| WYSIWYG | `.cm-content` textContent | `[data-diagram-zoom-root]` / `.diagram-preview` |

#### 实现步骤

1. **泛化** `diagramCopy.ts`：`buildDiagramCopyToolbar(options: { getSource, getImageRoot, anchor })`  
   - WYSIWYG：`replaceBtn` 替换 Milkdown Copy  
   - 分屏：`prepend` 到 `.diagram-tools-button-group`
2. **新增** `ensureSplitPaneDiagramCopyToolbars(root: HTMLElement)`  
   - 选择器：`.markdown-split-preview .diagram-block[data-diagram-type]`  
   - 绑定时机：`PlantUMLRenderer` 在 `innerHTML` 写入并对每个 block 调用 `initDiagramBlockZoom` **之后**（与 zoom 并列）
3. **CSS**：为 `.markdown-split-preview .diagram-copy-group` 追加与 Milkdown 对齐的样式（可复用 `App.css` 现有 `.diagram-copy-*` 规则，加 split 前缀选择器）
4. **错误态**：保留「仅隐藏 zoom 按钮」规则；copy 始终可见

#### 不在范围

- 分屏 **Edit/Preview 切换**（无 Milkdown code block，产品不适用）
- Mermaid 错误态若仍用 HTML 字符串卡片，copy 代码仍可用，copy 图片不可用（与 PlantUML 错误态一致）

### 2.3 与 Milkdown 官方 API 的对齐

| API | 官方（Crepe 7.21.2） | NoteZ 用法 | 本方案影响 |
|-----|---------------------|------------|------------|
| `renderPreview` | `(language, content) => string \| HTMLElement \| null`（同步） | 三参数异步 + `applyPreview`（7.19.2 + patch 行为） | **不变**；统一 mount 不触碰 Crepe 配置 |
| `previewOnlyByDefault` | 支持 | `true`（`WysiwygEditor.tsx:62`） | 不变；WYSIWYG 聚焦时仍可能同时见 editor + preview |
| `onCopy` | `(content: string) => void` | 未使用；用 DOM 注入实现 code/image 双模式 | 分屏 copy **不依赖** Crepe；无冲突 |
| `PreviewPanel` | 7.21.2 对 **所有** Element 走 `sanitizeSvg(innerHTML)` | patch 对 `.diagram-preview` 走 `appendChild` | **升级 Milkdown 必须重打 patch**（见 §4 证据 E5） |

---

## 3. 审核报告（五维）

### 3.1 可行性 — **高（8/10）**

| 项 | 判定 | 说明 |
|----|------|------|
| 统一 `PlantUMLErrorCodeView` | ✅ 已实现 | 两模式已用同一组件，仅需抽 mount helper 减重复 |
| 分屏 copy | ✅ 可行 | `copyDiagramCode` / `copyDiagramImage` 已独立；`data-*-code` 在 shell 中已存在 |
| Milkdown API | ⚠️ 约束 | 错误视图 **必须** 保留 `diagram-preview` + patch appendChild；不可改用纯 string HTML |
| React 挂载 | ⚠️ 约束 | WYSIWYG 必须 `createRoot`+`flushSync`；分屏必须 Portal 或同法 mount 到 container |
| Tauri 剪贴板 | ✅ | 与 WYSIWYG 相同 `navigator.clipboard` 路径 |

**风险**：`buildDiagramCopyGroup` 当前与 Milkdown `.copy-button` 耦合；泛化时需避免破坏 WYSIWYG 现有测试（`diagramCopy.test.ts`）。

### 3.2 完整性 — **中高（7/10）**

| 覆盖 | 状态 |
|------|------|
| PlantUML 错误 + 成功 | ✅ 设计覆盖 |
| Mermaid 分屏 copy 代码 | ✅ `data-mermaid-code` 同构 |
| Mermaid 错误（HTML 字符串） | ⚠️ 非 `PlantUMLErrorCodeView`；copy 代码 OK，图片 N/A |
| 多 block / 异步重渲染 | ✅ Portal 数组 + block 级 init |
| 无障碍 | ✅ 沿用 `role="alert"` / `aria-invalid` |
| 测试 | ⚠️ 需补 split copy 单测 + mount helper 单测 |
| 文档 | ✅ 本文 |

**缺口**：WYSIWYG 双份源码（editor + preview lines）在「完全统一 UI」下 **仍未解决** — 属 UX 完整性，非功能缺失（见方案 B）。

### 3.3 一致性 — **中高（7/10）**

| 维度 | 统一后 | 残余差异 |
|------|--------|----------|
| 错误 UI | 同一组件、同一 CSS | 无 |
| 工具栏 | copy 两模式同 UI class | 分屏无 Edit/Preview（架构决定，可文档说明） |
| copy 模式记忆 | 共用 `sessionStorage` key | 无 |
| 错误态 zoom | 两模式均隐藏 zoom | 无 |
| 挂载机制 | 仍双路径（Portal vs createRoot） | 对开发者透明，可抽 helper |

### 3.4 清晰性 — **高（8/10）**

- 用户心智：**「预览区 = 图或错误详情；代码在左侧/上方编辑」**（分屏 / WYSIWYG）— 统一 inline 错误视图在分屏清晰；WYSIWYG 可能略冗余。
- 开发者心智：抽 `mountPlantUmlErrorView` 后，`PlantUMLRenderer` / `renderPlantUmlErrorToElement` 各 ~10 行，职责清晰。
- 文档：需更新 `2026-07-04` spec 附录「分屏无 copy」的过时描述。

### 3.5 必要性（收益 / 损失）

#### 收益

| 项 | 价值 |
|----|------|
| 统一错误 UI | 降低维护成本；QA 一条路径 |
| 分屏 copy | 补齐长期能力缺口；与 WYSIWYG  parity |
| mount 抽取 | 减少 `renderPlantUmlErrorToElement` 与 Portal 重复 |

#### 损失 / 成本

| 项 | 成本 |
|----|------|
| 实现 | ~1–2 人日（copy 泛化 + split 绑定 + 测试 + CSS） |
| WYSIWYG 重复源码 | 若坚持 full inline，美观问题仍在 |
| patch 依赖 | 任何 Milkdown 升级需验证 `diagram-preview` appendChild |
| DOM 注入技术债 | 延续 Observer/ imperative 模式（与 `milkdown-toolbar-governance-design.md` 一致） |

#### 必要性结论

- **统一逻辑**：**必要** — 已大部分完成，收尾 mount helper 成本低。  
- **分屏 copy**：**必要** — 用户明确诉求；实现可复用现有模块，收益大于成本。  
- **WYSIWYG banner 变体**：**可选** — 视美观反馈再定，非本迭代阻塞项。

---

## 4. 可选方案

### 方案 A — 统一 UI + 分屏 copy（推荐）

- 保持 `PlantUMLErrorCodeView` full inline（两模式相同）
- 抽 mount helper；分屏注入 copy 工具栏
- **不**改 WYSIWYG 重复源码问题

| 维度 | 评分 |
|------|------|
| 可行性 | ★★★★★ |
| 完整性 | ★★★★☆ |
| 一致性 | ★★★★☆ |
| 工作量 | 小 |

### 方案 B — 方案 A + WYSIWYG banner 变体

- 增加 `variant?: 'full' | 'banner'`，WYSIWYG 错误时 `banner`（仅气泡，不渲染 `__lines`）
- 分屏仍 `full`

| 维度 | 评分 |
|------|------|
| 可行性 | ★★★★☆ |
| 完整性 | ★★★★★ |
| 一致性 | ★★★☆☆（两模式 UI 略不同） |
| 工作量 | 中 |

### 方案 C — 仅分屏 copy，错误 UI 不动

- 最小 diff；不抽 mount helper

| 维度 | 评分 |
|------|------|
| 可行性 | ★★★★★ |
| 一致性 | ★★☆☆☆（技术债继续分散） |
| 工作量 | 最小 |

### 方案 D — Crepe `onCopy` 替代 WYSIWYG DOM 注入

- 官方 API 仅支持 **复制字符串**，无 image 下拉、无分屏

| 维度 | 评分 |
|------|------|
| 可行性 | ★★☆☆☆（不满足 copy 图片） |
| 推荐 | **否** |

### 方案 E — CodeMirror 行装饰 + Preview 仅 banner（IDE 化）

- 错误标注移到 editor；Preview 最小化

| 维度 | 评分 |
|------|------|
| 可行性 | ★★☆☆☆（Crepe 扩展 + 异步回传） |
| 工作量 | 大 |
| 推荐 | 长期演进，非本迭代 |

---

## 5. 推荐方案

### 推荐：**方案 A**（统一 mount + 分屏 copy；full inline 两模式一致）

### 推荐原因

1. **与现有代码方向一致**：组件已统一，方案 1 已修复 WYSIWYG 工具栏回归；差 mount 抽取与分屏 copy。
2. **可行性最高**：分屏源码已在 `data-plantuml-code`；copy 核心函数已存在，无需新依赖。
3. **一致性可接受**：工具栏 copy UI 对齐；Edit/Preview 差异由分屏架构决定，可文档化而非强行模拟。
4. **收益明确**：用户可直接在分屏预览区复制 PlantUML 源码或成功渲染的 SVG 图。
5. **损失可控**：不引入 Milkdown 升级或 CodeMirror 插件；patch 策略不变。

### 后续可选（非阻塞）

若 WYSIWYG 仍反馈「Preview 重复不美观」，在方案 A 基础上叠加 **方案 B** 的 `variant="banner"`，**仅 WYSIWYG** 启用。

---

## 6. 证据附录

### E1 — 两模式已共用 `PlantUMLErrorCodeView`

```tsx
// PlantUMLRenderer.tsx:258-266 — 分屏 Portal
createPortal(
  <PlantUMLErrorCodeView source={...} errorMessage={...} errorLine={...} />,
  node
)

// renderPlantUmlErrorToElement.tsx:14-18 — WYSIWYG createRoot
root.render(<PlantUMLErrorCodeView source={...} errorMessage={...} errorLine={...} />)
```

### E2 — WYSIWYG 错误 preview 已恢复 diagram-preview 契约（方案 1）

```typescript
// diagramRenderers.ts:137-149
wrapper.className = `diagram-preview ... ${isError ? ' diagram-preview--error' : ''}`;
wrapper.dataset.diagramZoomRoot = '';
if (isError && typeof result !== 'string') {
  wrapper.appendChild(result);
  applyPreview(wrapper);
  return true; // 不调用 initDiagramZoom
}
```

单测：`diagramRenderers.plantuml.test.ts` — `renderDiagramPreview wraps failure in diagram-preview without initDiagramZoom`。

### E3 — 分屏 shell 仅有 zoom，源码在 data 属性

```typescript
// diagramZoom.ts:236-248
diagramBlockShellHtml(...) →
  data-plantuml-code="${escaped}"  // HTML 实体编码
  .diagram-tools-button-group → 仅 diagram-zoom-*
```

### E4 — WYSIWYG copy 已实现，分屏未接入

```typescript
// diagramCopy.ts:218-232 — 仅 .milkdown-code-block
export function ensureWysiwygDiagramCopyToolbars(root: HTMLElement)

// diagramCopy.ts:125-127 — 源码来自 CodeMirror
function getCodeBlockSource(block: Element): string {
  return block.querySelector('.cm-content')?.textContent ?? '';
}
```

分屏需新增：`decodeHtmlEntities(block.querySelector('[data-plantuml-code]')?.getAttribute(...))`。

### E5 — Milkdown 7.21.2 官方 PreviewPanel 无 diagram-preview 绕过

上游 `preview-panel.tsx`（v7.21.2）：

```typescript
if (typeof previewContent === 'string' || previewContent instanceof Element) {
  previewContainer.innerHTML = sanitizeSvg(previewContent)
}
```

NoteZ patch（`patches/@milkdown+components+7.19.2.patch`）：

```typescript
if (previewContent instanceof Element && previewContent.classList.contains('diagram-preview')) {
  previewContainer.appendChild(previewContent)
} else if ...
```

**推论**：React 错误视图 + zoom WeakMap **依赖 patch**；npm latest 7.21.2 与工程 ^7.19.2 存在 **PreviewPanel 行为差异**，升级需重验证 patch。

### E6 — Crepe CodeMirror 配置（NoteZ 实际）

```typescript
// WysiwygEditor.tsx:60-64
const codeMirrorFeatureConfig = {
  languages: [...cmLanguages, ...diagramLanguages],
  previewOnlyByDefault: true,
  renderPreview: codeBlockRenderPreview,
  theme: getCodeBlockSyntaxExtension(codeBlockThemeId),
};
```

官方 `CodeMirrorFeatureConfig`（Crepe 7.21.2 docs）支持 `renderPreview`、`onCopy`、`previewToggleText` 等；NoteZ 的 **三参数 async `applyPreview`** 来自 `@milkdown/components` code-block 实现 + 异步 preview PR (#2117)，与文档签名略有出入，**以安装版本 + patch 为准**。

### E7 — 错误态 copy 图片行为

```typescript
// diagramCopy.ts:42-56 — 无 SVG 时已有 toast
showToast('复制失败：未找到图片', { kind: 'error' });
```

错误态无需特殊分支，复用即可。

### E8 — 方案 1 已实施项（避免重复劳动）

| 项 | 状态 |
|----|------|
| diagram-preview 包裹 | ✅ |
| 气泡 flow layout | ✅ |
| 布局 CSS 迁移 | ✅ |
| 仅隐藏 zoom 按钮 | ✅ |
| 249 vitest 通过 | ✅ |

---

## 7. 验收标准（方案 A）

### 错误 UI 统一

- [ ] 分屏与 WYSIWYG 均渲染相同 `PlantUMLErrorCodeView`（full inline）
- [ ] `mountPlantUmlErrorView`（或等价 helper）为唯一 props 构造入口

### 分屏 copy

- [ ] 分屏 PlantUML **成功**：可复制源码；可复制 SVG 图片
- [ ] 分屏 PlantUML **错误**：可复制源码；复制图片 toast「未找到图片」
- [ ] 分屏 Mermaid **成功**：同上
- [ ] copy 模式（代码/图片）与 WYSIWYG 共用 sessionStorage
- [ ] 错误态：copy 可见，zoom 隐藏

### 回归

- [ ] WYSIWYG 错误态：copy + Edit/Preview 仍正常
- [ ] `npx vitest run`、`npx tsc --noEmit` 通过

---

## 8. 实施任务清单（方案 A）

| # | 任务 | 文件 |
|---|------|------|
| 1 | 抽 `createPlantUmlErrorHost` / 统一 props 类型 | `mountPlantUmlErrorView.ts`，改 `renderPlantUmlErrorToElement.tsx` |
| 2 | 泛化 copy toolbar builder | `diagramCopy.ts` |
| 3 | `ensureSplitPaneDiagramCopyToolbars` + 在 `PlantUMLRenderer` 调用 | `diagramCopy.ts`, `PlantUMLRenderer.tsx` |
| 4 | split 工具栏 CSS | `App.css` |
| 5 | 单测：split copy 源码 decode、错误态 copy 代码 | `diagramCopy.test.ts` |
| 6 | 更新 `2026-07-04` spec 工具栏表 | 文档 |

---

## 9. 不在本次范围

- Milkdown 7.19 → 7.21 升级
- WYSIWYG `variant="banner"`（方案 B）
- CodeMirror 错误行 gutter（方案 E）
- 分屏 Edit/Preview 切换
