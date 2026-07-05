# 设置界面重构 + 字体设置 + AI 服务增强 设计文档

**日期**: 2026-07-04
**状态**: Reviewed
**范围**: 前端组件拆分、Rust 后端新命令、数据模型扩展

---

## 1. 目标

将当前嵌入标签页的平铺式设置面板，重构为独立模态对话框 + 分类侧边导航的标准桌面设置体验；同时新增三层字体配置（应用界面 / 编辑器 / 代码块）和 AI 服务增强（代理设置、模型拉取、Anthropic 支持）。

### 非目标

- 不涉及 PlantUML 渲染引擎的功能变更
- 不涉及编辑器核心（CodeMirror / Milkdown）的功能变更
- 不新增全局快捷键（继续使用 `Ctrl+,` 打开设置）

---

## 2. 设置界面重构

### 2.1 布局

居中模态对话框，覆盖在编辑器之上：

```
┌──────────────────────────────────────────────┐
│  ╔══════════════════════════════════════════╗ │
│  ║  ┌──────────┬───────────────────────────┐║ │
│  ║  │ 外观     │  颜色模式                 │║ │
│  ║  │ ★ 活跃   │  [浅色] [深色] [跟随系统]  │║ │
│  ║  │          │                           │║ │
│  ║  │ AI 服务  │  编辑器主题               │║ │
│  ║  │          │  [Nord        ▾]          │║ │
│  ║  │ PlantUML │                           │║ │
│  ║  │          │  字体设置                  │║ │
│  ║  │          │  ┌─────────────────────┐  │║ │
│  ║  │          │  │ 应用界面  编辑器 代码 │  │║ │
│  ║  │          │  │ [字体▾] [−]14[+]    │  │║ │
│  ║  │          │  └─────────────────────┘  │║ │
│  ║  └──────────┴───────────────────────────┘║ │
│  ╚══════════════════════════════════════════╝ │
│          (半透明遮罩背景)                      │
└──────────────────────────────────────────────┘
```

- **遮罩**：半透明黑色背景（`bg-black/40`），点击遮罩关闭对话框
- **对话框尺寸**：最大宽度 720px，最大高度 80vh，居中
- **关闭方式**：ESC 键、点击遮罩、右上角关闭按钮
- **左侧导航**：固定宽度 180px，包含三个分类：外观、AI 服务、PlantUML
- **右侧内容区**：根据选中分类渲染对应设置组件，内容超长时独立滚动

### 2.2 分类结构

| 分类 | 包含的设置项 |
|------|------------|
| **外观** | 颜色模式（浅色/深色/跟随系统）、编辑器文档主题（Frame/Nord/Crepe）、代码块语法高亮主题、三组字体设置 |
| **AI 服务** | 服务商配置列表（增删改查 + 测试连接）、每个服务商的代理设置、模型拉取 |
| **PlantUML** | 渲染引擎切换（JAR/Rust）、图表主题下拉 |

### 2.3 组件拆分

从现有的单文件 `SettingsPanel.tsx`（390 行）拆分为：

| 新组件 | 文件 | 职责 |
|--------|------|------|
| `SettingsDialog` | `src/components/settings/SettingsDialog.tsx` | 对话框容器：遮罩层 + 居中面板 + ESC/点击关闭 + 左右两栏布局 |
| `SettingsSidebar` | `src/components/settings/SettingsSidebar.tsx` | 左侧分类导航列表，管理 `activeCategory` 状态 |
| `AppearanceSettings` | `src/components/settings/AppearanceSettings.tsx` | 外观分类：颜色模式切换、主题选择、字体设置区域 |
| `AiSettings` | `src/components/settings/AiSettings.tsx` | AI 服务商配置（从 SettingsPanel 提取的 AI 逻辑） |
| `AiProviderEditor` | `src/components/settings/AiProviderEditor.tsx` | 单个 AI 服务商编辑表单（代理、模型拉取在此） |
| `PlantUmlSettings` | `src/components/settings/PlantUmlSettings.tsx` | PlantUML 引擎与主题 |
| `FontPicker` | `src/components/settings/FontPicker.tsx` | 复用的字体选择器组件 |
| `FontSizeStepper` | `src/components/settings/FontSizeStepper.tsx` | 数字输入框 + 加减按钮 |

**目录结构**：所有设置组件统一放在 `src/components/settings/` 下，旧 `SettingsPanel.tsx` 在重构完成后删除。

### 2.4 迁移策略

**打开方式变更**：

| 原来 | 重构后 |
|------|--------|
| `Ctrl+,` → `openSettingsTab()` → 创建 `SETTINGS_TAB_ID` 标签页 | `Ctrl+,` → `toggleSettingsDialog()` → 切换对话框 `open` 状态 |
| `SettingsPanel` 作为标签页内容在 `App.tsx` 条件渲染 | `SettingsDialog` 始终挂载在 `App.tsx` 底部，通过 `open` prop 控制可见性 |
| 齿轮图标点击 → `openSettingsTab()` | 齿轮图标点击 → `toggleSettingsDialog()` |

**状态管理变更**：

- `useAppStore` 中移除 `SETTINGS_TAB_ID` 相关的标签页逻辑
- `useAppStore` 新增 `settingsDialogOpen: boolean` 和 `toggleSettingsDialog` / `openSettingsDialog` / `closeSettingsDialog` actions
- `useAppStore` 新增 `settingsCategory: SettingsCategory` 记住上次选中的分类

**向后兼容**：

- 如果用户持久化的 `tabs` 数组中包含 `SETTINGS_TAB_ID`，`initSettings` 时自动过滤掉

---

## 3. 字体设置

### 3.1 三层字体配置

| 层面 | 影响范围 | CSS 应用方式 | 默认字体族 | 默认字号 |
|------|---------|-------------|-----------|---------|
| 应用界面 | 侧边栏、标签栏、工具栏、设置对话框等全局 UI | `:root` CSS 变量 `--notez-ui-font-family` / `--notez-ui-font-size` | `"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif` | `16px` |
| 编辑器 | CodeMirror 源码编辑器 + Milkdown WYSIWYG 正文 | CodeMirror: `Compartment` 注入 `EditorView.theme({ ".cm-content": { fontFamily, fontSize } })`；Milkdown: CSS 变量覆盖 Crepe 主题的 `--crepe-font-default` | 继承 UI 字体 | `16px` |
| 代码块 | 编辑器内 fenced code block | CodeMirror 代码块的 `EditorView.theme`；Milkdown CodeMirror 实例同理 | `ui-monospace, "Cascadia Code", Consolas, monospace` | `14px` |

### 3.2 CSS 变量注入

在 `App.tsx` 中根据 store 状态动态设置 `:root` CSS 变量：

```typescript
useEffect(() => {
  const root = document.documentElement;
  root.style.setProperty('--notez-ui-font-family', uiFontConfig.fontFamily);
  root.style.setProperty('--notez-ui-font-size', `${uiFontConfig.fontSize}px`);
  root.style.setProperty('--notez-editor-font-family', editorFontConfig.fontFamily);
  root.style.setProperty('--notez-editor-font-size', `${editorFontConfig.fontSize}px`);
  root.style.setProperty('--notez-code-font-family', codeBlockFontConfig.fontFamily);
  root.style.setProperty('--notez-code-font-size', `${codeBlockFontConfig.fontSize}px`);
}, [uiFontConfig, editorFontConfig, codeBlockFontConfig]);
```

`App.css` 中 `:root` 的硬编码 `font-family` 和 `font-size` 改为引用变量：

```css
:root {
  font-family: var(--notez-ui-font-family, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif);
  font-size: var(--notez-ui-font-size, 16px);
  line-height: var(--notez-ui-line-height, 24px);
}
```

**`App.css` 中其他硬编码字体位置**（均需改为引用 CSS 变量）：

| 行号 | 选择器 | 当前值 | 改为 |
|------|--------|--------|------|
| ~195 | `.diagram-tools-button-group button` | `"Segoe UI Variable", ...` | `var(--notez-ui-font-family)` |
| ~226 | `.diagram-zoom-label` | `var(--crepe-font-default, ...)` | 保留（已用变量） |
| ~322 | `.notez-toast` | `"Segoe UI Variable", ...` | `var(--notez-ui-font-family)` |
| ~566 | `.plantuml-error__source` | `ui-monospace, ...` | `var(--notez-code-font-family)` |

### 3.3 CodeMirror 字体注入

新增 `fontCompartment: Compartment`，与现有的 `editorThemeCompartment` 和 `codeBlockSyntaxCompartment` 并列：

```typescript
const fontCompartment = new Compartment();

function getFontExtension(editorFont: FontConfig, codeFont: FontConfig): Extension {
  return EditorView.theme({
    '.cm-content': {
      fontFamily: editorFont.fontFamily,
      fontSize: `${editorFont.fontSize}px`,
    },
    '.cm-gutters': {
      fontSize: `${editorFont.fontSize}px`,
    },
  });
}
```

当字体设置变更时，通过 `Compartment.reconfigure()` 热更新，无需重建编辑器。

### 3.4 Milkdown (WYSIWYG) 字体注入

Milkdown Crepe 主题通过 CSS 变量控制字体族（`--crepe-font-default`、`--crepe-font-code`），但 **font-size 是硬编码的**（散布在 `reset.css`、`code-mirror.css` 等处），无 `--crepe-font-size` 变量。

**字体族注入**：在 `WysiwygEditor.tsx` 的容器 div 上设置内联样式覆盖 CSS 变量：

```typescript
style={{
  '--crepe-font-default': editorFontConfig.fontFamily,
  '--crepe-font-code': codeBlockFontConfig.fontFamily,
}}
```

**字号注入**：由于 Crepe 无 font-size 变量，需通过额外 CSS 选择器覆盖：

```css
.wysiwyg-editor .milkdown .ProseMirror {
  font-size: var(--notez-editor-font-size, 16px);
}
.wysiwyg-editor .milkdown .ProseMirror pre code {
  font-size: var(--notez-code-font-size, 14px);
}
```

这些规则添加到 `App.css` 中，通过 `:root` CSS 变量驱动。

**代码块字体**：Crepe 提供 `--crepe-font-code` 变量（默认 `Fira Code, monospace`），可直接覆盖。代码块的 CodeMirror 实例字号通过 Crepe 的 CodeMirror feature config 传入。

**刷新策略**：当前 Milkdown 通过 `key` prop 触发 remount。字体族变更时不需要 remount——CSS 变量变更会立即生效。字号变更通过 CSS 变量也立即生效。仅在编辑器主题（`editorThemeId`）变更时才需要 remount。

### 3.5 字体选择器组件 (`FontPicker`)

**交互设计**：

```
┌─────────────────────────┐
│ 微软雅黑              ▾ │  ← 选中值展示
├─────────────────────────┤
│ 🔍 搜索字体...          │  ← 搜索过滤
├─────────────────────────┤
│ 推荐                    │  ← 推荐分组标题
│  微软雅黑       ← 高亮  │
│  Segoe UI Variable      │
│  思源宋体               │
│  思源黑体               │
├─────────────────────────┤
│ 系统字体                │  ← 系统字体分组标题
│  Arial                  │
│  Calibri                │
│  ...                    │
└─────────────────────────┘
```

- 每个选项用**自身字体渲染**预览效果（内联 `style={{ fontFamily: name }}`）
- 搜索框支持模糊匹配（大小写不敏感）
- 推荐字体列表为前端硬编码常量，按平台区分
- 系统字体通过 Tauri 后端 `list_system_fonts` 命令获取

**推荐字体常量**（前端）：

```typescript
const RECOMMENDED_FONTS = {
  ui: ['Segoe UI Variable', 'Segoe UI', '微软雅黑', '思源黑体', 'PingFang SC'],
  editor: ['微软雅黑', '思源宋体', '思源黑体', 'Segoe UI Variable', 'Georgia'],
  code: ['Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', 'Source Code Pro'],
};
```

**字号步进器 (`FontSizeStepper`)**：

- 范围：10px ~ 32px
- 步长：1px
- 数字输入框可直接编辑，失焦时 clamp 到有效范围

### 3.6 系统字体检测（Rust 后端）

新增 Tauri 命令 `list_system_fonts`：

```rust
#[tauri::command]
async fn list_system_fonts() -> Result<Vec<String>, String> {
    // 使用 font-kit crate 的 SystemSource 枚举系统字体
    let source = font_kit::source::SystemSource::new();
    let families = source.all_families()
        .map_err(|e| format!("Failed to enumerate fonts: {e}"))?;

    // 去重 + 排序
    let mut unique: Vec<String> = families.into_iter().collect::<std::collections::BTreeSet<_>>().into_iter().collect();
    unique.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(unique)
}
```

**新增 Cargo 依赖**：`font-kit = "0.14"`

**前端调用时机**：设置对话框首次打开时调用一次，结果缓存到 `useSettingsStore` 的非持久化字段 `systemFonts: string[]`。

**浏览器降级**：非 Tauri 环境下 `list_system_fonts` 不可用，推荐字体列表仍正常显示，系统字体分组隐藏。

---

## 4. AI 服务增强

### 4.1 Provider 类型变更

```typescript
// 变更前
type AiProvider = 'openai' | 'ollama' | 'custom';

// 变更后
type AiProvider = 'openai' | 'anthropic' | 'custom';
```

**预设配置更新**：

```typescript
const PROVIDER_PRESETS: Record<AiProvider, Partial<AiProviderConfig>> = {
  openai:    { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com',  model: 'claude-sonnet-4-6' },
  custom:    { baseUrl: '', model: '' },
};
```

**默认初始化列表更新**：将原来的 `ollama` 默认项替换为 `anthropic`。

**向后兼容**：`initSettings` 加载持久化数据时，如果 `provider` 字段为 `'ollama'`，自动映射为 `'custom'`，保留其 baseUrl 和 model 不变。原 Ollama 用户的配置不会丢失，只是类型变为"自定义"。

### 4.2 代理设置

每个 AI 服务商独立配置代理：

```typescript
type ProxyMode = 'none' | 'system' | 'custom';

interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
  proxyMode: ProxyMode;   // 新增，默认 'none'
  proxyUrl?: string;       // proxyMode === 'custom' 时使用，如 'http://127.0.0.1:7890'
}
```

**UI 交互**：在 `AiProviderEditor` 编辑表单中，API Key 下方新增代理设置区域：

- 三选一单选按钮组：无代理 / 系统代理 / 自定义代理
- 选择"自定义代理"时展开 URL 输入框，placeholder 为 `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:1080`

**Rust 实现**：代理配置通过 `reqwest::Proxy` 应用：

```rust
let mut client_builder = reqwest::Client::builder();
match proxy_mode.as_str() {
    "system" => { /* reqwest 默认行为即读取系统代理 */ },
    "custom" => {
        if let Some(url) = proxy_url {
            client_builder = client_builder.proxy(reqwest::Proxy::all(url)?);
        }
    },
    _ => {
        client_builder = client_builder.no_proxy();
    },
}
```

### 4.3 AI 请求迁移到 Rust 后端

**动机**：浏览器 / Tauri webview 的 `fetch` 不支持自定义代理配置。迁移到 Rust 后端后还额外获得：API Key 不暴露在 webview 进程中、更好的错误处理和超时控制。

**新增 Tauri 命令**：

#### `ai_chat_stream`

通过 Tauri 的 `Channel` 机制实现流式传输：

```rust
#[tauri::command]
async fn ai_chat_stream(
    provider: String,          // "openai" | "anthropic" | "custom"
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    proxy_mode: String,        // "none" | "system" | "custom"
    proxy_url: Option<String>,
    on_event: tauri::ipc::Channel<StreamEvent>,
) -> Result<(), String> {
    // 1. 构建 reqwest::Client（含代理配置）
    // 2. 根据 provider 类型构建不同的请求体和头部
    //    - openai/custom: POST /chat/completions, Authorization: Bearer
    //    - anthropic: POST /v1/messages, x-api-key + anthropic-version
    // 3. 发送 SSE 流式请求
    // 4. 逐行解析 SSE，通过 on_event.send() 推送 token 到前端
}
```

**流事件类型**：

```rust
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "event", content = "data")]
enum StreamEvent {
    Token { content: String },
    Done { full_text: String },
    Error { message: String },
}
```

**前端调用方式**：

```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

type StreamEvent =
  | { event: 'token'; data: { content: string } }
  | { event: 'done'; data: { fullText: string } }
  | { event: 'error'; data: { message: string } };

const channel = new Channel<StreamEvent>();
channel.onmessage = (msg) => {
  switch (msg.event) {
    case 'token': onToken(msg.data.content); break;
    case 'done':  onDone(msg.data.fullText); break;
    case 'error': onError(new Error(msg.data.message)); break;
  }
};

await invoke('ai_chat_stream', {
  provider: config.provider,
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
  model: config.model,
  messages,
  proxyMode: config.proxyMode,
  proxyUrl: config.proxyUrl,
  onEvent: channel,
});
```

**`aiService.ts` 重构**：

- `streamChat` 函数内部检测 `isTauri()`：
  - Tauri 模式 → 调用 `invoke('ai_chat_stream', ...)`
  - 浏览器模式 → 保留现有 `fetch` 逻辑（降级，无代理支持）
- `testConnection` 同理改为 Tauri 优先

#### `ai_list_models`

从 baseUrl 拉取可用模型列表：

```rust
#[tauri::command]
async fn ai_list_models(
    provider: String,
    base_url: String,
    api_key: String,
    proxy_mode: String,
    proxy_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    // openai/custom: GET {base_url}/models → 解析 data[].id
    // anthropic: GET {base_url}/v1/models（需 x-api-key + anthropic-version 头）→ 解析 data[].id
    //   Anthropic /v1/models 支持分页（limit, before_id, after_id），默认返回 20 条
}

#[derive(serde::Serialize)]
struct ModelInfo {
    id: String,
    name: String,
}
```

**前端模型选择器**：

- `AiProviderEditor` 的模型字段从纯文本输入改为 combobox（可输入 + 下拉）
- 编辑表单中 baseUrl / apiKey 填写完成后，显示"拉取模型"按钮
- 点击后调用 `ai_list_models`，成功则展示下拉列表；用户也可自由输入模型名
- OpenAI、Anthropic、Custom 三种类型均通过各自的 `/models` 端点拉取
- 拉取失败时显示错误提示，不阻塞手动输入

### 4.4 Anthropic API 适配

Anthropic Messages API 与 OpenAI Chat Completions API 存在显著差异，需要在 Rust 层做协议转换：

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| 端点 | `POST {baseUrl}/chat/completions` | `POST {baseUrl}/v1/messages` |
| 认证头 | `Authorization: Bearer {key}` | `x-api-key: {key}` + `anthropic-version: 2023-06-01` |
| system prompt | 作为 `messages[0]` with `role: "system"` | 顶层 `system` 字段，不在 messages 中 |
| 流式格式 | `data: {"choices":[{"delta":{"content":"..."}}]}` | `event: content_block_delta` + `data: {"delta":{"text":"..."}}` |
| 结束信号 | `data: [DONE]` | `event: message_stop` |
| 最大 token | `max_tokens`（可选） | `max_tokens`（必填） |

**Anthropic `max_tokens` 处理**：Anthropic 要求 `max_tokens` 必填。Rust 层对 Anthropic 请求自动补充 `max_tokens: 4096`（若前端未指定）。

**Anthropic 消息交替**：直接调用 Anthropic API 时，连续同角色消息会被 API 自动合并（不再报错）。但为兼容 AWS Bedrock 等第三方端点，Rust 层仍预处理合并相邻同角色消息。

**Anthropic SSE 额外事件**：除 `content_block_delta` 和 `message_stop` 外，还需处理：
- `ping` — 心跳保活，忽略即可
- `error` — 服务端错误，立即终止流并通过 `StreamEvent::Error` 通知前端
- 解析 `content_block_delta` 时需检查 `delta.type === "text_delta"`（工具调用时为 `input_json_delta`，结构不同）

Rust 后端的 `ai_chat_stream` 根据 `provider` 参数分支处理请求构建和响应解析。

### 4.5 新增 Cargo 依赖

```toml
reqwest = { version = "0.13", default-features = false, features = [
  "json", "stream", "socks", "rustls-tls", "system-proxy"
] }
futures-util = "0.3"
```

- `stream`：启用 `Response::bytes_stream()` 用于 SSE 流式读取
- `socks`：启用 SOCKS4/SOCKS5 代理支持
- `system-proxy`：自动读取系统代理设置（Windows 注册表 / macOS 系统偏好设置 / 环境变量）
- `rustls-tls`：纯 Rust TLS 实现，避免依赖系统 OpenSSL
- `futures-util`：提供 `StreamExt` trait 用于迭代字节流

---

## 5. 数据模型变更

### 5.1 `PersistedSettings` 接口扩展

```typescript
interface FontConfig {
  fontFamily: string;
  fontSize: number;
}

interface PersistedSettings {
  // 现有字段（保持不变）
  aiConfigs: AiProviderConfig[];
  activeAiConfigId: string | null;
  plantUmlTheme?: string;
  plantUmlBackend?: PlantUmlBackend;
  editorColorMode?: EditorColorMode;
  editorThemeId?: EditorThemeId;
  codeBlockThemeId?: string;

  // 新增字体配置
  uiFontConfig?: FontConfig;
  editorFontConfig?: FontConfig;
  codeBlockFontConfig?: FontConfig;
}
```

所有新增字段均为可选（`?`），确保旧版 `settings.json` 兼容。缺失时使用默认值。

### 5.2 `AiProviderConfig` 接口扩展

```typescript
interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;    // 'openai' | 'anthropic' | 'custom'
  proxyMode: ProxyMode;   // 新增，默认 'none'
  proxyUrl?: string;       // 新增
}
```

### 5.3 `SettingsState` 接口扩展

```typescript
interface SettingsState {
  // 现有字段...

  // 新增字体
  uiFontConfig: FontConfig;
  editorFontConfig: FontConfig;
  codeBlockFontConfig: FontConfig;
  systemFonts: string[];  // 非持久化，运行时缓存

  // 新增 actions
  setUiFontConfig: (config: FontConfig) => void;
  setEditorFontConfig: (config: FontConfig) => void;
  setCodeBlockFontConfig: (config: FontConfig) => void;
  loadSystemFonts: () => Promise<void>;
}
```

### 5.4 默认值常量

```typescript
const DEFAULT_UI_FONT: FontConfig = {
  fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontSize: 16,
};

const DEFAULT_EDITOR_FONT: FontConfig = {
  fontFamily: 'inherit',  // 继承 UI 字体
  fontSize: 16,
};

const DEFAULT_CODE_FONT: FontConfig = {
  fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  fontSize: 14,
};
```

### 5.5 向后兼容与数据迁移

| 场景 | 处理方式 |
|------|---------|
| 旧 `settings.json` 无字体字段 | 使用默认值，无感知 |
| 旧 `settings.json` 中 `provider: 'ollama'` | `initSettings` 时映射为 `'custom'`，保留 baseUrl/model |
| 旧 `settings.json` 中 `AiProviderConfig` 无 `proxyMode` 字段 | 缺失时默认 `'none'` |
| `tabs` 中包含 `SETTINGS_TAB_ID` | 水合时自动过滤 |

---

## 6. `App.tsx` 变更

### 6.1 设置对话框挂载

```tsx
// App.tsx return 中，在最外层 div 末尾添加：
<SettingsDialog
  open={settingsDialogOpen}
  onClose={closeSettingsDialog}
/>
```

### 6.2 快捷键变更

```typescript
// 原来
} else if (e.key === ',') {
  e.preventDefault();
  useAppStore.getState().openSettingsTab();
}

// 改为
} else if (e.key === ',') {
  e.preventDefault();
  useAppStore.getState().toggleSettingsDialog();
}
```

### 6.3 字体 CSS 变量注入

在 `App` 组件中新增 `useEffect`，订阅 `useSettingsStore` 中的三组字体配置，动态更新 `:root` CSS 变量。

### 6.4 移除 SETTINGS_TAB_ID 条件渲染

`App.tsx` 中删除 `activeTabId === SETTINGS_TAB_ID` 的条件分支和对 `SettingsPanel` 的导入。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| AI 请求迁移到 Rust 可能破坏现有聊天功能 | 高 | `aiService.ts` 保留 `fetch` 降级路径；新旧并行测试 |
| `font-kit` 在 macOS 上枚举 CJK 字体耗时 3-5 秒 | 中 | 异步执行 + 结果缓存；设置对话框打开时 loading 态（Windows DirectWrite 后端无此问题） |
| Anthropic API 格式差异导致流式解析错误 | 中 | 独立的 Anthropic SSE 解析器 + 充分的单元测试 |
| CSS 变量注入导致样式闪烁（FOUC） | 低 | `App.css` 中 `:root` 保留 fallback 值；变量在水合前即注入 |
| `reqwest` 增加二进制体积 | 低 | `reqwest` 已是 Tauri 生态常用依赖，增量约 1-2 MB |
| Milkdown Crepe 无 `--crepe-font-size` 变量 | 中 | 通过 CSS 选择器覆盖（`.milkdown .ProseMirror`），已在 3.4 节定义方案 |

### 7.1 补充约束

- **`Sidebar.tsx` 变更**：齿轮图标的 `onClick` 从 `openSettingsTab()` 改为 `toggleSettingsDialog()`。
- **`AiPanel.tsx` 变更**：`sendMessage` 回调从直接调用 `streamChat`（前端 fetch）改为调用重构后的 `streamChat`（内部根据 `isTauri()` 分派）。调用签名不变，变更对 `AiPanel` 透明。
- **`settingsDialogOpen` 不持久化**：此状态不加入 `PersistedAppSlice`，应用重启时设置对话框默认关闭。
- **`settingsCategory` 不持久化**：分类选中状态仅在会话内保持，重启后默认选中"外观"。
- **ESC 键优先级**：当设置对话框打开时，ESC 应关闭对话框而非关闭右侧面板。需在 `App.tsx` 的 `handleKeyDown` 中增加优先级判断。

---

## 8. 测试策略

| 层面 | 测试内容 |
|------|---------|
| **Rust 单元测试** | `list_system_fonts` 返回非空列表；`ai_chat_stream` 对 OpenAI / Anthropic 格式的 SSE mock 解析正确 |
| **前端单元测试** | `FontPicker` 过滤逻辑；`FontSizeStepper` clamp 行为；`SettingsState` 的字体 actions 和持久化 |
| **集成测试** | 设置对话框打开/关闭/ESC/遮罩点击；字体变更后 CSS 变量更新；`initSettings` 的向后兼容迁移 |
| **手动验证** | 字体变更实时预览；代理设置后 AI 聊天正常；Anthropic 流式回复完整 |

---

## 9. 五维度审核（经官方 API + 工程代码逐条验证）

### 可行性

| 技术点 | 结论 | 验证依据 |
|--------|------|----------|
| `font-kit` 系统字体枚举 | **可行** | v0.14.3，`SystemSource::new().all_families()` → Windows DirectWrite 无额外配置，返回 `Result<Vec<String>, SelectionError>`。Windows 无性能问题；macOS CJK 字体可能 3-5 秒（已在风险表缓解） |
| `reqwest` 代理支持 | **可行** | v0.13.4 确认。`system-proxy` 为默认 feature；`Proxy::all()` 支持 `socks5://`（需 `socks` feature）；`.no_proxy()` 禁用全部代理检测。文档原文："Clear all Proxies…also disables automatic usage of system proxy" |
| Tauri `Channel<T>` 流式传输 | **可行** | `Channel<TSend>` 实现 `CommandArg`，可直接作为命令参数。`send()` 需 `TSend: IpcResponse` bound（Serialize 类型自动满足）。官方示例使用 `#[serde(tag = "event", content = "data")]` tagged enum，与本 spec 一致 |
| Anthropic API 适配 | **可行** | `POST /v1/messages`、`GET /v1/models` 端点均已验证存在。模型 ID 使用新格式（`claude-sonnet-4-6`，无日期后缀）。SSE 事件 `content_block_delta` / `message_stop` 确认；需额外处理 `ping` 和 `error` 事件 |
| CodeMirror Compartment 字体热更新 | **可行** | `EditorView.theme()` 接受 `fontFamily` / `fontSize` 用于 `.cm-content`（官方文档："editor does not expect a monospace font or a fixed line height"）。`Compartment.reconfigure()` 确认可运行时切换 |
| Milkdown Crepe CSS 变量字体 | **字体族可行，字号需 CSS 覆盖** | `--crepe-font-default` 存在且通过 DOM 继承可覆盖（官方 Issue #1839 确认）；`--crepe-font-code` 可控制代码块字体。但 **font-size 无 CSS 变量**（Issue #2315 仍 open），需通过 `.milkdown .ProseMirror` 选择器覆盖 |

### 完整性

| 检查项 | 状态 |
|--------|------|
| 所有用户需求覆盖（设置重构 + 字体 + 代理 + 模型拉取 + Anthropic） | ✓ |
| 向后兼容：ollama→custom 映射、缺失字段默认值、旧 tab 过滤 | ✓ |
| 受影响组件全覆盖：`Sidebar.tsx`（齿轮 onClick）、`AiPanel.tsx`（透明迁移）、`App.tsx`（ESC 优先级 + 条件渲染移除 + CSS 变量注入） | ✓ |
| `App.css` 4 处硬编码字体已列出迁移方案 | ✓ |
| `line-height` 与 font-size 耦合已通过 `--notez-ui-line-height` 变量解决 | ✓ |
| 浏览器降级路径（无 Tauri 时 fetch 降级、系统字体分组隐藏） | ✓ |
| Anthropic SSE 额外事件（`ping`、`error`、`delta.type` 检查） | ✓ |
| `settingsDialogOpen` / `settingsCategory` 不持久化 | ✓ |

### 一致性

| 检查项 | 状态 |
|--------|------|
| reqwest 版本与 crates.io 一致（0.13.4） | ✓ |
| Anthropic 模型 ID 与官方文档一致（`claude-sonnet-4-6`，无日期后缀） | ✓ — 经第二轮验证修正 |
| Anthropic `/v1/models` 端点存在且非 beta | ✓ |
| `StreamEvent` serde 属性与 Tauri 官方示例一致（`rename_all_fields`） | ✓ — 经第二轮验证修正 |
| 默认 UI font-size 与 `App.css` `:root` 一致（16px） | ✓ — 经第二轮验证修正（原为 14px） |
| `AiProviderConfig` Rust/TypeScript 字段对齐 | ✓ |
| `PersistedAppSlice` 不含 `settingsDialogOpen` | ✓ — `partialize` 已过滤非文件标签 |

### 清晰性

- 每个变更点有"原来→重构后"对比表
- 关键代码含示例片段（Rust + TypeScript + CSS）
- ASCII 布局图展示对话框结构
- 数据迁移场景逐条列出
- Milkdown 字号限制明确说明了替代方案
- App.css 硬编码字体逐行标注了迁移目标

### 必要性（收益 / 代价）

| 子功能 | 收益 | 代价 | 判定 |
|--------|------|------|------|
| 设置界面重构为对话框 | 不占用编辑区标签页；可扩展分类；标准桌面体验 | ~400 行新组件代码；需测试迁移 | **必要** — 当前设置项将持续增长 |
| 三层字体设置 | 用户可定制阅读体验；代码块等宽字体独立控制 | CSS 变量注入复杂度；font-kit 依赖 ~1 MB；Milkdown 字号需 CSS 选择器覆盖 | **必要** — 桌面编辑器的基础体验 |
| AI 代理设置 | 中国用户可正常使用 OpenAI/Anthropic；解除网络限制 | AI 请求迁移到 Rust 增加复杂度 | **必要** — 目标用户的核心痛点 |
| AI 请求迁移到 Rust | API Key 不暴露在 webview；启用代理能力；更好的超时/错误处理 | reqwest 依赖增加 ~2 MB；两套 SSE 解析器（OpenAI + Anthropic） | **必要** — 代理功能的前置条件 |
| Anthropic 支持 | 扩展 AI 服务商选择；Claude 模型质量高 | 独立协议适配层（请求构建 + SSE 解析 + 额外事件处理） | **值得** — 增量代价可控 |
| 去掉 Ollama 类型 | 简化类型系统 | Ollama 用户需知变更为 custom | **可接受** — Ollama 兼容 OpenAI 协议，custom 类型完全覆盖 |
