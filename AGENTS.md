# AGENTS.md

## Project Overview
NoteZ 是一个 Tauri 桌面 Markdown 编辑器，采用 React 19 + TypeScript 前端与 Rust 后端。核心特性包括双后端 PlantUML 渲染（JAR 长驻 PicoWeb 服务 + 实验性 Rust 原生引擎）、多标签编辑、AI 助手集成。仓库根目录即应用根：`src/` 为前端，`src-tauri/` 为 Rust 后端。

## Commands

### Development
```bash
# 前端开发服务器（在仓库根目录）
npm install && npm run dev

# Tauri 开发模式（同时启动前端和 Rust）
npm run tauri dev

# Rust 后端单独测试
cd src-tauri && cargo test

# 前端测试
npm run test
```

### Testing
```bash
# 前端单测（Vitest）
npx vitest run

# Rust 单测（带输出）
cd src-tauri && cargo test -- --nocapture

# 运行特定 Rust 测试
cd src-tauri && cargo test test_name
```

### Build & Deploy
```bash
# 构建生产包
npm run tauri build

# 仅构建前端
npm run build

# 仅构建 Rust release
cd src-tauri && cargo build --release
```

## Architecture Constraints

- **PlantUML 后端切换**：`render_plantuml_local` 的 `backend` 默认为 `"jar"`；Rust 路径仅支持 **SVG**，序列图由 `plantuml_native::try_render_rust` 解析—布局—出图。已支持：`participant`/`actor`（引号 `as`）、`->`/`-->`（标签可取第一个 `:` 后全文，含更多 `:`）、**`title`**（单行或 `end title` 多行；**不得写在 fragment 内**）、**`legend`**（`left`/`right`/`center` + `end legend`；**仅图顶层**）、单层 **`alt`/`opt`/`loop`/`group`/`par`**（fragment 内为 **`DiagramStep`：消息或 `note`**；`par` 内 **`and`** 与 **`else`** 均可分段；**`and` 不得出现在 `par` 外**）、**`note`**（`left of`/`right of`/`over` + **`end note`** 多行）、**`activate`/`deactivate`**、**`autonumber`**、**`skinparam` 白名单**；**fragment 虚线背景框**（按布局行含注释）。其它未实现行仍跳过；**非序列图关键字** **`Parse`**；`!include` 预扫描 **`ForbiddenDirective`**。契约见 `docs/superpowers/plans/2026-04-12-plantuml-component-v1-jar-parity.md`。
- **PicoWeb 长驻进程**：JAR 路径通过 `PICO_WEB` 全局锁管理单例 JVM 子进程，应用退出时需调用 `shutdown_plantuml_picoweb()` 清理。
- **Windows 路径前缀**：Tauri 返回 `\\?\` 扩展路径，`plantuml_runtime.rs` 有 `strip_windows_verbatim_prefix` 处理，勿删除。
- **FS 作用域**：`lib.rs` 中 `fs_scope` 允许 `/` 和所有 Windows 盘符读写，新增沙箱限制需同步修改此处。
- **持久化隔离**：设置存储在 `<appData>/settings.json`（Tauri）或 `localStorage`（浏览器），应用状态通过 Zustand `persist` 存 localStorage。编辑器主题字段：`editorColorMode`、`editorThemeId`、`codeBlockThemeId`（见 `src/constants/editorThemes.ts`、`codeBlockThemes.ts`）。

## Known Gotchas

- **npm install 后必须运行 postinstall**：`patch-package` 补丁在 `postinstall` 钩子中自动执行，若跳过会导致依赖问题。
- **Vite 端口固定 3000**：`vite.config.ts` 中 `strictPort: false`，但 Tauri `devUrl` 硬编码 3000，占用会导致启动失败。
- **PlantUML 资源路径**：`src-tauri/resources/plantuml-runtime/` 必须包含 `jre/`、`plantuml.jar`、`graphviz/`，构建时由 `tauri.conf.json` 打包。
- **日志文件位置**：PlantUML 日志写入可执行文件同目录 `notez-plantuml.log`，调试时检查此文件。
- **URL 编码阈值**：PlantUML deflate 编码后超过 6000 字符会自动回退到 `-pipe` 模式，避免 Jetty/浏览器截断 URL。
- **Rust 引擎 v0 子集**：见计划文档；契约样例在 `src-tauri/tests/fixtures/plantuml_sequence/`（`cargo test` 中 `plan_fixture_tests` 引用）。扩展新图类时在 `ir::DiagramKind` 登记并加 `parse/<kind>/`。
- **Rust 渲染限额**：整段源码 ≤1 MiB、单行 ≤16 KiB、`try_render_rust` 总墙钟 ≤2000 ms；常量见 `plantuml_native/limits.rs`。
- **fs_scope 权限**：若遇到 "permission denied"，检查 `lib.rs` 中 `allow_directory` 调用是否覆盖目标路径。
- **Zustand 水合**：`_hasHydrated` 标志用于判断持久化状态是否恢复，访问 localStorage 数据前需等待 `onFinishHydration`。
