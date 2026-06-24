---
last_mapped_commit: ffbef8cf2cbc9018fd95ada62430d2e2eb17ab05
---

# Technology Stack

**Analysis Date:** 2026-06-24

## Languages

**Primary:**
- TypeScript ~5.8 — 全部前端应用代码（`src/`）、Vite/Vitest 配置（`vite.config.ts`、`vitest.config.ts`）
- Rust 2021 edition (stable ≥ 1.77) — Tauri 桌面后端（`src-tauri/src/`）

**Secondary:**
- JavaScript — 构建脚本与 PostCSS 配置（`postcss.config.js`、`scripts/*.mjs`）
- Java (bundled JRE) — 随包 PlantUML 运行时，非源码；由 Rust 子进程调用（`src-tauri/resources/plantuml-runtime/jre/`）

## Runtime

**Environment:**
- Node.js ≥ 20 — 前端开发、构建、测试（见 `README.md`）
- Rust stable (≥ 1.77) — Tauri 后端编译与运行
- WebView2 — Windows 桌面壳（Tauri 2 默认；`README.md` 说明 Win 10 需单独安装）
- 浏览器 — 仅 `npm run dev` 纯 UI 调试；Tauri API 不可用

**Package Manager:**
- npm（最新版，见 `README.md`）
- Lockfile: `package-lock.json` 存在
- Rust: Cargo.lock（Tauri 项目标准，随 `src-tauri/Cargo.toml` 管理）

## Frameworks

**Core:**
- React ^19.1.0 — UI 框架（`src/main.tsx`、`src/App.tsx`）
- Tauri 2 — 跨平台桌面壳；配置在 `src-tauri/tauri.conf.json`，入口 `src-tauri/src/main.rs` → `src-tauri/src/lib.rs`
- Vite ^7.0.4 — 前端 dev server 与生产打包（`vite.config.ts`；dev 端口 3000，与 `tauri.conf.json` 的 `devUrl` 一致）

**UI / Editor:**
- @milkdown/kit ^7.19.2 + @milkdown/crepe ^7.19.2 + @milkdown/react ^7.19.2 — WYSIWYG Markdown 编辑器（`src/components/WysiwygEditor.tsx`）
- codemirror ^6 + @codemirror/* — 源码/Markdown 编辑模式（`src/components/MarkdownEditor.tsx`）
- Tailwind CSS ^4.2.2 + @tailwindcss/postcss — 样式（`src/App.css` 使用 `@import "tailwindcss"`）
- @radix-ui/react-dialog、@radix-ui/react-tabs — 对话框与标签 UI（`src/components/`）
- lucide-react ^1.7.0 — 图标

**Testing:**
- Vitest ^4.1.2 — 前端单元/组件测试（`vitest.config.ts`；`environment: 'jsdom'`）
- @testing-library/react ^16.3.2 — React 组件测试
- jsdom ^29.0.1 — DOM 模拟
- Rust `cargo test` — 后端与 PlantUML 原生引擎测试（`src-tauri/tests/`）

**Build/Dev:**
- TypeScript ~5.8.3 — 类型检查（`npm run build` 先跑 `tsc`）
- @vitejs/plugin-react ^4.6.0 — React Fast Refresh
- @tauri-apps/cli ^2 — `npm run tauri dev|build`
- patch-package ^8.0.1 — 对 Milkdown 打补丁（`postinstall` → `patches/@milkdown+*.patch`）
- potrace、sharp — 图标生成脚本（`scripts/generate-icon-svg.mjs`）

## Key Dependencies

**Critical (Frontend):**
- zustand ^5.0.12 — 全局状态（`src/store/useAppStore.ts`）与设置（`src/store/useSettingsStore.ts`）
- @tauri-apps/api ^2 + plugins (fs, dialog, cli, opener) — 桌面文件、对话框、CLI 参数、打开外部链接
- mermaid ^11.13.0 — 客户端 Mermaid 渲染（`src/components/mermaidSingleton.ts`）
- mermaid / PlantUML 渲染管线 — `src/components/diagramRenderers.ts`、`src/components/plantuml-offline/PlantUMLOfflineRenderer.ts`

**Critical (Backend):**
- tauri ^2 + tauri-plugin-fs/dialog/cli/opener/single-instance/window-state — 桌面能力与权限（`src-tauri/capabilities/default.json`）
- flate2 ^1 — PlantUML deflate URL 编码（`src-tauri/src/plantuml_runtime.rs`）
- chrono ^0.4 — PlantUML 日志时间戳
- rust-sugiyama ^0.4 — PlantUML Rust 原生引擎布局（`src-tauri/src/plantuml_native/`）
- window-vibrancy ^0.5 (Windows) — Mica 透明窗口（`src-tauri/src/lib.rs`）

**Infrastructure:**
- serde / serde_json ^1 — Tauri command 序列化（`render_plantuml_local` 等）
- 无服务端框架、无 ORM、无云数据库客户端

## Configuration

**Environment:**
- 无 `.env` 文件；应用不依赖环境变量启动
- AI 提供商配置（baseUrl、apiKey、model）持久化在 `<appLocalDataDir>/settings.json`（Tauri）或 `localStorage` 键 `notez-settings`（浏览器），见 `src/store/useSettingsStore.ts`
- PlantUML 后端切换：开发构建可切换 JAR/Rust；生产构建强制 JAR（`src/constants/buildFlags.ts`）

**Build:**
- `package.json` — npm scripts 与前端依赖
- `src-tauri/Cargo.toml` — Rust 依赖与 crate 类型
- `src-tauri/tauri.conf.json` — 应用 ID、窗口、bundle 目标（nsis/msi）、PlantUML 资源目录
- `vite.config.ts` — Vite 端口 3000、Tauri HMR、忽略 `src-tauri/**`
- `vitest.config.ts` — jsdom + globals
- `tsconfig.json` — strict TS、ES2020、React JSX
- `postcss.config.js` — Tailwind PostCSS 插件
- `src-tauri/capabilities/default.json` — Tauri 2 权限声明

## Platform Requirements

**Development:**
- macOS / Linux / Windows（任意支持 Node 20+ 与 Rust stable 的平台）
- Windows：WebView2；PlantUML 本地渲染需预先填充 `src-tauri/resources/plantuml-runtime/`（JRE、`plantuml.jar`、Graphviz），见 `src-tauri/resources/plantuml-runtime/README.md`
- `npm install` 后必须执行 `postinstall`（patch-package），否则 Milkdown 补丁未应用

**Production:**
- 部署目标：Tauri 桌面安装包（Windows NSIS `.exe` + MSI；`tauri.conf.json` → `bundle.targets`）
- 前端产物：`dist/`（`beforeBuildCommand: npm run build`）
- Rust release 二进制：`src-tauri/target/release/notez.exe`（Windows）
- 捆绑资源：`resources/plantuml-runtime/` 打入 `$RESOURCE`；日志写入可执行文件同目录 `notez-plantuml.log`
- 无 Web 托管、无 Docker、无 CI 工作流（`.github/` 未检测到）

---

*Stack analysis: 2026-06-24*
*Update after major dependency changes*
