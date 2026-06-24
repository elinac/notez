---
last_mapped_commit: ffbef8cf2cbc9018fd95ada62430d2e2eb17ab05
---

# Codebase Concerns

**Analysis Date:** 2026-06-24

## Tech Debt

**PlantUML 序列图解析巨型状态机：**
- Issue: `parse_sequence_diagram` 单函数约 1335 行，内含 `while` + `match ParseState` + fragment 栈；`InTitle`/`InHeader`/`InFooter`/`InLegend` 处理结构高度重复。
- Files: `src-tauri/src/plantuml_native/parse/sequence.rs`（3991 行，含 ~1290 行内联测试）
- Impact: 任何语法扩展或 bug 修复成本高；review 困难；合并冲突频繁。
- Fix approach: 按 `ParseState` 拆分子模块（lexer、fragment、box、note）；提取 table-driven handler；内联测试迁移至 `src-tauri/tests/` 或 `parse/sequence/` 子目录。

**前端循环依赖（constants ↔ store）：**
- Issue: `src/constants/buildFlags.ts` 从 `useSettingsStore` 导入 `PlantUmlBackend` 类型与 `DEFAULT_PLANTUML_BACKEND`；`useSettingsStore` 又导入 `effectivePlantUmlBackend`，形成 ESM 循环。
- Files: `src/constants/buildFlags.ts`, `src/store/useSettingsStore.ts`
- Impact: 打包/树摇行为不可预测；类型与默认值无法独立复用；阻碍 constants 层纯化。
- Fix approach: 提取 `src/types/plantumlBackend.ts` 或 `src/constants/plantumlDefaults.ts`，两端均依赖共享模块。

**Store 反向依赖 Components：**
- Issue: 全局 store 从 UI 包导入领域类型与工厂函数；utils 层亦反向依赖 components。
- Files: `src/store/useAppStore.ts`（import `NoteFile`、`createNewFile` from `FileOperations`；import `Task` from `TaskBoard`）；`src/utils/nativeDialog.ts`（import `isTauri` from `FileOperations`）
- Impact: 分层边界模糊；无法独立测试 store；components 变更易引发 store 级联破坏。
- Fix approach: 创建 `src/types/` + `src/services/fileOps.ts`，store 与 components 均向下依赖。

**镜像状态（tabs + currentFile/content 双写）：**
- Issue: `useAppStore` 在 `tabs`/`activeTabId` 之外维护 `currentFile`/`content` 扁平字段，每次 tab 切换需 `syncActive()` 同步。
- Files: `src/store/useAppStore.ts`（`syncActive` 函数及多处调用）
- Impact: 状态不一致风险；宽订阅导致无关字段变更触发重渲染。
- Fix approach: 去掉 mirror 字段，改用 derived selector（`selectActiveTab(state)`）；配合 `useShallow` 细粒度订阅。

**预览 Markdown 双份实现：**
- Issue: `renderBasicMarkdown` 在 `PlantUMLRenderer` 与 `MermaidRenderer` 各有一份；PlantUML 版含 GFM 表格与更宽负向前瞻，Mermaid 版为简化链式 replace。
- Files: `src/components/PlantUMLRenderer.tsx:89–142`, `src/components/MermaidRenderer.tsx:147–163`
- Impact: 预览语义已分叉；修 bug 需改两处；测试覆盖不一致。
- Fix approach: 提取 `src/utils/markdownPreview.ts` 统一实现；`MermaidRenderer` 若仅测试使用应标注或移除。

**Parse 层 duplicated helpers：**
- Issue: `parse_err`、`logical_line`、`eq_startuml`/`eq_enduml` 在 sequence/component 各自复制；`sequence.rs` 仍有独立颜色逻辑未完全复用 `color.rs`。
- Files: `src-tauri/src/plantuml_native/parse/sequence.rs`, `src-tauri/src/plantuml_native/parse/component.rs`, `src-tauri/src/plantuml_native/parse/color.rs`
- Impact: 行为漂移；重复 bug 修复。
- Fix approach: 提取 `src-tauri/src/plantuml_native/parse/common.rs`；颜色逻辑统一到 `color.rs`。

**plantuml_runtime 单体 + 全局状态：**
- Issue: 778 行文件将 HTTP、deflate 编码、PicoWeb 进程、pipe 回退、后端路由揉为一体；`PICO_WEB` 与 `LOG_LOCK` 为全局 `Mutex`。
- Files: `src-tauri/src/plantuml_runtime.rs:169–172, 405–428, 539, 637–688`
- Impact: 难以 mock/单测；全局锁串行化并发渲染；JVM 生命周期与 Tauri 强耦合。
- Fix approach: 拆分为 `encoding`、`http`、`picoweb`、`pipe` 子模块；PicoWeb 改为 `AppHandle` 管理的 service struct 或 trait 注入。

**死代码与未接入模块：**
- Issue: `FileToolbar.tsx`（227 行）无 import 引用；`diagnostics.rs` 为 stub；`MermaidRenderer` 仅被测试引用，生产预览走 `PlantUMLRenderer`。
- Files: `src/components/FileToolbar.tsx`, `src-tauri/src/plantuml_native/diagnostics.rs`, `src/components/MermaidRenderer.tsx`, `src/components/__tests__/MermaidRenderer.test.tsx`
- Impact: 认知负担；误导维护者；CI 仍编译 dead_code 模块。
- Fix approach: 删除或接入；合并 preview 管线；`diagnostics.rs` 落地或移除。

**Tauri 模板残留：**
- Issue: `greet` 命令仍在 invoke handler 中注册，无业务用途。
- Files: `src-tauri/src/lib.rs:8–11, 68`
- Impact: 暴露无用 IPC 面；增加攻击面（虽低）。
- Fix approach: 移除 `greet` 命令及 handler 注册。

**Milkdown 依赖 patch 维护：**
- Issue: `@milkdown/crepe` 与 `@milkdown/components` 通过 `patch-package` 打补丁；`postinstall` 必须执行。
- Files: `patches/@milkdown+crepe+7.19.2.patch`, `patches/@milkdown+components+7.19.2.patch`, `package.json`（`postinstall: patch-package`）
- Impact: 跳过 postinstall 导致 WYSIWYG 编辑器异常；升级 Milkdown 需手动重打补丁。
- Fix approach: 文档化 patch 原因；升级前在 `AGENTS.md` 流程中强制 postinstall；长期 upstream 修复或 fork。

**diagram kind 探测双端重复：**
- Issue: 前后端各自实现 PlantUML 图类型启发式探测，注释承认「对齐」但无共享契约 CI。
- Files: `src/components/plantuml-offline/PlantUMLParser.ts`, `src-tauri/src/plantuml_native/mod.rs:97–120`
- Impact: 前后端判定漂移；用户看到与渲染结果不一致的提示。
- Fix approach: 共享 fixture CI；或前端仅做 UI 提示、Rust 后端为权威。

**generateId / isTauri 多处重复：**
- Issue: `generateId()` 在 FileOperations、FileExplorer、TaskBoard、SettingsPanel、AiPanel 五处重复；`isTauri()` 在 FileOperations、useSettingsStore、nativeDialog（间接）重复。
- Files: `src/components/FileOperations.ts`, `src/components/FileExplorer.tsx`, `src/components/SettingsPanel.tsx`, `src/components/AiPanel.tsx`, `src/store/useSettingsStore.ts:63–65`, `src/utils/nativeDialog.ts`
- Impact: 行为不一致风险（如 ID 格式变更需改五处）。
- Fix approach: 提取 `src/utils/id.ts`、`src/utils/platform.ts`。

## Known Bugs

**开发服务器 favicon 404（工作区未提交删除）：**
- Symptoms: 浏览器 dev 模式下 `/notez-icon.svg` 404。
- Files: `index.html:5`（`href="/notez-icon.svg"`）；git 状态显示 `public/notez-icon.svg`、`public/notez-icon.png` 已删除
- Trigger: 运行 `npm run dev` 或 `npm run tauri dev`。
- Workaround: 恢复 `public/notez-icon.svg` 或更新 `index.html` 指向现有图标（Tauri 图标在 `src-tauri/icons/`）。

**Vite 端口与 Tauri devUrl 不一致：**
- Symptoms: 3000 端口被占用时 Vite 可能换端口，但 Tauri 仍连接 `http://localhost:3000`，导致 `tauri dev` 白屏或连接失败。
- Files: `vite.config.ts:16–18`（`port: 3000`, `strictPort: false`）；`src-tauri/tauri.conf.json:8`（`devUrl: "http://localhost:3000"`）
- Trigger: 本机 3000 已被其他进程占用。
- Workaround: 释放 3000 端口；或将 `strictPort: true` 并同步 devUrl。

**Rust 引擎 v0 子集静默跳过未实现语法：**
- Symptoms: 复杂 PlantUML 在 Rust 后端下部分元素缺失或布局与 JAR 不一致，仅 warnings 或无明确错误。
- Files: `src-tauri/src/plantuml_native/parse/sequence.rs`（unknown extras skipped）；`docs/superpowers/plans/2026-04-12-plantuml-component-v1-jar-parity.md`（契约）
- Trigger: 使用开发构建切换 `plantUmlBackend: 'rust'` 渲染超出 v0 子集的图。
- Workaround: 生产构建强制 JAR（`src/constants/buildFlags.ts`）；开发时手动切回 JAR。

## Security Considerations

**Tauri FS 作用域过宽：**
- Risk: 应用启动时对 `/` 及所有 Windows 盘符（`A:\`–`Z:\`）调用 `allow_directory(..., true)`，读写范围极大。
- Files: `src-tauri/src/lib.rs:45–55`
- Current mitigation: 依赖用户通过 dialog 选择路径；Tauri 插件 FS 仍受 scope 约束但 scope 本身极宽。
- Recommendations: 按需 `allow_directory`（仅用户选中的 workspace 根）；文档化安全模型；评估 `readFile`/`writeFile` 调用链。

**AI API Key 明文持久化：**
- Risk: OpenAI/自定义 provider 的 `apiKey` 以明文写入 `<appData>/settings.json`（Tauri）或 `localStorage`（浏览器 fallback）。
- Files: `src/store/useSettingsStore.ts`（`PersistedSettings.aiConfigs`）；`src/components/SettingsPanel.tsx:335–338`
- Current mitigation: UI 使用 `type="password"` 输入框；无 OS keychain 集成。
- Recommendations: Tauri 下使用 `tauri-plugin-stronghold` 或 OS credential store；浏览器模式至少 warn 用户风险。

**AI 自定义 baseUrl 无 SSRF 校验：**
- Risk: 用户可配置任意 `baseUrl`，`streamChat` 直接 `fetch`；恶意配置可能导致内网探测（桌面应用上下文）。
- Files: `src/components/aiService.ts:27–48`
- Current mitigation: 无 URL 白名单或 scheme 限制。
- Recommendations: 限制 `http`/`https`；可选 blocklist（`127.0.0.1`、`169.254.x`、`10.x` 等）；或明确文档为「用户自担风险」。

**预览 innerHTML 无 HTML 消毒：**
- Risk: `renderBasicMarkdown` 用正则转 Markdown 后直接 `innerHTML` 注入；恶意 Markdown 可嵌入 `<script>` 或事件处理器（若正则未覆盖）。
- Files: `src/components/PlantUMLRenderer.tsx:151–159`；`src/components/MermaidRenderer.tsx:120`
- Current mitigation: 部分 block 级标签负向前瞻；PlantUML/Mermaid 代码块 escape；SVG 经 `scopeSvgIdsForHtmlDocument` 处理。
- Recommendations: 引入 DOMPurify 或严格 allowlist；链接 `href` 校验 scheme。

**Rust 引擎 prescan 安全策略（正面但有限）：**
- Risk: `!include`/`!import`/`<img>` 在 Rust 路径被拒绝，但 JAR 路径无同等限制。
- Files: `src-tauri/src/plantuml_native/limits.rs:21–46`
- Current mitigation: Rust 后端 prescan；JAR 路径依赖 PlantUML.jar 自身行为。
- Recommendations: JAR 路径文档化风险；考虑统一 prescan 于 `render_plantuml_local` 入口。

## Performance Bottlenecks

**预览按键全量 DOM 重建 + 异步重绘：**
- Problem: 每次 `content` 变化执行完整 markdown→HTML、`innerHTML` 替换、串行 async PlantUML/Mermaid 重绘。
- Files: `src/components/PlantUMLRenderer.tsx:151–180`（注释写明 bypass React virtual DOM）
- Cause: `useLayoutEffect` 依赖 `[content, plantUmlTheme, previewDocumentId]` 无 debounce。
- Improvement path: 150–300ms debounce；增量更新 diagram 块；区分静态 markdown 与 diagram 异步部分。

**PlantUML 全局串行渲染队列：**
- Problem: `bundledJarSerial` Promise 链与 Rust 侧 `PICO_WEB` Mutex 强制串行；多图文档编辑时队列堆积。
- Files: `src/components/plantuml-offline/PlantUMLOfflineRenderer.ts:211–239`；`src-tauri/src/plantuml_runtime.rs:171–172, 637`
- Cause: 避免多 JVM 冷启动的设计权衡。
- Improvement path: 单 PicoWeb 长驻已 amortize JVM；可并行 HTTP 请求（需验证 PlantUML PicoWeb 线程安全）；前端 cache 已存在（`inFlightByKey`、cacheGet）。

**组件图 O(n²) 查找：**
- Problem: `ensure_node` 每次 `nodes.iter().any`；layout 中 `filter_map + find` 嵌套循环。
- Files: `src-tauri/src/plantuml_native/parse/component.rs`, `src-tauri/src/plantuml_native/layout/component.rs`
- Cause: 未建立 id 索引。
- Improvement path: `HashMap<id, Node>` 索引；预计算 depth 表。

**宽 Zustand 订阅：**
- Problem: 7 个组件使用 `useAppStore()` / `useSettingsStore()` 无 selector，任意字段变更可能触发重渲染。
- Files: `src/App.tsx`, `src/components/MarkdownEditor.tsx`, `src/components/FileExplorer.tsx`, `src/components/Sidebar.tsx`, `src/components/AiPanel.tsx`, `src/components/SettingsPanel.tsx`, `src/components/TabBar.tsx`
- Cause: 解构多字段的一次性订阅。
- Improvement path: 细粒度 selector；`useShallow`；对比 `MarkdownEditor` 对 settings 的 selector 模式。

**Sidebar 任务 filter 无 memo：**
- Problem: render 路径 `tasks.filter(t => !t.completed)` 每次 render 重新计算。
- Files: `src/components/Sidebar.tsx`
- Cause: 未使用 `useMemo`。
- Improvement path: derived selector 或 `useMemo`。

## Fragile Areas

**Windows 扩展路径前缀：**
- Files: `src-tauri/src/plantuml_runtime.rs:179–192`（`strip_windows_verbatim_prefix`）
- Why fragile: Tauri 返回 `\\?\` 路径；`java -jar` 对此前缀兼容差；删除此函数会导致 JAR 渲染失败。
- Safe modification: 任何路径传入 JVM 前必须经此 strip；新增 runtime 路径同理。
- Test coverage: 无专门单测；依赖集成路径。

**PicoWeb JVM 生命周期：**
- Files: `src-tauri/src/plantuml_runtime.rs`（`PICO_WEB`、`shutdown_plantuml_picoweb`）；`src-tauri/src/lib.rs:74–77`（`RunEvent::Exit` 清理）
- Why fragile: 全局 Mutex；进程 crash 后 guard 可能持有 stale `Child`；异常退出可能遗留 JVM。
- Safe modification: 改 PicoWeb 启动/重启逻辑时同步测试 pipe 回退（`MAX_PICO_ENCODED_LEN: 6000`）。
- Test coverage: 零自动化测试。

**Zustand 水合时序：**
- Files: `src/store/useAppStore.ts`（`_hasHydrated`）；`src/components/FileExplorer.tsx:420`（`if (!_hasHydrated) return`）
- Why fragile: 持久化 tabs/workspace 恢复前访问 localStorage 数据会得到空/默认状态。
- Safe modification: 新组件读取 persist 数据前检查 `_hasHydrated` 或 `onFinishHydration`。
- Test coverage: 部分 store 测试覆盖 localStorage 路径（`src/store/__tests__/`）。

**patch-package 与 Milkdown Crepe 主题：**
- Files: `patches/@milkdown+crepe+7.19.2.patch`, `src/hooks/useCrepeThemeStylesheet.ts`, `src/components/WysiwygEditor.tsx`
- Why fragile: WYSIWYG 主题与 Crepe 内部样式强耦合；patch 失效会导致编辑器样式错乱。
- Safe modification: 改 Milkdown 版本前必读 patch diff；跑 WYSIWYG 手动 smoke test。
- Test coverage: 无 WYSIWYG E2E。

**PlantUML 资源打包路径：**
- Files: `src-tauri/resources/plantuml-runtime/`（须含 `jre/`、`plantuml.jar`、`graphviz/`）；`src-tauri/tauri.conf.json`
- Why fragile: 缺失任一资源导致生产包 PlantUML 完全不可用。
- Safe modification: 构建前检查 README；勿移动 runtime 目录结构。
- Test coverage: `plantuml_runtime_available` Tauri 命令可探测可用性。

## Scaling Limits

**Rust 渲染输入与墙钟预算：**
- Current capacity: 整段源码 ≤1 MiB（`MAX_SOURCE_BYTES`）；单行 ≤16 KiB（`MAX_LINE_BYTES`）；`try_render_rust` 总墙钟 ≤2000 ms（`RUST_RENDER_BUDGET_MS`）。
- Limit: 超大文档或复杂图超时返回 `NativeError::Layout`。
- Scaling path: 可调常量（见 `src-tauri/src/plantuml_native/limits.rs`）；分块渲染（未实现）。

**PicoWeb URL 编码长度：**
- Current capacity: deflate 编码后 ≤6000 字符走 HTTP；超出回退 `-pipe`（每次新 JVM）。
- Limit: 超大图源 pipe 模式极慢。
- Scaling path: 大图源优先 pipe 或分片策略；文档化阈值（`src-tauri/src/plantuml_runtime.rs:539`）。

**localStorage  recent files 内容截断：**
- Current capacity: recent file content 截断至 `MAX_CONTENT_BYTES`（见 `FileOperations.ts`）。
- Limit: 大文件 recent 预览不完整；localStorage 配额（~5MB）可能溢出。
- Scaling path: recent 仅存 path/metadata，不存 content；Tauri 模式用磁盘索引。

**parse/sequence.rs 单文件规模：**
- Current capacity: ~4000 行单文件。
- Limit: IDE/编译器/人工 review 性能下降。
- Scaling path: 物理拆分模块。

## Dependencies at Risk

**Milkdown 7.19.x + patch-package：**
- Risk: 上游 breaking change 或 patch 冲突；Crepe 为相对较新 API。
- Impact: WYSIWYG 模式不可用或主题回归。
- Migration plan: 锁定版本；升级前在 branch 重打 patch；评估 `@milkdown/react` 替代路径。

**mermaid ^11.13.0：**
- Risk: major 版本 API 变更（`mermaidSingleton.ts` 封装层）。
- Impact: Mermaid 预览块渲染失败。
- Migration plan: 单测 `src/components/__tests__/mermaidSingleton.test.ts` 作为回归门禁。

**Tauri 2.x 插件矩阵：**
- Risk: `@tauri-apps/api`、`plugin-fs`、`plugin-dialog` 等版本需对齐；FS scope API 变更。
- Impact: 文件读写、dialog、单实例行为异常。
- Migration plan: 按 Tauri 迁移指南批量升级；重点测 `lib.rs` setup 与 `FileOperations.ts`。

**Vitest 在 dependencies 而非 devDependencies：**
- Risk: 生产 `npm install --production` 仍安装 vitest/jsdom/testing-library（若有人这样部署前端）。
- Impact: 包体积与依赖面增大。
- Migration plan: 移至 `devDependencies`（`package.json:46–47`）。

## Missing Critical Features

**Rust PlantUML 引擎图类型覆盖：**
- Problem: 仅序列图与组件图 v0 子集；类图、活动图等 `Parse`/`NotImplemented`。
- Blocks: 生产环境 Rust 后端切换（已强制 JAR）；离线 parity 目标。
- Files: `src-tauri/src/plantuml_native/mod.rs`, `src-tauri/src/plantuml_native/ir.rs`

**结构化诊断输出：**
- Problem: `diagnostics.rs` 仅为 stub；解析错误以 `NativeError::Parse { line, detail }` 字符串传递，无统一 diagnostic 集合。
- Blocks: IDE 级错误定位、warnings 聚合 UI。
- Files: `src-tauri/src/plantuml_native/diagnostics.rs`

**CI/CD 流水线：**
- Problem: 仓库无 `.github/workflows`；无自动化 lint/test/build on push。
- Blocks: 回归发现延迟；PR 质量门禁缺失。

**ESLint / Prettier：**
- Problem: 无 eslint 配置文件；仅个别 `eslint-disable-next-line` 注释。
- Blocks: 风格与静态分析一致性依赖人工。

## Test Coverage Gaps

**JAR/PicoWeb/HTTP/pipe 路径：**
- What's not tested: PicoWeb 生命周期、HTTP 客户端、deflate 编码、6000 字符回退、pipe 模式。
- Files: `src-tauri/src/plantuml_runtime.rs`
- Risk: JAR 路径 regression 仅能通过手动测试发现。
- Priority: High

**FileExplorer 组件：**
- What's not tested: 507 行多 root workspace、树展开、context actions。
- Files: `src/components/FileExplorer.tsx`
- Risk: 文件树 UI 与 workspace 持久化交互破坏。
- Priority: Medium

**WYSIWYG 编辑器（Milkdown Crepe）：**
- What's not tested: 主题切换、Crepe 与 Markdown 双模式同步。
- Files: `src/components/WysiwygEditor.tsx`, `src/hooks/useCrepeThemeStylesheet.ts`
- Risk: patch 或主题 refactor 无回归网。
- Priority: Medium

**fixture 维护缺口：**
- What's not tested: `src-tauri/tests/fixtures/plantuml_component/debug_nested_position.puml` 未接入 `plan_fixture_tests.rs`。
- Files: `src-tauri/src/plantuml_native/plan_fixture_tests.rs`, `src-tauri/tests/fixtures/plantuml_component/debug_nested_position.puml`
- Risk: 调试 fixture 腐烂；nested layout bug 无 CI 覆盖。
- Priority: Low

**前端 PlantUML 离线解析器 vs Rust 后端：**
- What's not tested: `PlantUMLParser.ts` 与 Rust `parse/*` 行为对齐（仅各自单测）。
- Files: `src/components/plantuml-offline/PlantUMLParser.ts`, `src/components/__tests__/PlantUMLParser.test.ts`
- Risk: 前端 DOT/布局预览与 Tauri invoke 结果不一致。
- Priority: Medium

**App 级集成 / E2E：**
- What's not tested: 无 Playwright/Tauri WebDriver E2E；`PlantUMLE2E.test.ts` 为 mock 级测试。
- Files: `src/components/__tests__/PlantUMLE2E.test.ts`
- Risk: 多标签、自动保存、CLI 打开文件等跨模块流程无覆盖。
- Priority: Medium

---

*Concerns audit: 2026-06-24*
