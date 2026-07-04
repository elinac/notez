# PlantUML 内联代码视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PlantUML 渲染失败时，在分屏/WYSIWYG 预览区直接展示带行号的源码、标红错误行，并在错误行附近显示含 AI 修复按钮的悬浮气泡。

**Architecture:** `renderPlantUMLOffline` 返回 `RenderResult` 联合类型；新增 `PlantUMLErrorCodeView` React 组件；分屏模式通过 `createPortal` 挂载到 `.plantuml-container`；WYSIWYG 模式通过 `createRoot` + `flushSync` 返回 `HTMLElement`，并跳过 zoom 包裹。

**Tech Stack:** React 19, Zustand, Vitest + @testing-library/react, Milkdown Crepe 7.19, Tauri invoke (mock in tests)

**Spec:** `docs/superpowers/specs/2026-07-04-plantuml-error-inline-code-view.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/components/plantuml-offline/PlantUMLOfflineRenderer.ts` | 定义并导出 `RenderResult`；失败时返回结构化错误 |
| `src/components/plantuml-offline/plantumlErrorUi.ts` | 行号解析、摘要格式化；`formatPlantUmlErrorHtml` 标记 deprecated |
| `src/components/plantuml-offline/PlantUMLErrorCodeView.tsx` | 错误源码视图 + 气泡 + AI 修复按钮 |
| `src/components/plantuml-offline/renderPlantUmlErrorToElement.tsx` | WYSIWYG 专用：`createRoot` + `flushSync` 同步渲染 |
| `src/components/PlantUMLRenderer.tsx` | 分屏：`errorPortals` state + `createPortal` |
| `src/components/diagramRenderers.ts` | PlantUML renderer 适配 + 错误视图跳过 zoom |
| `src/App.css` | `.puml-error-code-view*` 样式 |
| `src/components/plantuml-offline/__tests__/PlantUMLErrorCodeView.test.tsx` | 组件单测 |
| `src/components/__tests__/PlantUMLRealRender.test.ts` | `RenderResult` 集成测 |
| `src/components/__tests__/PlantUMLRenderer.test.tsx` | mock 与 portal 行为 |

---

### Task 1: `RenderResult` 类型与 `renderPlantUMLOffline` 改造

**Files:**
- Modify: `src/components/plantuml-offline/PlantUMLOfflineRenderer.ts`
- Modify: `src/components/plantuml-offline/plantumlErrorUi.ts`
- Test: `src/components/__tests__/PlantUMLRealRender.test.ts`

- [ ] **Step 1: 导出 `formatPlantUmlErrorSummary` 供组件复用**

在 `src/components/plantuml-offline/plantumlErrorUi.ts` 将 `formatPlantUmlErrorSummary` 改为 export：

```typescript
/** Human-readable error summary (hide redundant exit code / standalone line no). */
export function formatPlantUmlErrorSummary(message: string, errorLine?: number): string {
  // 保持现有实现不变
}
```

在 `formatPlantUmlErrorHtml` 上方添加 JSDoc：

```typescript
/** @deprecated 主路径改用 PlantUMLErrorCodeView；保留供全局 click 委托兜底 */
export function formatPlantUmlErrorHtml(message: string, source: string): string {
```

- [ ] **Step 2: 写失败用例（RenderResult 结构）**

在 `src/components/__tests__/PlantUMLRealRender.test.ts` 顶部 success 用例之后，先改 REAL-1 期望（下一步），并新增：

```typescript
it('REAL-2: invoke 抛错时返回 ok:false RenderResult', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('PlantUML 退出码 Some(1): syntax error'));
  const src = '@startuml\nbad\n@enduml';
  const result = await renderPlantUMLOffline(src);

  expect(result).toEqual({
    ok: false,
    source: src,
    error: 'PlantUML 退出码 Some(1): syntax error',
    line: undefined,
  });
});

it('REAL-2b: JAR 错误含行号时 line 字段为解析结果', async () => {
  const msg = 'PlantUML 退出码 Some(200): ERROR\n3\nSyntax Error?';
  vi.mocked(invoke).mockRejectedValue(new Error(msg));
  const src = '@startuml\npackage"X"\n@enduml';
  const result = await renderPlantUMLOffline(src);

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  expect(result.line).toBe(3);
  expect(result.source).toBe(src);
  expect(result.error).toContain('Syntax Error?');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/components/__tests__/PlantUMLRealRender.test.ts -t "REAL-2" -v`

Expected: FAIL（返回 string 而非 `{ ok: false }`）

- [ ] **Step 4: 实现 `RenderResult` 与失败分支**

在 `src/components/plantuml-offline/PlantUMLOfflineRenderer.ts`：

```typescript
import {
  parsePlantUmlErrorLine,
} from './plantumlErrorUi';

export type RenderResult =
  | { ok: true; html: string }
  | { ok: false; source: string; error: string; line?: number };

export async function renderPlantUMLOffline(
  source: string,
  themeOverride?: string
): Promise<RenderResult> {
  try {
    const html = await tryRenderBundledPlantuml(source, themeOverride);
    return { ok: true, html };
  } catch (error) {
    console.error('[PlantUML] offline render error:', error);
    const message = toDisplayMessage(error);
    return {
      ok: false,
      source,
      error: message,
      line: parsePlantUmlErrorLine(message),
    };
  }
}
```

删除 `import { formatPlantUmlErrorHtml } from './plantumlErrorUi'`。

更新文件头注释：失败时返回 `RenderResult` 的 `ok: false` 分支。

- [ ] **Step 5: 更新 REAL-1 成功用例**

```typescript
const result = await renderPlantUMLOffline(src);
expect(result.ok).toBe(true);
if (!result.ok) throw new Error('expected success');
expect(result.html.trim()).toMatch(/^<svg/);
expect(result.html).toContain('plantuml-jar');
expect(result.html).not.toContain('plantuml-error');
```

对文件中所有 `const result = await renderPlantUMLOffline` 的成功路径做同样调整；错误路径改为 `expect(result.ok).toBe(false)` 并断言 `source`/`error`/`line`，**不再**断言 `plantuml-error` HTML 字符串。

REAL-1h/1i/2/2b/3 示例：

```typescript
const result = await renderPlantUMLOffline('@startuml\nx\n@enduml');
expect(result.ok).toBe(false);
if (result.ok) throw new Error('expected failure');
expect(result.error).toContain('不支持的 PlantUML 后端');
expect(result.source).toContain('@startuml');
```

- [ ] **Step 6: 运行完整 RealRender 测试**

Run: `npx vitest run src/components/__tests__/PlantUMLRealRender.test.ts -v`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/plantuml-offline/PlantUMLOfflineRenderer.ts src/components/plantuml-offline/plantumlErrorUi.ts src/components/__tests__/PlantUMLRealRender.test.ts
git commit -m "refactor(plantuml): return RenderResult from renderPlantUMLOffline"
```

---

### Task 2: `PlantUMLErrorCodeView` 组件

**Files:**
- Create: `src/components/plantuml-offline/PlantUMLErrorCodeView.tsx`
- Create: `src/components/plantuml-offline/__tests__/PlantUMLErrorCodeView.test.tsx`

- [ ] **Step 1: 写组件失败测试**

创建 `src/components/plantuml-offline/__tests__/PlantUMLErrorCodeView.test.tsx`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlantUMLErrorCodeView } from '../PlantUMLErrorCodeView';
import { useAppStore } from '../../../store/useAppStore';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(),
  },
}));

const SOURCE = `@startuml
participant Alice
participant Bob
Alice ->> Bob missing colon
Bob --> Alice : ok
@enduml`;

describe('PlantUMLErrorCodeView', () => {
  beforeEach(() => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      requestPlantUmlAiFix: vi.fn(),
    } as ReturnType<typeof useAppStore.getState>);
  });

  it('renders full source with line numbers and highlights error line', () => {
    render(
      <PlantUMLErrorCodeView
        source={SOURCE}
        errorMessage="Syntax Error? (Assumed diagram type: sequence)"
        errorLine={4}
      />
    );

    expect(screen.getByRole('region', { name: /PlantUML 源码，渲染出错/i })).toBeTruthy();
    expect(screen.getByText('Alice ->> Bob missing colon')).toBeTruthy();
    const errRow = screen.getByText('Alice ->> Bob missing colon').closest('.puml-error-code-view__line--err');
    expect(errRow).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(/第 4 行/);
    expect(screen.getByRole('alert')).toHaveTextContent(/Syntax Error/);
  });

  it('shows bubble at bottom without line badge when errorLine unknown', () => {
    render(
      <PlantUMLErrorCodeView source={SOURCE} errorMessage="unknown error" />
    );
    expect(screen.queryByText(/第 \d+ 行/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/unknown error/);
    expect(document.querySelector('.puml-error-code-view__line--err')).toBeNull();
  });

  it('AI fix button calls requestPlantUmlAiFix', () => {
    const requestPlantUmlAiFix = vi.fn();
    vi.mocked(useAppStore.getState).mockReturnValue({
      requestPlantUmlAiFix,
    } as ReturnType<typeof useAppStore.getState>);

    render(
      <PlantUMLErrorCodeView
        source={SOURCE}
        errorMessage="Syntax Error?"
        errorLine={4}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /AI 修复/i }));
    expect(requestPlantUmlAiFix).toHaveBeenCalledWith({
      source: SOURCE,
      errorMessage: 'Syntax Error?',
      errorLine: 4,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/plantuml-offline/__tests__/PlantUMLErrorCodeView.test.tsx -v`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件**

创建 `src/components/plantuml-offline/PlantUMLErrorCodeView.tsx`：

```tsx
import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useEffectiveEditorColorMode } from '../../hooks/useEffectiveEditorColorMode';
import { formatPlantUmlErrorSummary } from './plantumlErrorUi';

export interface PlantUMLErrorCodeViewProps {
  source: string;
  errorMessage: string;
  errorLine?: number;
}

function normalizeSourceLines(source: string): string[] {
  const lines = source.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function PlantUMLErrorCodeView({
  source,
  errorMessage,
  errorLine,
}: PlantUMLErrorCodeViewProps) {
  const errorLineRef = useRef<HTMLDivElement>(null);
  const colorMode = useEffectiveEditorColorMode();
  const isDark = colorMode === 'dark';

  const lines = normalizeSourceLines(source);
  const summary = formatPlantUmlErrorSummary(errorMessage, errorLine);

  useEffect(() => {
    if (errorLine && errorLineRef.current) {
      errorLineRef.current.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [errorLine, source]);

  const handleFix = () => {
    useAppStore.getState().requestPlantUmlAiFix({
      source,
      errorMessage,
      errorLine,
    });
  };

  return (
    <div
      className={`puml-error-code-view${isDark ? ' puml-error-code-view--dark' : ''}`}
      role="region"
      aria-label="PlantUML 源码，渲染出错"
    >
      <div className="puml-error-code-view__lang">plantuml</div>
      <div className="puml-error-code-view__lines">
        {lines.map((line, i) => {
          const lineNo = i + 1;
          const isErr = errorLine === lineNo;
          return (
            <div
              key={lineNo}
              ref={isErr ? errorLineRef : undefined}
              className={
                isErr
                  ? 'puml-error-code-view__line puml-error-code-view__line--err'
                  : 'puml-error-code-view__line'
              }
              aria-invalid={isErr ? true : undefined}
            >
              <span className="puml-error-code-view__line-no" aria-hidden="true">
                {isErr ? '✕' : ''}
                {lineNo}
              </span>
              <span className="puml-error-code-view__line-text">
                {line || '\u00a0'}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className={`puml-error-code-view__bubble${
          errorLine ? '' : ' puml-error-code-view__bubble--bottom'
        }`}
        role="alert"
        aria-live="polite"
        style={
          errorLine
            ? {
                // 气泡锚定在错误行下方：top = 行高 * (errorLine - 1) + 单行高度
                // 用 CSS 变量在 App.css 中定义行高，此处用 data 属性 + CSS 定位
              }
            : undefined
        }
        data-error-line={errorLine ?? undefined}
      >
        <div className="puml-error-code-view__bubble-main">
          <span className="puml-error-code-view__bubble-icon" aria-hidden="true">
            ⚠
          </span>
          {errorLine !== undefined && (
            <span className="puml-error-code-view__line-badge">第 {errorLine} 行</span>
          )}
          <span className="puml-error-code-view__bubble-summary">{summary}</span>
        </div>
        <button
          type="button"
          className="plantuml-ai-fix-btn puml-error-code-view__fix-btn"
          title="使用 AI 分析并修复语法错误"
          onClick={handleFix}
        >
          AI 修复
        </button>
      </div>
    </div>
  );
}
```

气泡定位：在 CSS 中用 `[data-error-line="N"]` 配合 `--puml-line-height` 计算 `top`，或在组件内用 ref 测量错误行 `offsetTop` 设置 bubble style。推荐实现（追加到组件）：

```tsx
const bubbleRef = useRef<HTMLDivElement>(null);

useLayoutEffect(() => {
  if (!errorLine || !errorLineRef.current || !bubbleRef.current) return;
  const top = errorLineRef.current.offsetTop + errorLineRef.current.offsetHeight + 4;
  bubbleRef.current.style.top = `${top}px`;
}, [errorLine, source, lines.length]);
```

需 `import { useLayoutEffect } from 'react'`。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run src/components/plantuml-offline/__tests__/PlantUMLErrorCodeView.test.tsx -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/plantuml-offline/PlantUMLErrorCodeView.tsx src/components/plantuml-offline/__tests__/PlantUMLErrorCodeView.test.tsx
git commit -m "feat(plantuml): add PlantUMLErrorCodeView component"
```

---

### Task 3: 样式 `App.css`

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: 追加样式块**

在 `src/App.css` 现有 `.plantuml-error` 区块之后追加（保留旧样式供 deprecated HTML 兜底）：

```css
/* ── PlantUML inline error code view (React) ── */
.puml-error-code-view {
  position: relative;
  background: #fafafa;
  border-radius: 6px;
  font-family: var(--editor-font-family, ui-monospace, monospace);
  font-size: 0.875rem;
  max-height: 400px;
  overflow: auto;
}

.puml-error-code-view--dark {
  background: #1e1e1e;
  color: #e5e5e5;
}

.puml-error-code-view__lang {
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  color: #6b7280;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.puml-error-code-view__line {
  display: flex;
  min-height: var(--puml-line-height, 1.5rem);
  line-height: var(--puml-line-height, 1.5rem);
}

.puml-error-code-view__line--err {
  background: rgba(239, 68, 68, 0.12);
  border-left: 3px solid #ef4444;
}

.puml-error-code-view--dark .puml-error-code-view__line--err {
  background: rgba(239, 68, 68, 0.15);
}

.puml-error-code-view__line-no {
  flex: 0 0 3rem;
  text-align: right;
  padding-right: 0.75rem;
  color: #9ca3af;
  user-select: none;
}

.puml-error-code-view__line--err .puml-error-code-view__line-no {
  color: #ef4444;
  font-weight: 600;
}

.puml-error-code-view__line-text {
  flex: 1;
  padding-right: 0.75rem;
  white-space: pre;
  overflow-x: auto;
}

.puml-error-code-view__bubble {
  position: absolute;
  left: 3rem;
  right: 0.75rem;
  z-index: 1;
  background: #ffffff;
  border-left: 3px solid #ef4444;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.puml-error-code-view--dark .puml-error-code-view__bubble {
  background: #2d2d2d;
}

.puml-error-code-view__bubble--bottom {
  position: static;
  margin: 0.75rem;
}

.puml-error-code-view__bubble-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}

.puml-error-code-view__line-badge {
  display: inline-block;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
}

.puml-error-code-view__fix-btn {
  align-self: flex-end;
}

/* 错误代码视图不需要 diagram zoom 工具栏 */
.diagram-block:has(.puml-error-code-view) .diagram-tools,
.diagram-preview:has(.puml-error-code-view) .diagram-zoom-viewport {
  display: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.css
git commit -m "style(plantuml): add inline error code view styles"
```

---

### Task 4: 分屏模式 `PlantUMLRenderer` Portal 集成

**Files:**
- Modify: `src/components/PlantUMLRenderer.tsx`
- Modify: `src/components/__tests__/PlantUMLRenderer.test.tsx`

- [ ] **Step 1: 更新 mock 返回 RenderResult**

```typescript
vi.mock('../plantuml-offline/PlantUMLOfflineRenderer', () => ({
  renderPlantUMLOffline: vi.fn().mockResolvedValue({
    ok: true,
    html: '<svg>mocked plantuml</svg>',
  }),
}));
```

- [ ] **Step 2: 写 portal 失败渲染测试**

在 `PlantUMLRenderer.test.tsx` 新增：

```typescript
import { PlantUMLErrorCodeView } from '../plantuml-offline/PlantUMLErrorCodeView';

it('渲染失败时通过 Portal 展示 PlantUMLErrorCodeView', async () => {
  vi.mocked(renderPlantUMLOffline).mockResolvedValueOnce({
    ok: false,
    source: '@startuml\nbad\n@enduml',
    error: 'Syntax Error?',
    line: 2,
  });

  const md = '```plantuml\nbad line\n@enduml\n```';
  const { container } = render(<PlantUMLRenderer content={md} previewDocumentId="t1" />);

  await waitFor(() => {
    expect(container.querySelector('.puml-error-code-view')).toBeTruthy();
  });
  expect(container.querySelector('.puml-error-code-view__line--err')).toBeTruthy();
  expect(container.textContent).toContain('AI 修复');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/components/__tests__/PlantUMLRenderer.test.tsx -t "Portal" -v`

Expected: FAIL

- [ ] **Step 4: 改造 PlantUMLRenderer.tsx**

关键改动：

```typescript
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlantUMLErrorCodeView } from './plantuml-offline/PlantUMLErrorCodeView';

type ErrorPortalEntry = {
  node: HTMLElement;
  source: string;
  error: string;
  line?: number;
};

// 在组件内：
const [errorPortals, setErrorPortals] = useState<ErrorPortalEntry[]>([]);

// useLayoutEffect 内，innerHTML 之后：
setErrorPortals([]);

// 异步循环内替换：
const result = await renderPlantUMLOffline(decoded, themeForThisPass);
if (result.ok) {
  block.innerHTML = scopeSvgIdsForHtmlDocument(result.html);
} else {
  block.innerHTML = '';
  errors.push({
    node: block,
    source: result.source,
    error: result.error,
    line: result.line,
  });
}
// 循环结束后：
if (!cancelled && errors.length > 0) {
  setErrorPortals(errors);
}

// return JSX：
return (
  <>
    <div ref={containerRef} className="diagram-color-fix prose prose-slate max-w-none p-4" />
    {errorPortals.map(({ node, source, error, line }, i) =>
      createPortal(
        <PlantUMLErrorCodeView
          key={`${previewDocumentId}-${i}-${source.slice(0, 32)}`}
          source={source}
          errorMessage={error}
          errorLine={line}
        />,
        node
      )
    )}
  </>
);
```

- [ ] **Step 5: 运行 PlantUMLRenderer 测试**

Run: `npx vitest run src/components/__tests__/PlantUMLRenderer.test.tsx -v`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/PlantUMLRenderer.tsx src/components/__tests__/PlantUMLRenderer.test.tsx
git commit -m "feat(plantuml): render error code view via portal in split preview"
```

---

### Task 5: WYSIWYG `diagramRenderers` 集成

**Files:**
- Create: `src/components/plantuml-offline/renderPlantUmlErrorToElement.tsx`
- Modify: `src/components/diagramRenderers.ts`
- Create: `src/components/__tests__/diagramRenderers.plantuml.test.ts`

- [ ] **Step 1: 写 WYSIWYG renderer 测试**

创建 `src/components/__tests__/diagramRenderers.plantuml.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDiagramRenderer } from '../diagramRenderers';

vi.mock('../plantuml-offline/PlantUMLOfflineRenderer', () => ({
  renderPlantUMLOffline: vi.fn(),
}));

import { renderPlantUMLOffline } from '../plantuml-offline/PlantUMLOfflineRenderer';

describe('diagramRenderers plantuml', () => {
  beforeEach(() => {
    vi.mocked(renderPlantUMLOffline).mockReset();
  });

  it('success returns scoped SVG string', async () => {
    vi.mocked(renderPlantUMLOffline).mockResolvedValue({
      ok: true,
      html: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    });
    const renderer = getDiagramRenderer('plantuml')!;
    const result = await renderer('@startuml\na->b\n@enduml');
    expect(typeof result).toBe('string');
    expect(String(result)).toContain('<svg');
  });

  it('failure returns HTMLElement with error code view', async () => {
    vi.mocked(renderPlantUMLOffline).mockResolvedValue({
      ok: false,
      source: '@startuml\nbad\n@enduml',
      error: 'Syntax Error?',
      line: 2,
    });
    const renderer = getDiagramRenderer('plantuml')!;
    const result = await renderer('@startuml\nbad\n@enduml');
    expect(result).toBeInstanceOf(HTMLElement);
    expect((result as HTMLElement).querySelector('.puml-error-code-view')).toBeTruthy();
  });
});
```

注意：需在测试中 `import '../diagramRenderers'` 触发 register（文件 side-effect）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/__tests__/diagramRenderers.plantuml.test.ts -v`

Expected: FAIL

- [ ] **Step 3: 实现 renderPlantUmlErrorToElement**

创建 `src/components/plantuml-offline/renderPlantUmlErrorToElement.tsx`：

```tsx
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PlantUMLErrorCodeView } from './PlantUMLErrorCodeView';

export function renderPlantUmlErrorToElement(result: {
  source: string;
  error: string;
  line?: number;
}): HTMLElement {
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
```

- [ ] **Step 4: 更新 diagramRenderers.ts**

```typescript
import { renderPlantUmlErrorToElement } from './plantuml-offline/renderPlantUmlErrorToElement';

registerDiagramRenderer('plantuml', async (code) => {
  const result = await renderPlantUMLOffline(code);
  if (result.ok) return scopeSvgIdsForHtmlDocument(result.html);
  return renderPlantUmlErrorToElement(result);
});
```

在 `renderDiagramPreview` 的 try 块内，result 处理前增加：

```typescript
if (typeof result !== 'string' && result.querySelector?.('.puml-error-code-view')) {
  applyPreview(result);
  return true;
}
```

（放在 `wrapper` 创建之前，直接 `applyPreview(result)` 并 return）

- [ ] **Step 5: 运行测试**

Run: `npx vitest run src/components/__tests__/diagramRenderers.plantuml.test.ts -v`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/plantuml-offline/renderPlantUmlErrorToElement.tsx src/components/diagramRenderers.ts src/components/__tests__/diagramRenderers.plantuml.test.ts
git commit -m "feat(plantuml): WYSIWYG error view via createRoot and skip zoom wrapper"
```

---

### Task 6: 更新 E2E mock 与全量测试

**Files:**
- Modify: `src/components/__tests__/PlantUMLE2E.test.ts`

- [ ] **Step 1: 更新 E2E mock**

```typescript
renderPlantUMLOffline: vi.fn().mockResolvedValue({
  ok: true,
  html: '<svg data-testid="rendered">mocked</svg>',
}),
```

错误用例：

```typescript
(renderPlantUMLOffline as ReturnType<typeof vi.fn>).mockResolvedValue({
  ok: false,
  source: '',
  error: '渲染失败',
});
const result = await renderPlantUMLOffline('');
expect(result.ok).toBe(false);
```

- [ ] **Step 2: 运行全量前端测试**

Run: `npx vitest run -v`

Expected: PASS（`formatPlantUmlErrorHtml` 旧测试仍 PASS，deprecated 函数保留）

- [ ] **Step 3: Commit**

```bash
git add src/components/__tests__/PlantUMLE2E.test.ts
git commit -m "test(plantuml): update E2E mocks for RenderResult"
```

---

### Task 7: 手动验证清单

- [ ] **Step 1: 启动应用**

Run: `npm run tauri dev`

- [ ] **Step 2: 分屏模式**

1. 打开含 PlantUML 的文档，切换到分屏
2. 输入语法错误（如 `Alice ->> Bob 缺少冒号`）
3. 确认：预览区显示完整源码、第 4 行标红、气泡含「第 N 行」与「AI 修复」
4. 点击 AI 修复 → AI 面板打开并发送修复请求
5. 修正语法 → 预览恢复 SVG

- [ ] **Step 3: WYSIWYG 模式**

1. 切换到 WYSIWYG，插入 plantuml 代码块
2. 输入错误语法，确认 PREVIEW 区为内联代码视图（非旧错误卡片）
3. 确认无 zoom 控件包裹错误视图

- [ ] **Step 4: 行号未知**

1. 触发无法解析行号的错误（若可 mock）
2. 确认无行标红、气泡在底部、无行号徽章

---

## Spec 覆盖自检

| Spec 章节 | 对应 Task |
|-----------|-----------|
| 2.1 PlantUMLErrorCodeView | Task 2 |
| 2.3 暗色主题 | Task 2 (`useEffectiveEditorColorMode`) |
| 2.4 可访问性 | Task 2 |
| 3 RenderResult | Task 1 |
| 4 视觉样式 | Task 3 |
| 5.1 分屏 createPortal | Task 4 |
| 5.2 WYSIWYG createRoot+flushSync | Task 5 |
| 5.4 AI 修复 | Task 2 |
| 6 边界情况 | Task 2 + Task 7 |
| 7 向后兼容 deprecated HTML | Task 1（保留 formatPlantUmlErrorHtml） |

## 不在范围内（确认未实现）

- edit 模式错误提示
- PlantUML 语法高亮
- 自动修复（仅 AI 入口）
