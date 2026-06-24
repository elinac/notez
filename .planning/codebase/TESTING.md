---
last_mapped_commit: ffbef8cf2cbc9018fd95ada62430d2e2eb17ab05
---

# Testing Patterns

**Analysis Date:** 2026-06-24

## Test Framework

**Runner:**
- 前端：**Vitest** ^4.1.2
- 配置：`vitest.config.ts`（`environment: 'jsdom'`、`globals: true`）
- Rust：**cargo test**（内置 `#[test]`，`edition = "2021"` in `src-tauri/Cargo.toml`）

**Assertion Library:**
- 前端：Vitest 内置 `expect`（`toBe`、`toEqual`、`toContain`、`toThrow`、`toHaveBeenCalledTimes` 等）
- React 组件：`@testing-library/react` 的 `render`、`waitFor`（`src/components/__tests__/PlantUMLRenderer.test.tsx`）
- Rust：`assert!`、`assert_eq!`、`panic!` 于 match 分支

**Run Commands:**
```bash
npm test                              # Vitest（package.json scripts.test）
npx vitest run                        # 单次跑完全部前端测试
npx vitest run src/utils/__tests__/editorThemeRuntime.test.ts   # 单文件
cd src-tauri && cargo test            # 全部 Rust 测试
cd src-tauri && cargo test test_name  # 单个 Rust 测试
cd src-tauri && cargo test -- --nocapture   # 带 stdout（调试 println!）
```

## Test File Organization

**Location:**
- 前端：源码旁的 `__tests__/` 目录（**非** 与源文件同名的 `.test.ts` 并列）
- 示例布局：
```
src/
  utils/
    editorThemeRuntime.ts
    __tests__/editorThemeRuntime.test.ts
  constants/
    codeBlockThemes.ts
    __tests__/codeBlockThemes.test.ts
  components/
    plantuml-offline/
      PlantUMLParser.ts
      __tests__/scopeSvgIdsForDocument.test.ts
    __tests__/PlantUMLParser.test.ts
  store/
    useSettingsStore.ts
    __tests__/editorThemeSettings.test.ts
```

**Naming:**
- 单元/集成：`{module}.test.ts` 或 `{module}.test.tsx`
- 管线级：`PlantUMLE2E.test.ts`（E2E 命名但仍在 Vitest 内，mock 外部依赖）
- Rust fixture 契约：`src-tauri/src/plantuml_native/plan_fixture_tests.rs`
- Rust 模块内联：`mod tests { #[test] fn ... }` 位于各 `parse/`、`layout/`、`svg/` 文件末尾

**Structure:**
- 前端约 19 个测试文件，集中在 PlantUML/Mermaid 解析渲染、编辑器主题、store 持久化、任务板逻辑
- Rust fixture 数据：`src-tauri/tests/fixtures/plantuml_sequence/*.puml`、`plantuml_component/*.puml`

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveEditorColorMode } from '../editorThemeRuntime';

describe('editorThemeRuntime', () => {
  it('resolveEditorColorMode', () => {
    expect(resolveEditorColorMode('light', true)).toBe('light');
    expect(resolveEditorColorMode('system', false)).toBe('light');
  });
});
```

**Patterns:**
- 顶层 `describe` 以模块名或功能域命名；嵌套 `describe` 按函数或场景分组（见 `src/components/__tests__/PlantUMLParser.test.ts`）
- 用例 ID 前缀便于追溯：`TP1`（类型探测）、`TC1`（转换）、`E2E-1`（管线）、`REAL-1`（mock invoke 集成）
- 测试描述常用中文说明行为（与产品/UI 语言一致）
- `beforeEach` 重置 `localStorage`、Zustand state、mock（`src/store/__tests__/editorThemeSettings.test.ts`）
- 大文件用 `// ── section ──` 注释分隔（`PlantUMLParser.test.ts`、`PlantUMLE2E.test.ts`）
- 复杂用例可内联 arrange 数据（PlantUML 多行字符串模板）

**Rust inline tests:**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrow_color_red() {
        let ir = parse_ok("@startuml\nA -> B #red : message\n@enduml");
        match &ir.body[0] {
            SequenceBodyItem::Message(m) => assert_eq!(m.color.as_deref(), Some("red")),
            _ => panic!("expected message"),
        }
    }
}
```

## Mocking

**Framework:**
- Vitest `vi`（`vi.mock`、`vi.fn`、`vi.mocked`、`vi.clearAllMocks`）
- 模块 mock 必须在 import 被测模块**之前**声明（见 `src/components/__tests__/MermaidRenderer.test.tsx`）

**Patterns:**
```typescript
// 外部库
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>...</svg>' }),
  },
}));

// 内部渲染器
vi.mock('../plantuml-offline/PlantUMLOfflineRenderer', () => ({
  renderPlantUMLOffline: vi.fn().mockResolvedValue('<svg>mocked</svg>'),
}));

// Tauri IPC
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue({ svgBytes: [...], warnings: [] });
});
```

**What to Mock:**
- `@tauri-apps/api/core` 的 `invoke`（`src/components/__tests__/PlantUMLRealRender.test.ts`）
- `mermaid` 默认导出（避免真实 SVG 渲染）
- `PlantUMLOfflineRenderer`（避免 JVM/WASM/网络）
- `localStorage`（`src/components/__tests__/FileOperations.test.tsx` 使用 `vi.fn()` 对象）
- DOM API：`scrollIntoView` 等（`src/components/__tests__/outlineNavigation.test.ts`）
- 回调 stub：`vi.fn()` 作为 `applyPreview`（`diagramRenderers.test.ts`）

**What NOT to Mock:**
- 纯函数解析/转换：`detectDiagramType`、`plantUMLToDot`、`encodePlantUML`、`parseBlocks`
- 常量与归一化：`normalizeEditorThemeId`、`normalizeCodeBlockThemeId`
- Rust 解析/布局/SVG 管线内部逻辑（直接测 `parse_ok` / `try_render_rust`）

## Fixtures and Factories

**Test Data:**
```typescript
// 内联 PlantUML/Markdown 字符串（最常见）
const md = '```plantuml\n@startuml\nBob -> Alice : hello\n@enduml\n```';

// Zustand 初始 state 重置
useSettingsStore.setState({
  plantUmlTheme: DEFAULT_PLANTUML_THEME,
  plantUmlBackend: 'jar',
});
```

**Rust fixtures:**
```rust
// plan_fixture_tests.rs — include_str! 嵌入 .puml
fn fixture(name: &str) -> &'static str {
    match name {
        "v0_messages_ok.puml" => include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/plantuml_sequence/v0_messages_ok.puml"
        )),
        // ...
        _ => panic!("unknown fixture {name}"),
    }
}
```

**Location:**
- 共享 PlantUML 样例：`src-tauri/tests/fixtures/plantuml_sequence/`、`plantuml_component/`
- 前端：无独立 `tests/fixtures/`；复杂 Markdown/PlantUML 写在测试文件内
- Mock 返回值 helper：测试文件内局部函数（如 `mockInvokeOk` in `PlantUMLRealRender.test.ts`）

## Coverage

**Requirements:**
- 无 enforced coverage 目标
- `package.json` 无 `test:coverage` 脚本
- `vitest.config.ts` 未配置 `coverage` 块

**Configuration:**
- 未集成 c8/istanbul 报告
- CI 配置文件未检测到（无 `.github/workflows`）

**View Coverage:**
- 当前无标准命令；若需本地 coverage，需自行在 `vitest.config.ts` 增加 `coverage` 配置后运行 `vitest run --coverage`

## Test Types

**Unit Tests:**
- 范围：单函数/纯逻辑（`splitPaneRatio`、`editorThemeRuntime`、TaskBoard CRUD）
- 特点：无 mock 或仅 mock 浏览器 API
- 示例：`src/utils/__tests__/splitPaneRatio.test.ts`、`src/constants/__tests__/codeBlockThemes.test.ts`

**Integration Tests（Vitest 层）:**
- 范围：多模块协作，仍 mock 外部边界
- 示例：
  - `src/components/__tests__/PlantUMLE2E.test.ts` — markdown 提取 + DOT 生成
  - `src/components/__tests__/PlantUMLRealRender.test.ts` — `renderPlantUMLOffline` + mock `invoke`
  - `src/store/__tests__/editorThemeSettings.test.ts` — store + localStorage

**Component Tests:**
- 范围：React 组件行为（少量）
- 工具：`render` + `waitFor` + mock 子系统
- 示例：`src/components/__tests__/PlantUMLRenderer.test.tsx`（验证 `previewDocumentId` 变化触发重渲染）

**Rust Contract / Fixture Tests:**
- `plan_fixture_tests.rs`：与 `docs/plans/` 附录 C 对齐的 `.puml` 契约
- 成功 fixture 断言 SVG 非空；失败 fixture 断言 `NativeError` variant
- 模块内 `#[test]`：解析 IR 结构、布局细节（`src-tauri/src/plantuml_native/parse/sequence.rs` 末尾）

**E2E Tests:**
- 无 Playwright/Cypress
- `PlantUMLE2E.test.ts` 为 Vitest 内的管线测试，非浏览器 E2E

## Common Patterns

**Async Testing:**
```typescript
it('initSettings 缺省字段使用默认值', async () => {
  localStorage.setItem(LS_KEY, JSON.stringify({ aiConfigs: [], activeAiConfigId: null }));
  await useSettingsStore.getState().initSettings();
  expect(useSettingsStore.getState().editorThemeId).toBe(DEFAULT_EDITOR_THEME_ID);
});

it('相同 content 但 previewDocumentId 变化时仍再次调用离线渲染', async () => {
  const { rerender } = render(<PlantUMLRenderer content={md} previewDocumentId="tab-a" />);
  await waitFor(() => expect(vi.mocked(renderPlantUMLOffline)).toHaveBeenCalledTimes(1));
  rerender(<PlantUMLRenderer content={md} previewDocumentId="tab-b" />);
  await waitFor(() => expect(vi.mocked(renderPlantUMLOffline)).toHaveBeenCalledTimes(2));
});
```

**Error Testing:**
```typescript
// 同步
expect(normalizeCodeBlockThemeId('nope')).toBe(DEFAULT_CODE_BLOCK_THEME_ID);

// Rust fixture 失败路径
let err = try_render_rust(fixture("v0_fail_include.puml")).unwrap_err();
assert!(matches!(err, NativeError::ForbiddenDirective { .. }));
```

**Store / localStorage Setup:**
```typescript
beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ loaded: false, editorThemeId: DEFAULT_EDITOR_THEME_ID });
});
```

**Snapshot Testing:**
- 未使用 `toMatchSnapshot`
- 断言显式字符串片段（`toContain('digraph')`、`toMatch(/^<svg/)`）

**Adding New Tests — Guidance:**
- 新 `src/utils/` 或 `src/constants/` 功能：在同级 `__tests__/{name}.test.ts` 添加 Vitest 文件
- 新 PlantUML Rust 语法：在 `parse/<kind>/` 模块末尾加 `#[test]`，必要时在 `tests/fixtures/` 增加 `.puml` 并在 `plan_fixture_tests.rs` 注册
- 新 Tauri 命令：Rust 侧 `#[test]` + 前端 mock `invoke` 的集成测试（参考 `PlantUMLRealRender.test.ts`）
- 新 React 组件：优先测提取出的纯函数；必须测组件时用 `@testing-library/react` 并 mock 重组件依赖

---

*Testing analysis: 2026-06-24*
*Update when test patterns change*
