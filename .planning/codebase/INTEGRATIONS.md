---
last_mapped_commit: ffbef8cf2cbc9018fd95ada62430d2e2eb17ab05
---

# External Integrations

**Analysis Date:** 2026-06-24

## APIs & External Services

**AI / LLM (OpenAI-compatible):**
- OpenAI API — 默认云端聊天补全（设置面板预设 `https://api.openai.com/v1`）
  - Client: 浏览器 `fetch`（`src/components/aiService.ts`）
  - Auth: Bearer token，来自用户配置的 `apiKey`（存于 `settings.json` / `localStorage`，非环境变量）
  - Endpoints: `POST {baseUrl}/chat/completions`（流式 SSE）、`GET {baseUrl}/models`（连接测试）
  - UI: `src/components/AiPanel.tsx` 调用 `streamChat`
- Ollama — 本地 OpenAI 兼容端点（默认 `http://localhost:11434/v1`）
  - Client: 同上 `fetch`
  - Auth: 预设 `apiKey: 'ollama'` 时不发送 Authorization 头
- Custom provider — 任意 OpenAI 兼容 baseUrl + apiKey + model（`src/store/useSettingsStore.ts` 中 `AiProvider = 'openai' | 'ollama' | 'custom'`）

**PlantUML (local bundled runtime):**
- PlantUML JAR + Temurin JRE + Graphviz — 离线 SVG 渲染（非 HTTP 外网服务）
  - Integration: Tauri invoke → Rust `render_plantuml_local`（`src-tauri/src/plantuml_runtime.rs`）
  - Default path: 长驻 PicoWeb 子进程 `java -jar plantuml.jar -picoweb:{port}:127.0.0.1`，Rust 对 `127.0.0.1` 发 HTTP GET
  - Fallback: 单次 `-pipe` 子进程；超长 deflate 编码（>6000 字符）自动回退
  - Resources: `src-tauri/resources/plantuml-runtime/`（打包至 `$RESOURCE/resources/plantuml-runtime/`）
  - Logs: `{exe_dir}/notez-plantuml.log`
  - Experimental: Rust 原生引擎 `plantuml_native`（序列图 v0 子集），前端经同一 invoke 切换 backend（`src/components/plantuml-offline/PlantUMLOfflineRenderer.ts`）

**Mermaid:**
- 纯客户端渲染 — 无外部 API
  - SDK: `mermaid` npm 包（`src/components/mermaidSingleton.ts`）
  - 在 WebView DOM 内 `mermaid.render()` 生成 SVG

**External APIs (general):**
- 除 AI 提供商外，应用不调用其他 REST/GraphQL 云服务
- 无 Stripe、SendGrid、Supabase 等第三方 SaaS SDK

## Data Storage

**Databases:**
- None — 无 SQL/NoSQL 数据库；笔记内容即用户选择的 Markdown 文件

**File Storage:**
- Local filesystem — 用户工作区与笔记文件
  - Tauri: `@tauri-apps/plugin-fs`（读/写/列目录/重命名/删除），`@tauri-apps/plugin-dialog` 选择路径
  - 实现: `src/components/FileOperations.ts`、`src/components/FileExplorer.tsx`
  - FS scope: 启动时在 `src-tauri/src/lib.rs` 对 `/` 及 Windows 各盘符 `allow_directory`
- 设置文件 — `<appLocalDataDir>/settings.json`（Tauri）或 `localStorage` 键 `notez-settings`（浏览器）
  - 含 AI 配置、PlantUML 主题/后端、编辑器主题字段（`src/store/useSettingsStore.ts`）

**Application State (browser storage):**
- localStorage — Zustand persist 存储标签页、任务看板、工作区目录等（`src/store/useAppStore.ts`）
  - 与 settings 分离；不写入 `settings.json`

**Caching:**
- None (server-side) — PlantUML 前端有渲染结果缓存逻辑（见 `src/components/plantuml-offline/` 与测试 `PlantUMLRealRender.test.ts`），无 Redis/云缓存

## Authentication & Identity

**Auth Provider:**
- None — 桌面 Markdown 编辑器，无用户账号体系
- AI API keys 由用户自行填入设置面板，仅存本地磁盘/localStorage

**OAuth Integrations:**
- Not applicable

## Monitoring & Observability

**Error Tracking:**
- None — 无 Sentry 等第三方错误上报

**Analytics:**
- None

**Logs:**
- PlantUML: 文件日志 `notez-plantuml.log`（可执行文件同目录，`src-tauri/src/plantuml_runtime.rs`）
- Frontend: `console.error` 用于设置保存失败等（`src/store/useSettingsStore.ts`）
- Rust: 标准输出/PlantUML 专用日志文件；无集中式日志服务

## CI/CD & Deployment

**Hosting:**
- Desktop distribution — Tauri bundle（Windows NSIS + MSI）
  - 配置: `src-tauri/tauri.conf.json` → `bundle.targets: ["nsis", "msi"]`
  - 构建: `npm run tauri build`

**CI Pipeline:**
- None detected — 仓库无 `.github/workflows/` 或其它 CI 配置

## Environment Configuration

**Development:**
- Required env vars: None
- Secrets location: 用户在本机 `settings.json` 或 localStorage 填写 AI `apiKey`（不入库、无 `.env`）
- Local services: Ollama 可选（`http://localhost:11434`）；PlantUML 依赖随包 JRE/JAR/Graphviz 或 Rust 引擎

**Staging:**
- Not applicable — 无独立 staging 环境

**Production:**
- Secrets management: 用户本机 settings 文件；安装包不含 API 密钥
- PlantUML 运行时随安装包分发（需构建前手动放入 `plantuml-runtime/`，大文件 gitignore）

## Webhooks & Callbacks

**Incoming:**
- None — 无 HTTP 服务器、无 webhook 端点

**Outgoing:**
- AI providers — 用户触发聊天时 `fetch` 至配置的 `baseUrl`（流式 chat completions）
- PlantUML PicoWeb — Rust 进程内对 `127.0.0.1:{dynamic_port}` 的 HTTP GET（本地 loopback，非公网）
- Tauri events — 单实例插件将 CLI 传入的 `.md` 路径 emit 为 `open-markdown-path`（`src-tauri/src/lib.rs` → `src/App.tsx`）

## Tauri Plugin Integrations

| Plugin | Package / Crate | Purpose | Key files |
|--------|-----------------|---------|-----------|
| fs | `@tauri-apps/plugin-fs` / `tauri-plugin-fs` | 读写笔记与设置 | `FileOperations.ts`, `useSettingsStore.ts`, `lib.rs` setup scope |
| dialog | `@tauri-apps/plugin-dialog` | 打开/保存/消息框 | `FileOperations.ts`, `nativeDialog.ts` |
| cli | `@tauri-apps/plugin-cli` | 启动参数 `path` | `tauri.conf.json`, `App.tsx` |
| opener | `@tauri-apps/plugin-opener` | 打开外部 URL/文件（已注册） | `lib.rs` |
| single-instance | `tauri-plugin-single-instance` | 二次启动聚焦并打开文件 | `lib.rs` |
| window-state | `tauri-plugin-window-state` | 窗口几何持久化 | `lib.rs` |

Permissions declared in `src-tauri/capabilities/default.json`.

## Network Boundaries Summary

| Integration | Network | User-configured | Offline-capable |
|-------------|---------|-----------------|-----------------|
| OpenAI / custom AI | HTTPS outbound | Yes (baseUrl, apiKey) | No |
| Ollama | HTTP localhost | Yes (default localhost) | Yes (local) |
| PlantUML JAR | Loopback HTTP + subprocess | Theme/backend in settings | Yes |
| PlantUML Rust | In-process | Backend in settings | Yes |
| Mermaid | None | N/A | Yes |
| File I/O | None | User picks paths | Yes |

---

*Integration audit: 2026-06-24*
*Update when adding/removing external services*
