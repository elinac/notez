# PlantUML 渲染失败 — 内联代码视图设计

> **日期**: 2026-07-04  
> **状态**: 已批准（v3 — 经 API 审核修正）  
> **范围**: 分屏模式 + WYSIWYG 模式  
> **React**: ^19.1.0 | **Milkdown Crepe**: ^7.19.2

---

## 1. 概述

当 PlantUML 渲染失败时，预览区不再显示独立的错误卡片，而是直接展示 PlantUML 源码（带行号），将报错行标红，并在错误行下方固定显示一个悬浮气泡框（包含错误摘要、行号徽章和 AI 修复按钮）。

### 目标

- 用户在预览区即可一眼看到出错的源码上下文，无需展开折叠
- 错误位置直观——红色行 + 气泡锚定
- AI 修复入口保持一键可达

---

## 2. 组件结构

### 2.1 新增组件 `PlantUMLErrorCodeView`

```typescript
interface PlantUMLErrorCodeViewProps {
  source: string;        // PlantUML 完整源码
  errorMessage: string;  // 错误摘要文本
  errorLine?: number;    // 报错行号（1-based），可能为 undefined
}
```

内部结构：

```tsx
<div className="puml-error-code-view" style={{ position: 'relative' }}>
  <div className="puml-error-code-view__lines">
    {lines.map((line, i) => <CodeLine key={i} ... />)}
  </div>
  {errorLine && <ErrorBubble ... />}
</div>
```

### 2.2 子组件

| 组件 | 职责 |
|------|------|
| `CodeLine` | 单行渲染：行号 + 代码文本，错误行附加红色背景 class |
| `ErrorBubble` | 气泡框：错误摘要 + 行号徽章 + AI 修复按钮 |

### 2.3 暗色主题检测

`PlantUMLErrorCodeView` 在两种挂载方式下（Portal / createRoot）均可能不在主 React Context 树内。因此暗色主题不依赖 React Context，而是通过 `useSettingsStore`（Zustand 全局 store）的 `editorColorMode` 字段或 `document.documentElement.classList.contains('dark')` 检测。

### 2.4 可访问性

- 代码块容器：`role="region"` + `aria-label="PlantUML 源码，渲染出错"`
- 错误行：`aria-invalid="true"`
- 气泡框：`role="alert"` + `aria-live="polite"`

---

## 3. 数据流改造

`renderPlantUMLOffline()` 返回类型从 `string` 改为联合类型：

```typescript
export type RenderResult =
  | { ok: true; html: string }
  | { ok: false; source: string; error: string; line?: number }
```

- 成功时返回 SVG HTML
- 失败时返回结构化错误信息（不再返回错误 HTML 字符串）
- 类型定义放在 `PlantUMLOfflineRenderer.ts` 中导出
- 调用方仅 2 处（`PlantUMLRenderer.tsx`、`diagramRenderers.ts`），改动可控

---

## 4. 视觉设计

### 4.1 代码块

```
┌─────────────────────────────────────────────────────────┐
│  1 │ @startuml                                          │
│  2 │ participant Alice                                  │
│  3 │ participant Bob                                    │
│ ✕4 │ Alice ->> Bob 缺少冒号与标签                       │ ← 红色背景
│  5 │ Bob --> Alice : ok                                 │
│  6 │ @enduml                                           │
│    ┌──────────────────────────────────┐                 │
│    │ ⚠ 第 4 行  Syntax Error?        │                 │
│    │ (Assumed diagram type: sequence) │                 │
│    │                    [ AI 修复 ]   │                 │
│    └──────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

### 4.2 样式规格

**代码块容器：**
- 背景：亮色 `#fafafa`，暗色 `#1e1e1e`
- 字体：等宽，继承 `--editor-font-family`
- 顶部可选 `plantuml` 语言标签（灰色小字）
- `max-height: 400px`，超出垂直滚动

**错误行：**
- 整行背景：`rgba(239, 68, 68, 0.12)`（暗色模式 `0.15`）
- 行号文字：红色
- 左侧：3px 红色竖条
- 行号位置显示 ✕ 图标

**气泡框：**
- 位置：紧贴错误行下方，左对齐于代码区起始位置
- 背景：亮色 `#ffffff`，暗色 `#2d2d2d`
- 左边框：`3px solid #ef4444`
- 阴影：`0 2px 8px rgba(0,0,0,0.12)`
- 圆角：6px
- 内容第一行：⚠ 图标 + 红色行号徽章 + 错误摘要
- 右下角：蓝色「AI 修复」按钮（延续现有 `.plantuml-ai-fix-btn` 样式）

---

## 5. 模式集成

### 5.1 分屏模式 — `createPortal`

**架构事实**：`PlantUMLRenderer.tsx` 使用 `useLayoutEffect` + `ref.innerHTML` 注入全部 Markdown HTML，然后在异步循环中逐个填充 `.plantuml-container` 占位元素。

**选择 `createPortal` 的理由**（React 官方推荐）：
> "When you want to render a piece of JSX in a different part of the DOM tree that isn't a child of your component, use `createPortal` instead of `createRoot`." —— react.dev/reference/react-dom/client/createRoot

**改造方式**：

```tsx
import { useState } from 'react';
import { createPortal } from 'react-dom';

type ErrorPortalEntry = { node: HTMLElement; source: string; error: string; line?: number };

export function PlantUMLRenderer({ content, previewDocumentId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plantUmlTheme = useSettingsStore((s) => s.plantUmlTheme);
  const [errorPortals, setErrorPortals] = useState<ErrorPortalEntry[]>([]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const html = renderMarkdownWithPlantUML(content);
    containerRef.current.innerHTML = html;
    setErrorPortals([]); // 清除上一轮 portals

    // ... diagram block zoom init ...

    const plantUMLBlocks = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>('.plantuml-container')
    );
    const themeForThisPass = plantUmlTheme;

    (async () => {
      const errors: ErrorPortalEntry[] = [];
      for (const block of plantUMLBlocks) {
        if (cancelled) return;
        const code = block.getAttribute('data-plantuml-code');
        if (!code) continue;
        const decoded = /* HTML decode */;
        const result = await renderPlantUMLOffline(decoded, themeForThisPass);
        if (cancelled) return;
        if (!containerRef.current?.contains(block)) continue;

        if (result.ok) {
          block.innerHTML = scopeSvgIdsForHtmlDocument(result.html);
        } else {
          block.innerHTML = ''; // 清空 loading 占位
          errors.push({ node: block, source: result.source, error: result.error, line: result.line });
        }
      }
      if (!cancelled && errors.length > 0) {
        setErrorPortals(errors);
      }
    })();

    return () => { cancelled = true; };
  }, [content, plantUmlTheme, previewDocumentId]);

  return (
    <>
      <div ref={containerRef} className="diagram-color-fix prose prose-slate max-w-none p-4" />
      {errorPortals.map(({ node, source, error, line }, i) =>
        createPortal(
          <PlantUMLErrorCodeView key={i} source={source} errorMessage={error} errorLine={line} />,
          node
        )
      )}
    </>
  );
}
```

**生命周期保证**：
- `setErrorPortals([])` 在 effect 开头清除旧 portals（防止 portal 渲染到已销毁的 DOM）
- `setErrorPortals(errors)` 在异步循环完成后触发 re-render，此时 block 节点仍在 containerRef 的 DOM 中
- 下次 deps 变化 → effect cleanup 设置 `cancelled = true` → 新 effect 执行 `innerHTML = ...`（替换 DOM）→ 同步调用 `setErrorPortals([])`

**关键顺序**：
1. 旧 effect cleanup: `cancelled = true`（不触发 re-render，不移除 portals）
2. 新 effect body: `innerHTML = html`（旧 DOM 被替换，此时旧 portals 的目标节点被移除——React Portal 对目标节点被移除的处理是安全的，不会 crash）
3. 新 effect body: `setErrorPortals([])`（排队状态更新）
4. React 处理排队更新 → re-render → portals 数组为空 → 不再尝试渲染到旧节点

**注意**: React Portal 在目标节点被移除后不会 crash（它内部检查节点是否可用），但旧 portal 在步骤 2-4 之间短暂指向已移除的节点。由于这发生在同一同步 `useLayoutEffect` 内（浏览器未 repaint），用户不会看到任何闪烁。

### 5.2 WYSIWYG 模式 — `createRoot` + `flushSync`

**架构事实**：`diagramRenderers.ts` 中注册的 `DiagramRenderer` 返回 `Promise<string | HTMLElement>`。该函数在 Milkdown 的异步回调中执行，**不在 React 生命周期方法内**，因此 `flushSync` 合法可用。

**选择 `createRoot`（非 Portal）的理由**：WYSIWYG 模式下 Milkdown 管理 DOM，不在 React 组件树内，无法使用 `createPortal`（它需要在组件的 render 输出中声明）。

**改造方式**：

```typescript
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

function renderErrorToElement(result: { source: string; error: string; line?: number }): HTMLElement {
  const container = document.createElement('div');
  container.className = 'puml-error-code-view-wysiwyg-host';
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <PlantUMLErrorCodeView
        source={result.source}
        errorMessage={result.error}
        errorLine={result.line}
      />
    );
  });
  return container;
}

registerDiagramRenderer('plantuml', async (code) => {
  const result = await renderPlantUMLOffline(code);
  if (result.ok) return scopeSvgIdsForHtmlDocument(result.html);
  return renderErrorToElement(result);
});
```

**`flushSync` 安全性**：
- React 官方文档确认：`flushSync` **不得**在 `useEffect`/`useLayoutEffect`/render 内调用
- 此处调用链：Milkdown `renderPreview` 回调 → `codeBlockRenderPreview` → `renderDiagramPreview` → `renderer(code)` → `renderErrorToElement`
- 全程在 Milkdown 的事件驱动异步上下文中，不在 React 生命周期内 ✅

**错误视图跳过 zoom 容器**：在 `renderDiagramPreview` 中增加判断：

```typescript
if (typeof result !== 'string' && result.querySelector?.('.puml-error-code-view')) {
  applyPreview(result); // 直接使用，不包裹 zoom
  return true;
}
```

### 5.3 WYSIWYG 孤儿 Root（已知限制）

Milkdown 的 `renderPreview` 无 cleanup 回调。旧 preview element 被替换时，其 React root 的 `unmount()` 无法调用。

**影响评估**：
- React 官方：「The components inside the removed root won't know to clean up and free up global resources like subscriptions.」
- `PlantUMLErrorCodeView` 无 `useEffect`、无订阅、无定时器——唯一的交互是按钮 `onClick`（挂在脱离 DOM 的节点上无害）
- 内存：脱离 DOM 的 React fiber 节点被 root 引用。Root 本身被 `container` 引用。`container` 被 Milkdown 从 DOM 移除后，如无其他 JS 引用，container + root + fiber 均可被 GC
- 结论：**无实际泄漏**（无全局引用持有 container）

### 5.4 AI 修复按钮集成

气泡内按钮直接调用 Zustand store（全局 store，不依赖 React Context）：

```typescript
const handleFix = () => {
  useAppStore.getState().requestPlantUmlAiFix({ source, errorMessage, errorLine });
};
```

消除 `registerPlantUmlFixPayload` / `consumePlantUmlFixPayload` 在新路径中的使用。

---

## 6. 边界情况

### 6.1 行号未知

- 不标红任何行
- 气泡显示在代码块底部
- 气泡内不显示行号徽章

### 6.2 多个 PlantUML 代码块

各代码块独立渲染，各有独立的 Portal/Root 和气泡。

### 6.3 超长源码

- 容器 `max-height: 400px`，垂直滚动
- 气泡随代码滚动（`position: absolute` 在容器内）
- `scrollIntoView` 在组件的 `useEffect` 中执行（确保 DOM 已渲染）：
  ```typescript
  useEffect(() => {
    if (errorLine && errorLineRef.current) {
      errorLineRef.current.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [errorLine]);
  ```

### 6.4 渲染状态切换

- 编辑后渲染成功 → `errorPortals` 状态清空 → Portal 卸载 → block 被 SVG innerHTML 替换
- 编辑后仍然失败 → Portal props 更新（新源码/错误/行号）
- Portal 的 `key` 使用 block 索引（块位置不变时复用组件状态）

### 6.5 暗色主题

- 代码块背景：`#1e1e1e`
- 错误行背景透明度微调：`0.15`
- 气泡背景：`#2d2d2d`
- 通过 `useSettingsStore` 读取 `editorColorMode` 或检测 DOM class

---

## 7. 向后兼容与迁移策略

- `renderPlantUMLOffline()` 返回类型从 `string` 改为 `RenderResult`
- `formatPlantUmlErrorHtml()` 保留并标记 `@deprecated`，不再被主路径调用
- 全局 click 委托（`App.tsx`）保留，作为未迁移路径的兜底
- `registerPlantUmlFixPayload` / `consumePlantUmlFixPayload` 在新路径中不使用，后续可清理
- `RenderResult` 类型定义放在 `PlantUMLOfflineRenderer.ts` 中并导出

---

## 8. 文件变更范围

| 文件 | 变更类型 |
|------|----------|
| `src/components/plantuml-offline/PlantUMLErrorCodeView.tsx` | **新增** — 核心 React 组件 |
| `src/components/plantuml-offline/PlantUMLOfflineRenderer.ts` | **修改** — 返回 `RenderResult` 联合类型 |
| `src/components/plantuml-offline/plantumlErrorUi.ts` | **修改** — 标记旧函数 deprecated，导出 `parsePlantUmlErrorLine` |
| `src/components/PlantUMLRenderer.tsx` | **修改** — 添加 `errorPortals` state + `createPortal` 渲染 |
| `src/components/diagramRenderers.ts` | **修改** — renderer 适配层 + `renderErrorToElement` + 跳过 zoom 容器 |
| `src/App.css` | **修改** — 新增 `.puml-error-code-view*` 样式系列 |
| `src/components/__tests__/PlantUMLRenderer.test.tsx` | **修改** — mock 返回值改为 `RenderResult` 格式 |
| `src/components/__tests__/PlantUMLRealRender.test.ts` | **修改** — 同上 |
| `src/components/__tests__/PlantUMLE2E.test.ts` | **修改** — 同上 |

---

## 9. 不在范围内

- 纯源码编辑模式（`edit` mode）的错误提示
- PlantUML 语法高亮（代码块内纯文本显示，不做关键字着色）
- 错误行的自动修复（仅提供 AI 修复入口）

---

## 10. API 审核备注

| 项 | 验证结果 |
|----|----------|
| React `createPortal` | 官方推荐用于「render JSX in a different part of the DOM tree」 ✅ |
| React `createRoot` 在 WYSIWYG 中 | Milkdown 回调不在 React lifecycle 内，合法 ✅ |
| React `flushSync` | 不在 effect/render 内调用，合法；确保同步渲染以返回非空 DOM ✅ |
| Milkdown `renderPreview` 签名 | `@milkdown/components` 实际安装版本确认为 3 参数异步版本（含 `applyPreview`）✅ |
| Zustand `useAppStore.getState()` | 全局 store 不依赖 React Context，在 createRoot 隔离树内可正常工作 ✅ |
| Portal 目标节点被移除 | React Portal 对此不会 crash（内部安全处理），仅短暂存在于同步 effect 内，用户不可感知 ✅ |
