# NoteZ

基于 **Tauri 2 + React 19 + TypeScript + Vite** 构建的跨平台桌面 Markdown 笔记应用，支持 Mermaid 图表、PlantUML 离线渲染、多工作区管理、Kanban 任务看板等功能。

---

## 环境要求

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 20 | 前端运行时 |
| npm | 最新版 | 包管理器 |
| Rust | stable (≥ 1.77) | 通过 [rustup](https://rustup.rs/) 安装 |
| WebView2 | 已内置 | Windows 11 已预装；Win 10 需手动安装 |

---

## 安装依赖

```powershell
# 在仓库根目录执行
npm install
```

---

## 开发模式（Debug）

**启动前端 + Tauri 桌面窗口（热重载）：**

```powershell
npm run tauri dev
```

- 前端由 Vite Dev Server 提供，支持 HMR（热模块替换）
- Rust 后端变更后会自动重新编译并重启窗口
- 默认以 **debug** 模式编译 Rust，编译速度快，含调试符号
- DevTools 可通过右键菜单 → "Inspect Element" 打开

**仅启动前端预览（不含 Tauri 窗口）：**

```powershell
npm run dev
```

浏览器访问 `http://localhost:1420` 查看 UI（Tauri API 调用会失败，适合纯 UI 调试）。

---

## 生产构建（Release）

### 1. 仅构建前端产物

```powershell
npm run build
```

输出到 `dist/` 目录，包含压缩后的 HTML / JS / CSS / 字体资源。

### 2. 构建完整 Tauri 桌面安装包

```powershell
npm run tauri build
```

- 以 **release** 模式编译 Rust（开启优化，体积更小，速度更快）
- Windows 输出路径：`src-tauri/target/release/bundle/`
  - `msi/` → Windows Installer 安装包（`.msi`）
  - `nsis/` → NSIS 安装包（`.exe`）
  - `notez.exe` → 可直接运行的可执行文件

> **注意：** 首次 release 构建需下载 WiX / NSIS 工具链，耗时较长（5~15 分钟）。

### 3. 仅编译 Rust Release 二进制（不打包安装包）

```powershell
npm run tauri build -- --no-bundle
```

输出：`src-tauri/target/release/notez.exe`，适合快速验证 release 行为。

---

## PlantUML 双后端（JAR + 实验性 Rust）

- 在应用 **设置 → PlantUML** 中切换渲染引擎；Rust 路径仅覆盖**序列图 v0 子集**（与 JAR 像素/主题不必一致）。
- **契约与验证门禁**（附录、Fixture 表、手工冒烟步骤）：仓库内 [`docs/superpowers/plans/2026-04-12-plantuml-component-v1-jar-parity.md`](docs/superpowers/plans/2026-04-12-plantuml-component-v1-jar-parity.md)。
- **Rust 契约样例文件**：`src-tauri/tests/fixtures/plantuml_sequence/`（由 `cd src-tauri && cargo test` 加载，勿与实现脱节）。

---

## 运行测试

```powershell
# 运行全部测试（单次）
npm test -- run

# 监听模式（文件变更时自动重跑）
npm test
```

```powershell
# PlantUML Rust 引擎（含 fixture 契约）
cd src-tauri
cargo test
```

当前覆盖（数量随用例增长而变化，以 `npm test` / `cargo test` 输出为准）：

| 测试文件 | 覆盖内容 |
|----------|----------|
| MermaidRenderer.test.tsx | 块解析 + CSS 滚动条规则 |
| FileOperations.test.tsx | 文件读写操作 |
| TaskBoard.test.tsx | Kanban 任务看板逻辑 |
| PlantUMLParser.test.ts | PlantUML 语法解析（DOT 等） |
| PlantUMLRenderer.test.tsx | 渲染器组件 |
| PlantUMLE2E.test.ts | 端到端渲染管道 |
| PlantUMLRealRender.test.ts | mock invoke、双后端、缓存与错误 HTML |
| plantumlBackendSettings.test.ts | PlantUML 后端设置与持久化 |
| `src-tauri` `cargo test` | JAR 编码、Rust 解析/布局/SVG、**plan_fixture_tests** |

---

## 清除缓存 & 重新构建

```powershell
# 清除 Vite 构建缓存
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue

# 清除 Rust 编译缓存（谨慎使用，重新编译耗时较长）
cargo clean --manifest-path src-tauri/Cargo.toml

# 重新安装前端依赖并构建
npm install
npm run build
```

---

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/) +
  [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) +
  [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
