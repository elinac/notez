# Milkdown 工具栏治理设计（方案 A）

**状态：** 已批准  
**日期：** 2026-07-03  
**修订：** 2026-07-04（可行性审核修正）  
**范围：** 保留 Milkdown Crepe 作为全屏 WYSIWYG 引擎，治理 `patch-package` 与 DOM 注入技术债  
**相关备选：** [MDXEditor 全屏引擎替换评估](./2026-07-03-mdxeditor-wysiwyg-alternative.md)

---

## 背景与问题

NoteZ 采用双引擎编辑架构：

| 模式 | 引擎 | 说明 |
|------|------|------|
| 源码 | CodeMirror 6 | 纯 Markdown 文本 |
| 分屏 | CodeMirror + `PlantUMLRenderer` | 左编右预览，图表走自研渲染管线 |
| 全屏 | Milkdown Crepe | WYSIWYG；代码块通过 `renderPreview` 对接 PlantUML/Mermaid |

全屏模式的图表代码块需要缩放、复制（代码/图片）等工具栏能力。Crepe 代码块 UI 实现在 `@milkdown/components` 的 **Vue 组件**中，React 应用无法自然扩展，当前通过以下方式弥补：

1. **`patches/@milkdown+components+7.19.2.patch`**（约 374 行）— 注入 `DiagramZoomButtons`、`DiagramCopyButton` 等 Vue 组件到 `CodeBlock` 内部模板
2. **`diagramZoom.ts` / `diagramCopy.ts`** — `MutationObserver` 监听 `.milkdown-code-block` DOM 出现，自动注入缩放/复制按钮

### Patch 完整职责分析

逐行审读 patch 后，确认它做了**三件事**（而非仅添加按钮）：

| 职责 | patch 中的代码 | DOM 注入是否覆盖 | 风险 |
|------|---------------|-----------------|------|
| **1. 图表工具栏按钮** | `DiagramZoomButtons` + `DiagramCopyButton` Vue 组件 | ✅ `ensureWysiwygDiagramZoomToolbars` + `ensureWysiwygDiagramCopyToolbars` | 无 |
| **2. DOMPurify 绕过** | `PreviewPanel` 中 `.diagram-preview` 元素直接 `appendChild`（跳过 `DOMPurify.sanitize`） | ❌ 未覆盖 | **中等**（见下方分析） |
| **3. 预览面板 3 状态切换** | `previewPanelExpanded` ref + `previewHiddenByDefault` config + 眼睛图标 | ❌ 未覆盖 | 低（NoteZ 未使用该 config） |

#### 职责 2：DOMPurify 绕过（关键风险）

Milkdown 7.20.0 **未打 patch** 时的 `PreviewPanel` 行为：

```ts
// @milkdown/components@7.20.0 preview-panel.tsx（原始）
const previewContent = preview.value;  // 可能是 HTMLElement
if (typeof previewContent === 'string' || previewContent instanceof Element) {
  previewContainer.innerHTML = DOMPurify.sanitize(previewContent);
}
```

NoteZ 的 `renderDiagramPreview` 返回一个已挂载 zoom controller 的 `HTMLElement`：

```ts
// diagramRenderers.ts:131-143
const wrapper = document.createElement('div');
wrapper.className = 'diagram-preview ...';
wrapper.dataset.diagramZoomRoot = '';
wrapper.appendChild(wrapDiagramZoomContent(content));
initDiagramZoom(wrapper);   // ← WeakMap 绑定 controller 到此 element
applyPreview(wrapper);       // ← 传给 Milkdown
```

**不打 patch 时的后果：**

1. `DOMPurify.sanitize(wrapper)` 将 Element 序列化为 HTML 字符串再清洗
2. `innerHTML = sanitizedString` 创建**全新 DOM 节点**
3. 原 `wrapper` 上的 zoom controller（WeakMap 引用）**丢失**
4. SVG 内容经过 DOMPurify 默认白名单过滤

**但 DOM 注入 Observer 可以修复 #3：**
- `MutationObserver` 检测到新 DOM → `getDiagramZoomController()` 返回 `undefined` → `initDiagramZoom()` 创建新 controller → 正常工作

**#4 的实际影响（需验证）：**

DOMPurify 3.x 默认白名单保留：
- ✅ `data-*` 属性（`data-diagram-zoom-root` 等）
- ✅ 标准 SVG 元素（`<svg>`, `<g>`, `<path>`, `<text>`, `<rect>` 等）
- ✅ `class` / `style` 内联属性
- ✅ `<defs>`, `<clipPath>`, `<pattern>`
- ⚠️ `<style>` 元素在 SVG 内 — DOMPurify 3.x 默认允许，但需确认 PlantUML 主题 CSS 未被截断
- ⚠️ 非标准 SVG 属性 — PlantUML JAR 输出偶尔含自定义 namespace 属性

**结论：** 大概率工作正常，但需在阶段 0 中对 PlantUML（含 skinparam 主题）和 Mermaid 的 SVG 做目视验证。

#### 职责 3：预览面板 3 状态切换（低影响）

patch 新增 `previewPanelExpanded` 实现「折叠 → 展开+编辑 → 仅预览」三状态切换。但：
- NoteZ 的 `codeMirrorFeatureConfig` 仅传 `previewOnlyByDefault: true`，**未使用 `previewHiddenByDefault`**
- 删除 patch 后回退为原始 2 状态：「仅预览 ↔ 编辑+预览」
- 图表代码块默认即显示预览（`previewOnlyByDefault: true`），用户体验差异极小

### 工具栏按钮冗余

patch 和 DOM 注入的**按钮功能**重叠：

| 能力 | patch 提供 | DOM 注入提供 | 去重机制 |
|------|-----------|-------------|---------|
| 图表缩放按钮 | `DiagramZoomButtons`（Vue） | `ensureWysiwygDiagramZoomToolbars` | DOM 注入检查 `.diagram-zoom-out` 已存在 |
| 图表复制按钮 | `DiagramCopyButton`（Vue） | `ensureWysiwygDiagramCopyToolbars` | DOM 注入检查 `.diagram-copy-group` 已存在 |
| `window.__notezDiagramZoom/Copy` 桥接 | patch 内 Vue 组件调用 | `main.tsx` 中独立安装 | 两者共享同一全局对象 |

DOM 注入代码已有幂等逻辑（`if (group.querySelector('.diagram-zoom-out')) continue`），两套方案共存时不会重复渲染。

### 实际痛点量化

- **升级阻塞：** patch 绑定 `@milkdown/components@7.19.2` 的编译产物**行号偏移**（`@@ -357,6 +357,258`），任何 minor 升级都需重新适配
- **调试复杂度：** 排查代码块 UI 问题需同时理解 Vue 编译产物 + React 胶水层 + DOM 注入三层
- **概念冗余：** 工具栏按钮两套方案做同一件事
- **版本锁定：** `@milkdown/components` 当前最新为 7.20.0（2026-03-30），NoteZ 锁在 7.19.2 无法升级

### 产品约束（已确认）

- **Typora 风格（语法随光标显隐）：** 有更好，没有也行
- **三种编辑模式：** 继续保留
- **PlantUML/Mermaid 深度集成：** 不可退化
- **分屏预览管线：** 不改动

---

## 目标

1. **删除** `patches/@milkdown+components+7.19.2.patch`，消除 Milkdown 升级时的 patch 合并成本
2. 代码块图表工具栏（缩放、复制）在 Milkdown minor 升级时零适配
3. 保留现有 `renderPreview` + `diagramRenderers` 注册表架构
4. 不迁移 WYSIWYG 引擎、不改动源码/分屏模式实现
5. 将 DOM 注入从「兜底」正式化为**唯一工具栏注入路径**，简化心智模型

### 非目标

- 不替换 Milkdown 为 MDXEditor（见备选文档）
- 不删除全屏 WYSIWYG 模式
- 不重写 `PlantUMLRenderer` 或分屏预览
- 不在本阶段实现 Crepe TopBar（可选后续）
- 不追求通过 Crepe 官方 API 注入代码块级按钮（经调研无此扩展点，见下方可行性分析）

---

## 可行性分析

### Milkdown 7.21 API 层级与代码块工具栏的关系

| API | 作用域 | 能否扩展代码块工具栏 |
|-----|--------|---------------------|
| `ToolbarFeatureConfig.buildToolbar` | 选区浮动 tooltip（选中文字时出现） | **否** — 代码块无文字选区 |
| `TopBarFeatureConfig.buildTopBar` | 编辑器顶部固定栏 | **否** — 全局级，无法按代码块语言显隐 |
| `CodeMirrorFeatureConfig` | 代码块编辑/预览行为 | 仅 `renderPreview`/`languages`/`theme`，**无工具栏 hook** |
| `@milkdown/components` CodeBlock Vue 组件 | 代码块 `.tools-button-group` | **唯一入口** — Vue 内部渲染，外部只能 patch 或 DOM 注入 |

**结论：** Crepe 7.21 无官方 API 向代码块工具栏注入自定义按钮。`buildToolbar`/`buildTopBar` 解决的是不同层级的问题。这意味着：

- 原 Spike 目标（通过官方 API 去 patch）在当前 Milkdown 版本**不可行**
- 但 NoteZ 已有的 DOM 注入方案（`MutationObserver` + `.tools-button-group` 注入）独立于 patch 工作，且经过生产验证

### 推荐策略

既然 DOM 注入已经覆盖全部功能，且有幂等去重逻辑，**直接删除 patch、正式化 DOM 注入为唯一路径**即可。不需要等待上游 API。

```
当前状态：patch（Vue 注入） + DOM 注入（兜底）→ 功能重叠
    ↓
目标状态：仅 DOM 注入 → 单一路径，patch 归零
```

---

## 方案概述

**策略：** 分两步——先验证 DOMPurify 不破坏图表 SVG，再删除 patch。

**核心依据：**

1. `startWysiwygDiagramZoomObserver` 和 `startWysiwygDiagramCopyObserver` 已独立于 patch 正常工作
2. DOM 注入有幂等检查（`.diagram-zoom-out` 存在则跳过），不会和 Crepe 原生 UI 冲突
3. `window.__notezDiagramZoom/Copy` 桥接在 `main.tsx` 中独立安装，不依赖 patch
4. 唯一需要验证的是 DOMPurify 对图表 SVG 的保真度

**决策路径：**

```
阶段 0 验证：删 patch → 图表 SVG 渲染正常？
  ├─ 是 → 阶段 1 正式删除，DOM 注入为唯一路径
  └─ 否（SVG 被 DOMPurify 截断）
       ├─ 方案 A-mini：保留 ~8 行最小 patch（仅 PreviewPanel appendChild 绕过）
       └─ 或：在 Crepe 配置中 hook DOMPurify（ADD_TAGS / ALLOWED_ATTR）
```

**降级方案 A-mini（若 SVG 保真度不过关）：**

将 374 行 patch 缩减为仅保留 `PreviewPanel` 的 `.diagram-preview` 绕过逻辑（约 8 行 diff），删除全部 Vue 工具栏组件和 3 状态切换代码。

---

## 架构

维持现有组件边界，不引入新引擎：

```
MarkdownEditor.tsx
  ├─ edit / split → CodeMirror（不变）
  └─ wysiwyg    → WysiwygEditor.tsx → Crepe + CodeMirror feature config
                        ├─ diagramRenderers.ts   （renderPreview 注册表，不变）
                        ├─ diagramZoom.ts        （缩放逻辑 + DOM 注入，唯一路径）
                        └─ diagramCopy.ts        （复制逻辑 + DOM 注入，唯一路径）
```

### 依赖关系

| 模块 | 职责 | 本方案改动 |
|------|------|-----------|
| `WysiwygEditor.tsx` | Crepe 生命周期、`CrepeFeature.CodeMirror` 配置 | 不变（Observer 已在此启动） |
| `diagramRenderers.ts` | `codeBlockRenderPreview`、语言注册 | 不变 |
| `patches/@milkdown+components+*.patch` | Vue 层工具栏注入 | **删除** |
| `diagramZoom.ts` | 缩放控制器 + DOM 注入 | **保留并正式化**；移除注释中的「fallback」措辞 |
| `diagramCopy.ts` | 复制逻辑 + `window.__notezDiagramCopy` 桥接 | **保留桥接**（DOM 注入路径仍需要） |
| `useCrepeThemeStylesheet.ts` | Crepe 主题 CSS | 不变 |
| `OutlinePanel.tsx` | 大纲跳转（含 wysiwyg 容器） | 不变 |
| `package.json` | `postinstall: patch-package` | 评估是否仍有其他 patch；若无则移除 `patch-package` |

### DOM 注入锚点依赖

DOM 注入路径依赖以下 Milkdown 渲染的 CSS 类名/结构：

| 锚点 | 用途 | 稳定性评估 |
|------|------|-----------|
| `.milkdown-code-block` | 定位代码块容器 | 高（Milkdown 公开 API 文档命名） |
| `.tools-button-group` | 注入工具栏按钮的父容器 | 中（内部 UI 类名，minor 版本一般不改） |
| `.language-button` | 读取当前语言判断是否为图表 | 中 |
| `.copy-button` | insertBefore 锚点 | 中 |

**升级策略：** Milkdown minor 升级时，跑手工冒烟用例 1–4（见测试计划）；若按钮不出现，检查锚点类名变更。

---

## 实施阶段

### 阶段 0：验证删除 patch 可行（0.5–1 天）

**目的：** 确认删除 patch 后：(1) 工具栏按钮仍正常；(2) 图表 SVG 渲染保真度无退化。

**任务：**

1. 在 dev 分支中删除 `patches/@milkdown+components+7.19.2.patch`
2. 运行 `npm install`（注释掉 postinstall 或移除 patch 文件即可）
3. 启动 `npm run tauri dev`，执行手工冒烟用例 1–6（见测试计划）
4. **重点验证 SVG 保真度：**
   - 打开含 `skinparam` 样式的 PlantUML 序列图 → 预览 → 检查颜色/字体/渐变是否正确
   - 打开 Mermaid 流程图 → 预览 → 检查边框/箭头/文字
   - 对比「有 patch」和「无 patch」下同一图表的渲染结果（截图对比）
5. 确认 DOM 注入的缩放/复制按钮独立出现且功能正常

**验收：**

- [ ] 图表代码块（plantuml/mermaid）预览展开后，缩放按钮可见且 ±/重置 正常
- [ ] 图表代码块复制按钮可用（代码 + 图片两种模式）
- [ ] **PlantUML SVG 渲染与有 patch 时目视一致**（重点：skinparam 主题色、`<defs>` 渐变、`<style>` 内 CSS）
- [ ] **Mermaid SVG 渲染与有 patch 时目视一致**
- [ ] 普通代码块（如 `java`）工具栏无多余图表按钮
- [ ] `npx vitest run` 相关测试通过
- [ ] 模式切换全屏 ↔ 分屏 ↔ 源码内容不丢失

**分析路径：** 若 SVG 渲染异常（颜色丢失、元素缺失），使用浏览器 DevTools 对比 `DOMPurify.sanitize(element)` 的输出与原始 element 的 `outerHTML`，定位被 strip 的标签/属性。

### 阶段 1：正式删除 patch + 代码清理（1–2 天）

**前置条件：** 阶段 0 验证通过（SVG 保真度 OK）。

**若 SVG 保真度不过关：** 执行 **阶段 1-alt**（见下方）。

**任务：**

1. 删除 `patches/@milkdown+components+7.19.2.patch`
2. 若无其他 patch，从 `package.json` 移除 `patch-package` 依赖和 `postinstall` 脚本
3. `diagramZoom.ts`：移除注释中的「fallback if Vue patch hides them」措辞，正式化为唯一注入路径
4. `diagramCopy.ts`：保留 `window.__notezDiagramCopy` 桥接（DOM 注入仍使用）；移除注释中的「Used by patches/」描述
5. 更新测试：`diagramZoom.test.ts`、`diagramCopy.test.ts` 中 patch 相关的 mock/描述
6. 升级 `@milkdown/crepe`、`@milkdown/kit`、`@milkdown/react` 至 7.20.0（此时无 patch 阻碍）

**验收：**

- [ ] `npm install && npm run dev` 干净启动，无 patch 报错
- [ ] `npx vitest run` 全部通过
- [ ] 手工冒烟用例 1–6 通过（含 SVG 保真度）
- [ ] `git diff --stat` 确认 patch 文件已移除

### 阶段 1-alt：最小 patch（若 SVG 保真度不过关）

**前置条件：** 阶段 0 发现 DOMPurify 破坏图表 SVG 渲染。

**策略：** 将 374 行 patch 缩减为 ~8 行，仅保留 `PreviewPanel` 的 `.diagram-preview` 直接 append 逻辑：

```diff
// preview-panel 中唯一需要保留的改动
+ if (previewContent instanceof Element && previewContent.classList.contains("diagram-preview")) {
+   previewContainer.appendChild(previewContent);
+   return;
+ }
  if (typeof previewContent === 'string' || previewContent instanceof Element) {
    previewContainer.innerHTML = DOMPurify.sanitize(previewContent);
  }
```

**删除的内容：**
- 全部 `DiagramZoomButtons` Vue 组件（~95 行）
- 全部 `DiagramCopyButton` Vue 组件（~145 行）
- `previewPanelExpanded` / `previewHiddenByDefault` 逻辑（~40 行）
- 3 状态切换 / 眼睛图标相关（~30 行）

**效果：** patch 从 374 行降至 <15 行，升级合并成本大幅降低；工具栏仍由 DOM 注入提供。

### 阶段 2：文档与体验收尾（0.5 天）

**任务：**

1. 全屏模式 UI 文案：`Typora 风格所见即所得` → `所见即所得`（`MarkdownEditor.tsx` `MODE_BUTTONS`）
2. `AGENTS.md` 补充：图表代码块工具栏通过 DOM 注入（`diagramZoom.ts` / `diagramCopy.ts`）实现，依赖锚点类名
3. 更新本文档「实施结果」小节

**预估总工期：2–3.5 天（含验证 + 清理 + 文档）**

---

## 数据流（代码块图表，保持不变）

```
用户编辑 plantuml 代码块
  → Crepe CodeMirror feature（previewOnlyByDefault: true）
  → 失焦 / 预览展开：codeBlockRenderPreview(lang, code, applyPreview)
  → diagramRenderers 注册表 → renderPlantUMLOffline / mermaid
  → applyPreview(HTMLElement | SVG string)
  → MutationObserver 检测到 .milkdown-code-block 新增/变更
  → ensureWysiwygDiagramZoomToolbars：注入缩放按钮
  → startWysiwygDiagramCopyObserver：注入复制按钮（含代码/图片模式切换）
```

---

## 错误处理

| 场景 | 行为 |
|------|------|
| PlantUML/Mermaid 渲染失败 | 沿用 `plantumlErrorUi` / `formatMermaidErrorHtml`，工具栏仍可用 |
| Milkdown 升级导致锚点类名变更 | DOM 注入无按钮出现 → 手工冒烟发现 → 修改选择器（通常 1-2 行） |
| `.tools-button-group` 容器不再存在 | Observer 静默跳过，无崩溃；图表仍可预览，仅缩放/复制不可用 |
| `window.__notezDiagramCopy` 被意外清除 | 复制按钮点击后 toast 报错「复制失败」；降级不崩溃 |
| Crepe major 版本重构 DOM 结构 | 触发备选方案 B 评估 |

---

## 测试计划

### 自动化

- `npx vitest run src/components/__tests__/diagramZoom.test.ts`
- `npx vitest run src/components/__tests__/diagramCopy.test.ts`
- `npx vitest run src/components/__tests__/diagramCopyImage.test.ts`

### 手工冒烟（`plantuml-test.md` 或等价文档）

1. 全屏模式：插入 plantuml 代码块 → 预览 → 缩放 ±/重置
2. 全屏模式：复制代码 / 复制图片（含模式下拉）
3. 全屏模式：mermaid 代码块同上
4. 全屏模式：普通 `java` 代码块无图表工具栏
5. 模式切换：全屏 ↔ 分屏 ↔ 源码，内容不丢失
6. `npm install` 干净环境（无 patch 或最小 patch）重复 1–5
7. **SVG 保真度（阶段 0 重点）：** PlantUML 含 `skinparam` 主题色 → 预览 → 颜色/渐变/字体正确
8. **SVG 保真度：** PlantUML 含 `note`/`legend` → 预览 → 背景色/边框渲染正确
9. **SVG 保真度：** Mermaid 流程图含自定义主题 → 预览 → 与分屏预览目视一致

---

## 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| **DOMPurify 截断图表 SVG** | 中 | 颜色/渐变/字体丢失 | 阶段 0 目视验证；失败则执行阶段 1-alt（最小 patch） |
| 删除 patch 后 DOM 注入未覆盖某冷门路径 | 低 | 某些代码块场景工具栏缺失 | 阶段 0 全量冒烟验证 |
| Milkdown minor 升级变更 `.tools-button-group` 类名 | 低–中 | 缩放/复制按钮消失 | 升级前跑冒烟；修复为 1-2 行选择器改动 |
| 预览面板从 3 状态退化为 2 状态 | 确定 | 用户无法「折叠预览」（仅 preview-only ↔ edit+preview） | NoteZ 使用 `previewOnlyByDefault: true`，差异极小 |
| Milkdown major 版本重构代码块 DOM 结构 | 低 | DOM 注入方案失效 | Pin 版本 + 触发方案 B 评估 |
| Milkdown 升级破坏 `renderPreview` 契约 | 低 | 图表预览失效 | Pin 版本；升级前跑 fixture 测试 |
| 去掉 patch 后复制图片在 WebView2 失效 | 极低 | 复制图片功能退化 | `diagramCopyImage.ts` 单测 + Tauri 手工验证 |
| 移除 `patch-package` 后未来其他 patch 需求无工具 | 低 | 新 patch 需重新安装工具 | 按需 `npm i -D patch-package`，成本极低 |

### 收益/损失分析

| 维度 | 收益 | 损失/代价 |
|------|------|-----------|
| 升级自由度 | Milkdown 可升至 7.20.0+，无需合并 374 行 patch | 无（或仅 <15 行 mini-patch） |
| 代码可理解性 | 从三层（patch + Vue + DOM）降为一层（DOM） | 无 |
| 调试效率 | 工具栏问题只需看 `diagramZoom.ts` / `diagramCopy.ts` | 无 |
| 预览面板 UX | — | 失去「折叠预览」第三状态（影响极小） |
| SVG 保真度 | — | 若 DOMPurify 有问题需保留 mini-patch | 阶段 0 验证 |
| 健壮性 | DOM 注入仅依赖 4 个 CSS 选择器 | 选择器变更时需 1-2 行修复 |
| 工期 | 2–3.5 天 | 机会成本 |
| 长期维护 | 减少 360+ 行 patch + 解锁 Milkdown 升级 | 需关注 Milkdown 升级时 DOM 结构 |

---

## 实施结果

> **阶段 0 验证完成（2026-07-04）。**

| 项目 | 结论 |
|------|------|
| 删除 patch 后工具栏按钮功能完整？ | **是** — DOM 注入（MutationObserver）独立运作，缩放/复制按钮均正常 |
| PlantUML SVG 经 DOMPurify 后渲染正确？ | **是** — 颜色、字体、渐变、虚线全部保留（自动化测试验证） |
| Mermaid SVG 经 DOMPurify 后渲染正确？ | **否** — `<foreignObject>` 内 XHTML 标签被清除，节点文字丢失 |
| 执行路径 | **阶段 1-alt（mini-patch）** — 需保留 3 行 DOMPurify 绕过 |
| Patch 体积 | **374 行 → 31 行（−92%）**；仅保留 `diagram-preview` Element 直接 appendChild |
| 是否可移除 `patch-package` | **否** — 仍需 mini-patch；但也可删除 crepe patch（无人消费） |
| 升级至 Milkdown 版本 | 解锁——mini-patch 仅 3 行条件判断，合并冲突概率极低 |

### 额外发现：Zoom Observer 竞态 Bug

验证过程中发现 `ensureWysiwygDiagramZoomToolbars` 与 `ensureWysiwygDiagramCopyToolbars` 存在竞态：
- Copy observer 将 `.copy-button` 替换为 `.diagram-copy-group`
- Zoom observer 用 `group.querySelector('.copy-button')` 找锚点 `insertBefore`
- 替换后该元素不再是 `.tools-button-group` 的直接子节点，`insertBefore` 静默失败
- **修复**：改用 `:scope >` 限定直接子元素 + 同时匹配 `.diagram-copy-group`
- 此 bug 在旧 patch 下被掩盖（Vue 组件直接渲染按钮，不依赖 DOM 注入）

---

## 决策记录

| 日期 | 决策 |
|------|------|
| 2026-07-03 | 批准方案 A；Typora 体验非硬性需求；方案 B 存档待后续评估 |
| 2026-07-03 | 不迁移 MDXEditor；不删除 wysiwyg 模式 |
| 2026-07-04 | 可行性审核：确认 Crepe 无代码块工具栏官方扩展点；修正策略为「正式化 DOM 注入 + 删除 patch」；取消原 Spike 目标 |
| 2026-07-04 | 二次审核：发现 patch 含 DOMPurify 绕过逻辑（非仅按钮）；新增阶段 1-alt 作为 SVG 保真度不过关时的降级路径；将 SVG 目视验证纳入阶段 0 验收标准 |
| 2026-07-04 | 阶段 0 完成：确认走阶段 1-alt；patch 从 374→31 行；修复 zoom/copy observer 竞态 bug；crepe patch 可移除 |
