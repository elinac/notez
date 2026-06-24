---
last_mapped_commit: ffbef8cf2cbc9018fd95ada62430d2e2eb17ab05
---

# Coding Conventions

**Analysis Date:** 2026-06-24

## Naming Patterns

**Files:**
- React 组件：`PascalCase.tsx`（如 `src/components/MarkdownEditor.tsx`、`src/components/SettingsPanel.tsx`）
- 业务/工具模块：`camelCase.ts`（如 `src/utils/editorThemeRuntime.ts`、`src/components/outlineNavigation.ts`）
- Zustand store：`use{Name}Store.ts`（如 `src/store/useAppStore.ts`、`src/store/useSettingsStore.ts`）
- React hooks：`use*.ts`（如 `src/hooks/useEffectiveEditorColorMode.ts`）
- 常量注册表：`src/constants/{domain}.ts`（如 `editorThemes.ts`、`codeBlockThemes.ts`）
- 测试：与源码同目录下的 `__tests__/*.{test,spec}.ts(x)`（如 `src/utils/__tests__/editorThemeRuntime.test.ts`）
- Rust 模块：`snake_case` 文件名与目录（如 `src-tauri/src/plantuml_native/parse/sequence.rs`）

**Functions:**
- TypeScript：所有导出函数使用 `camelCase`（如 `resolveEditorColorMode`、`normalizeEditorThemeId`）
- React 事件/状态 setter：组件内 `set*`、`handle*`（如 `setEditorMode`、`handleClick`）
- Rust：函数与模块 `snake_case`（如 `try_render_rust`、`enforce_input_limits`）
- 归一化函数：对 settings 枚举统一命名为 `normalize{Thing}Id` 或 `normalize{Thing}`（如 `normalizeCodeBlockThemeId`）

**Variables:**
- TypeScript：`camelCase`（如 `effectiveColorMode`、`splitRatio`）
- 常量：`UPPER_SNAKE_CASE`（如 `DEFAULT_EDITOR_THEME_ID`、`LS_KEY`、`MAX_SOURCE_BYTES`）
- Rust 常量：`UPPER_SNAKE_CASE` pub const（见 `src-tauri/src/plantuml_native/limits.rs`）
- 私有 Rust 模块级变量：`snake_case`；全局锁如 `PICO_WEB` 使用 `Mutex`

**Types:**
- TypeScript 接口/类型别名：`PascalCase`，无 `I` 前缀（如 `EditorThemeId`、`PersistedSettings`、`AiProviderConfig`）
- React 组件 props：`{Component}Props`（如 `MarkdownEditorProps`）
- Rust 枚举/结构体：`PascalCase`（如 `NativeError`、`PlantumlLocalRenderResult`）
- 字符串联合类型优先于 enum（前端 settings 与主题 ID）

## Code Style

**Formatting:**
- 无 Prettier、ESLint、Biome 或 `.editorconfig` 配置文件
- TypeScript 编译器约束见 `tsconfig.json`：`strict: true`、`noUnusedLocals`、`noUnusedParameters`
- 缩进：2 空格（`src/` 与 `src-tauri/` 均一致）
- 分号：TypeScript 中普遍使用
- 引号：`src/App.tsx`、`src/main.tsx` 使用双引号；多数其他 TS 文件使用单引号——新代码跟随所在目录邻近文件的引号风格
- Rust：标准 `rustfmt` 风格（无项目级 `rustfmt.toml`）

**Linting:**
- 前端：仅 TypeScript 编译器检查（`npm run build` 含 `tsc`）
- Rust：无项目 `clippy.toml`；依赖 `cargo build` / `cargo test` 编译期检查
- 无 `npm run lint` 脚本

## Import Organization

**Order:**
1. 外部包（`react`、`zustand`、`@codemirror/*`、`@tauri-apps/*`）
2. 内部绝对路径（无 `@/` 别名，一律相对路径）
3. 类型专用导入：`import type { ... }` 单独一行或与值导入分离
4. CSS / 资源 URL：`import frameLight from '...?url'`（见 `src/constants/editorThemes.ts`）

**Grouping:**
- 大文件用分隔注释划分区块：`// ── View types ──`（见 `src/store/useAppStore.ts`）
- store 文件顶部保留模块级 JSDoc 说明持久化策略

**Path Aliases:**
- 未配置 `@/` 或路径映射；从 `src/` 根使用相对路径（如 `../constants/editorThemes`）

## Error Handling

**Patterns:**
- **前端边界**：`try/catch` 捕获 I/O 与 JSON 解析，失败时 `return null` 或 `console.error`，不向上抛未处理异常（见 `src/store/useSettingsStore.ts` 的 `loadSettings` / `saveSettings`）
- **Rust 引擎内部**：自定义 `NativeError` 枚举 + `Display` + `std::error::Error`（`src-tauri/src/plantuml_native/mod.rs`）；解析/布局/限流分 variant（`Parse`、`Layout`、`ForbiddenDirective` 等）
- **Tauri 命令边界**：`Result<T, String>` 与前端 `invoke` 对齐（`src-tauri/src/plantuml_runtime.rs` 的 `render_plantuml_local`）
- **设置归一化**：持久化读取后对未知枚举值回落默认值，不抛错（`normalizeOptionId` in `src/utils/normalizeOptionId.ts`）

**Error Types:**
- 用户输入非法：Rust 返回 `NativeError::Parse { line, detail }`（1-based 行号）
- 安全策略拒绝：`NativeError::ForbiddenDirective`（如 `!include`）
- 预期失败（文件不存在）：前端 `catch { return null }`，UI 层决定是否提示

**Async:**
- 前端 `async/await` + `try/catch`；Tauri API 动态 `import()` 以支持浏览器回退（`isTauri()` 分支）
- Rust 异步：Tauri 命令为 sync handler；PlantUML JAR 路径用线程 + HTTP 同步等待

## Logging

**Framework:**
- 前端：`console.error` / `console.warn`（无统一 logger 库）
- Rust 运行时：`notez-plantuml.log` 文件日志（`src-tauri/src/plantuml_runtime.rs`）；警告可用 `eprintln!`（`src-tauri/src/plantuml_native/mod.rs`）

**Patterns:**
- 持久化失败：`console.error('Failed to save settings:', err)`（`src/store/useSettingsStore.ts`）
- 文件操作失败：`console.error('Failed to open file:', error)`（`src/components/FileToolbar.tsx`）
- PlantUML 渲染：`console.warn('[PlantUML]', w)` 与 `console.error('[PlantUML] offline render error:', ...)`（`src/components/plantuml-offline/PlantUMLOfflineRenderer.ts`）
- 在工具函数中避免 log；在 I/O 边界与 Tauri invoke 回调处 log

## Comments

**When to Comment:**
- 模块顶部说明职责与持久化/平台差异（`src/store/useSettingsStore.ts`、`src/store/useAppStore.ts`）
- 非显而易见的业务规则（PlantUML 后端切换、Windows 路径前缀）
- 大文件内用 `// ── Section ──` 分隔，而非逐行解释
- 中英文混用：用户可见字符串与部分模块 doc 为中文；Rust 公共 API 文档多为中文

**JSDoc/TSDoc:**
- Store、复杂模块使用块注释说明用途
- 简单工具函数可用单行 `/** ... */`（如 `src/utils/normalizeOptionId.ts`）
- 公共导出函数不强制完整 `@param`/`@returns`；类型签名自解释时省略

**TODO Comments:**
- `src/` 中当前无 `TODO`/`FIXME` 标记；新增时使用 `// TODO: 描述` 并尽量关联 issue

## Function Design

**Size:**
- 复杂 UI 组件可达 200+ 行（`src/components/MarkdownEditor.tsx`）；新逻辑优先提取到 `src/utils/` 或独立 `.ts` 模块
- Rust 解析器单文件较大（`sequence.rs`）；新语法按现有 `parse_*` / `#[test]` 模式增量添加

**Parameters:**
- React 组件：props 对象 + 解构（`{ content, onChange }`）
- 选项归一化：`(raw: unknown, validIds, fallback)` 三元组（`normalizeOptionId`）
- Rust：输入 `&str`，输出 `Result<_, NativeError>` 或 `Result<_, String>` 视边界而定

**Return Values:**
- 前端 guard：`if (!editorRef.current) return;` 在 effect 中常见
- 枚举归一化：始终返回合法成员，不返回 `undefined`
- Rust：`?` 传播；Tauri 层 `.map_err(|e| e.to_string())`

## Module Design

**Exports:**
- React 组件：**命名导出** `export function ComponentName`（主流模式）
- 例外：`export default` 仅用于 `src/App.tsx` 入口与 `src/components/mermaidSingleton.ts`
- Store：`export const useXStore = create(...)` + 相关 type/constant 同文件导出
- 常量模块：导出 `DEFAULT_*`、`OPTIONS` 数组、`normalize*` 函数（`src/constants/editorThemes.ts`）

**Barrel Files:**
- 无统一 `index.ts` barrel；直接从具体文件 import
- 避免循环依赖：store 引用 `components/FileOperations`，组件引用 store——保持单向或提取共享类型到 `constants/` / `utils/`

**Platform Abstraction:**
- 使用 `isTauri()` 分支（`src/components/FileOperations.ts`、`src/store/useSettingsStore.ts`）区分桌面与浏览器
- Tauri plugin 使用动态 import，避免浏览器 bundle 硬依赖

**Rust Module Layout:**
- `src-tauri/src/lib.rs`：Tauri 入口、插件注册、`invoke_handler`
- `plantuml_runtime.rs`：JAR/PicoWeb 路径
- `plantuml_native/`：`parse/` → `layout/` → `svg/` 管线 + `plan_fixture_tests.rs`

---

*Convention analysis: 2026-06-24*
*Update when patterns change*
