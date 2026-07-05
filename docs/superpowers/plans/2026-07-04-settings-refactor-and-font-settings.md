# 设置界面重构 + 字体设置 + AI 服务增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置面板从标签页重构为模态对话框，新增三层字体配置和 AI 服务增强（代理 + Anthropic + 模型拉取）。

**Architecture:** 设置 UI 拆分为 `src/components/settings/` 下的独立组件，通过 `SettingsDialog` 容器统一管理。字体检测和 AI 请求迁移到 Rust 后端（`font-kit` + `reqwest`），通过 Tauri IPC Channel 与前端通信。数据模型扩展 `useSettingsStore`，向后兼容旧 `settings.json`。

**Tech Stack:** React 19, TypeScript, Zustand, Tauri v2, CodeMirror 6 (Compartment), Milkdown Crepe (CSS Variables), Rust (`font-kit`, `reqwest`, `futures-util`), `@tauri-apps/api/core` (Channel)

**Spec 文档:** `docs/superpowers/specs/2026-07-04-settings-refactor-and-font-settings.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/components/settings/SettingsDialog.tsx` | 对话框容器（遮罩 + 居中面板 + ESC 关闭 + 左右两栏） |
| `src/components/settings/SettingsSidebar.tsx` | 左侧分类导航 |
| `src/components/settings/AppearanceSettings.tsx` | 外观分类（主题 + 字体） |
| `src/components/settings/AiSettings.tsx` | AI 服务商列表（增删改查 + 测试） |
| `src/components/settings/AiProviderEditor.tsx` | 单个服务商编辑表单（含代理 + 模型拉取） |
| `src/components/settings/PlantUmlSettings.tsx` | PlantUML 引擎 + 主题 |
| `src/components/settings/FontPicker.tsx` | 字体选择器（分组下拉 + 搜索） |
| `src/components/settings/FontSizeStepper.tsx` | 字号步进器 |
| `src/components/settings/settingsTypes.ts` | 设置相关类型定义（`SettingsCategory`、`FontConfig` 等） |
| `src/constants/fontDefaults.ts` | 字体默认值和推荐列表常量 |
| `src-tauri/src/ai_service.rs` | Rust AI 请求（流式 + 模型列表 + 代理） |
| `src-tauri/src/font_service.rs` | Rust 系统字体枚举 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/store/useSettingsStore.ts` | 扩展 `AiProvider` / `AiProviderConfig` / `PersistedSettings` / `SettingsState`，新增字体 actions |
| `src/store/useAppStore.ts` | 新增 `settingsDialogOpen` 状态，移除 `SETTINGS_TAB_ID` 逻辑 |
| `src/App.tsx` | 挂载 `SettingsDialog`，移除旧条件渲染，新增字体 CSS 变量注入 |
| `src/App.css` | `:root` 改用 CSS 变量，4 处硬编码字体迁移 |
| `src/components/Sidebar.tsx` | 齿轮图标改为调用 `toggleSettingsDialog()` |
| `src/components/aiService.ts` | `streamChat` / `testConnection` 增加 Tauri Channel 路径 |
| `src/components/MarkdownEditor.tsx` | 新增 `fontCompartment` 用于字体热更新 |
| `src/components/WysiwygEditor.tsx` | 容器 div 注入 Crepe CSS 变量 |
| `src-tauri/Cargo.toml` | 新增 `font-kit`、`reqwest`、`futures-util` 依赖 |
| `src-tauri/src/lib.rs` | 注册新 Tauri 命令 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src/components/SettingsPanel.tsx` | 逻辑已拆分到 `settings/` 子组件 |

---

## Phase 1: 设置对话框框架

### Task 1: 类型定义和常量

**Files:**
- Create: `src/components/settings/settingsTypes.ts`
- Create: `src/constants/fontDefaults.ts`

- [ ] **Step 1: 创建设置类型定义**

```typescript
// src/components/settings/settingsTypes.ts
export type SettingsCategory = 'appearance' | 'ai' | 'plantuml';

export interface FontConfig {
  fontFamily: string;
  fontSize: number;
}
```

- [ ] **Step 2: 创建字体默认值和推荐列表**

```typescript
// src/constants/fontDefaults.ts
import type { FontConfig } from '../components/settings/settingsTypes';

export const DEFAULT_UI_FONT: FontConfig = {
  fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontSize: 16,
};

export const DEFAULT_EDITOR_FONT: FontConfig = {
  fontFamily: 'inherit',
  fontSize: 16,
};

export const DEFAULT_CODE_FONT: FontConfig = {
  fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  fontSize: 14,
};

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;

export const RECOMMENDED_FONTS = {
  ui: ['Segoe UI Variable', 'Segoe UI', '微软雅黑', '思源黑体', 'PingFang SC'],
  editor: ['微软雅黑', '思源宋体', '思源黑体', 'Segoe UI Variable', 'Georgia'],
  code: ['Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', 'Source Code Pro'],
} as const;
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/settingsTypes.ts src/constants/fontDefaults.ts
git commit -m "feat(settings): add type definitions and font default constants"
```

---

### Task 2: useAppStore 状态迁移

**Files:**
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: 新增 settingsDialogOpen 状态和 actions**

在 `src/store/useAppStore.ts` 的 `AppState` interface 中新增：

```typescript
settingsDialogOpen: boolean;
openSettingsDialog: () => void;
closeSettingsDialog: () => void;
toggleSettingsDialog: () => void;
```

在 store 创建中添加实现：

```typescript
settingsDialogOpen: false,

openSettingsDialog: () => set({ settingsDialogOpen: true, activeView: 'editor' }),
closeSettingsDialog: () => set({ settingsDialogOpen: false }),
toggleSettingsDialog: () => set((s) => ({
  settingsDialogOpen: !s.settingsDialogOpen,
  ...(s.settingsDialogOpen ? {} : { activeView: 'editor' }),
})),
```

注意：`settingsDialogOpen` **不**加入 `PersistedAppSlice`。

- [ ] **Step 2: 保留 openSettingsTab 暂不删除**

暂时保留 `openSettingsTab` 和 `SETTINGS_TAB_ID` 不删——旧代码仍在引用。在 Task 5 完成 App.tsx 迁移后再统一删除。

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS（无新错误）

- [ ] **Step 4: Commit**

```bash
git add src/store/useAppStore.ts
git commit -m "feat(settings): add settingsDialogOpen state to useAppStore"
```

---

### Task 3: SettingsDialog 和 SettingsSidebar 组件

**Files:**
- Create: `src/components/settings/SettingsDialog.tsx`
- Create: `src/components/settings/SettingsSidebar.tsx`

- [ ] **Step 1: 创建 SettingsSidebar**

```typescript
// src/components/settings/SettingsSidebar.tsx
import { Monitor, Sparkles, FileCode } from 'lucide-react';
import type { SettingsCategory } from './settingsTypes';

const CATEGORIES: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <Monitor size={16} /> },
  { id: 'ai', label: 'AI 服务', icon: <Sparkles size={16} /> },
  { id: 'plantuml', label: 'PlantUML', icon: <FileCode size={16} /> },
];

interface Props {
  active: SettingsCategory;
  onChange: (cat: SettingsCategory) => void;
}

export function SettingsSidebar({ active, onChange }: Props) {
  return (
    <nav className="w-[180px] flex-shrink-0 border-r border-gray-200 bg-gray-50 py-3">
      <div className="px-4 mb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
        设置
      </div>
      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors ${
            active === cat.id
              ? 'bg-blue-50 text-blue-600 border-l-2 border-blue-500'
              : 'text-gray-600 hover:bg-gray-100 border-l-2 border-transparent'
          }`}
        >
          {cat.icon}
          {cat.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: 创建 SettingsDialog**

```typescript
// src/components/settings/SettingsDialog.tsx
import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { SettingsSidebar } from './SettingsSidebar';
import type { SettingsCategory } from './settingsTypes';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  const [category, setCategory] = useState<SettingsCategory>('appearance');

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-2xl flex overflow-hidden"
        style={{ width: 720, maxHeight: '80vh' }}>
        <SettingsSidebar active={category} onChange={setCategory} />
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-800">
              {category === 'appearance' ? '外观' : category === 'ai' ? 'AI 服务' : 'PlantUML'}
            </h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {/* Phase 1 占位：下个 Task 填入实际内容组件 */}
            <div className="text-xs text-gray-400">
              {category} settings placeholder
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/SettingsDialog.tsx src/components/settings/SettingsSidebar.tsx
git commit -m "feat(settings): create SettingsDialog and SettingsSidebar components"
```

---

### Task 4: 拆分设置子组件

**Files:**
- Create: `src/components/settings/AppearanceSettings.tsx`
- Create: `src/components/settings/AiSettings.tsx`
- Create: `src/components/settings/AiProviderEditor.tsx`
- Create: `src/components/settings/PlantUmlSettings.tsx`

- [ ] **Step 1: 创建 AppearanceSettings**

从 `SettingsPanel.tsx` 第 232-263 行提取编辑器外观设置（颜色模式、文档主题、代码块主题）。暂不含字体设置（Phase 2 添加）。

```typescript
// src/components/settings/AppearanceSettings.tsx
import { ChevronDown } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { EDITOR_COLOR_MODE_OPTIONS, EDITOR_THEME_OPTIONS } from '../../constants/editorThemes';
import { CODE_BLOCK_THEME_OPTIONS } from '../../constants/codeBlockThemes';

function SettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs text-gray-500 mb-1.5">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="w-full max-w-xs px-2.5 py-1.5 border border-gray-200 rounded text-xs appearance-none pr-7 bg-white"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  const {
    editorColorMode, setEditorColorMode,
    editorThemeId, setEditorThemeId,
    codeBlockThemeId, setCodeBlockThemeId,
  } = useSettingsStore();

  return (
    <div>
      <SettingsSelect
        label="外观模式"
        value={editorColorMode}
        options={EDITOR_COLOR_MODE_OPTIONS}
        onChange={setEditorColorMode}
      />
      <SettingsSelect
        label="文档主题"
        value={editorThemeId}
        options={EDITOR_THEME_OPTIONS}
        onChange={setEditorThemeId}
      />
      <p className="text-[10px] text-gray-400 -mt-2 mb-4 leading-snug">
        文档主题主要作用于全屏（WYSIWYG）模式；源码模式按外观模式切换浅色/深色。
      </p>
      <SettingsSelect
        label="代码块语法高亮"
        value={codeBlockThemeId}
        options={CODE_BLOCK_THEME_OPTIONS}
        onChange={setCodeBlockThemeId}
      />
      <p className="text-[10px] text-gray-400 -mt-2 mb-4 leading-snug">
        代码块语法主题与编辑器明/暗独立，可自由组合。
      </p>
      {/* 字体设置区域将在 Phase 2 Task 9 中添加 */}
    </div>
  );
}

export { SettingsSelect };
```

- [ ] **Step 2: 创建 PlantUmlSettings**

从 `SettingsPanel.tsx` 第 265-276 行提取。

```typescript
// src/components/settings/PlantUmlSettings.tsx
import { useSettingsStore } from '../../store/useSettingsStore';
import { SHOW_PLANTUML_BACKEND_SWITCH } from '../../constants/buildFlags';
import { DEFAULT_PLANTUML_THEME, PLANTUML_THEME_OPTIONS } from '../../constants/plantumlThemes';
import { SettingsSelect } from './AppearanceSettings';
import { ChevronDown } from 'lucide-react';

function PlantUmlBackendSwitch() {
  const { plantUmlBackend, setPlantUmlBackend } = useSettingsStore();
  return (
    <div className="mb-4">
      <label className="block text-xs text-gray-500 mb-1.5">渲染引擎</label>
      <div className="relative">
        <select
          value={plantUmlBackend}
          onChange={(e) => setPlantUmlBackend(e.target.value === 'rust' ? 'rust' : 'jar')}
          className="w-full max-w-xs px-2.5 py-1.5 border border-gray-200 rounded text-xs appearance-none pr-7 bg-white"
        >
          <option value="jar">JAR（随包 JVM，默认）</option>
          <option value="rust">Rust（实验性，序列图子集）</option>
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
        Rust 引擎不支持全部语法且不会自动回退到 JAR；出错时请切回 JAR 或查阅文档中的子集说明。
      </p>
    </div>
  );
}

export function PlantUmlSettings() {
  const { plantUmlTheme, setPlantUmlTheme } = useSettingsStore();
  const themeValue = PLANTUML_THEME_OPTIONS.some((o) => o.value === plantUmlTheme)
    ? plantUmlTheme
    : DEFAULT_PLANTUML_THEME;

  return (
    <div>
      {SHOW_PLANTUML_BACKEND_SWITCH && <PlantUmlBackendSwitch />}
      <SettingsSelect
        label="图表主题（图源中已写 !theme 时优先生效）"
        value={themeValue}
        options={PLANTUML_THEME_OPTIONS}
        onChange={setPlantUmlTheme}
      />
    </div>
  );
}
```

- [ ] **Step 3: 创建 AiSettings（初版，从 SettingsPanel 提取 AI 列表逻辑）**

从 `SettingsPanel.tsx` 第 98-230 行提取 AI 服务商列表 UI。此处先保留现有的 `AiProvider` 类型（`openai | ollama | custom`），Phase 3 再改。`AiProviderEditor` 也先使用现有的 inline modal 逻辑。

```typescript
// src/components/settings/AiSettings.tsx
import { useState } from 'react';
import { Plus, Trash2, Wifi, CheckCircle, XCircle } from 'lucide-react';
import { useSettingsStore, type AiProviderConfig, type AiProvider } from '../../store/useSettingsStore';
import { testConnection } from '../aiService';
import { AiProviderEditor } from './AiProviderEditor';

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama (本地)',
  custom: '自定义',
};

function generateId() {
  return `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface TestState {
  id: string;
  status: 'testing' | 'ok' | 'fail';
  message: string;
}

export function AiSettings() {
  const {
    aiConfigs, activeAiConfigId,
    upsertAiConfig, deleteAiConfig, setActiveAiConfigId,
  } = useSettingsStore();

  const [editing, setEditing] = useState<AiProviderConfig | null>(null);
  const [testState, setTestState] = useState<TestState | null>(null);

  const handleNew = () => {
    setEditing({
      id: generateId(), name: '新服务商',
      baseUrl: '', apiKey: '', model: '', provider: 'custom',
    });
  };

  const handleTest = async (cfg: AiProviderConfig) => {
    setTestState({ id: cfg.id, status: 'testing', message: '测试中…' });
    const result = await testConnection(cfg);
    setTestState({ id: cfg.id, status: result.ok ? 'ok' : 'fail', message: result.message });
  };

  const handleSave = (cfg: AiProviderConfig) => {
    upsertAiConfig(cfg);
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-700">服务商列表</span>
        <button
          onClick={handleNew}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          <Plus size={12} /> 添加
        </button>
      </div>

      <div className="space-y-2">
        {aiConfigs.map((cfg) => {
          const isActive = cfg.id === activeAiConfigId || (!activeAiConfigId && aiConfigs[0]?.id === cfg.id);
          const ts = testState?.id === cfg.id ? testState : null;
          return (
            <div
              key={cfg.id}
              className={`p-2.5 rounded border text-xs ${
                isActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <input type="radio" checked={isActive} onChange={() => setActiveAiConfigId(cfg.id)} className="w-3 h-3 flex-shrink-0" />
                  <span className="font-medium truncate">{cfg.name}</span>
                  <span className="text-gray-400 flex-shrink-0">({PROVIDER_LABELS[cfg.provider]})</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleTest(cfg)} title="测试连接" className="p-0.5 text-gray-400 hover:text-blue-600" disabled={ts?.status === 'testing'}>
                    <Wifi size={12} />
                  </button>
                  <button onClick={() => setEditing({ ...cfg })} className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 rounded">编辑</button>
                  <button onClick={() => deleteAiConfig(cfg.id)} className="p-0.5 text-gray-400 hover:text-red-500">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="text-gray-400 truncate">{cfg.baseUrl}</div>
              <div className="text-gray-400">模型: {cfg.model || '未设置'}</div>
              {ts && (
                <div className={`flex items-center gap-1 mt-1 ${ts.status === 'ok' ? 'text-green-600' : ts.status === 'fail' ? 'text-red-500' : 'text-gray-400'}`}>
                  {ts.status === 'ok' ? <CheckCircle size={10} /> : ts.status === 'fail' ? <XCircle size={10} /> : null}
                  {ts.message}
                </div>
              )}
            </div>
          );
        })}
        {aiConfigs.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-6">暂无服务商，点击「添加」</div>
        )}
      </div>

      {editing && (
        <AiProviderEditor
          config={editing}
          isNew={!aiConfigs.find((c) => c.id === editing.id)}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onTest={handleTest}
          testState={testState?.id === editing.id ? testState : null}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 创建 AiProviderEditor（初版，从 SettingsPanel 提取编辑弹窗）**

```typescript
// src/components/settings/AiProviderEditor.tsx
import { useState } from 'react';
import { Wifi, CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import type { AiProviderConfig, AiProvider } from '../../store/useSettingsStore';

const PROVIDER_PRESETS: Record<AiProvider, Partial<AiProviderConfig>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ollama: { baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'llama3.2' },
  custom: { baseUrl: '', model: '' },
};

interface TestState { id: string; status: 'testing' | 'ok' | 'fail'; message: string; }

interface Props {
  config: AiProviderConfig;
  isNew: boolean;
  onSave: (cfg: AiProviderConfig) => void;
  onCancel: () => void;
  onTest: (cfg: AiProviderConfig) => void;
  testState: TestState | null;
}

export function AiProviderEditor({ config, isNew, onSave, onCancel, onTest, testState }: Props) {
  const [editing, setEditing] = useState(config);

  const handleProviderChange = (provider: AiProvider) => {
    const preset = PROVIDER_PRESETS[provider];
    setEditing({ ...editing, provider, ...preset });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl w-80 p-4">
        <h3 className="text-sm font-semibold mb-3">{isNew ? '添加服务商' : '编辑服务商'}</h3>
        <div className="space-y-2.5 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">类型</label>
            <div className="relative">
              <select value={editing.provider} onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                className="w-full px-2 py-1.5 border rounded text-sm appearance-none pr-6">
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (本地)</option>
                <option value="custom">自定义</option>
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">名称</label>
            <input className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400"
              value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="例如: My OpenAI" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL</label>
            <input className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400 font-mono"
              value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">API Key</label>
            <input type="password" className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400 font-mono"
              value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              placeholder={editing.provider === 'ollama' ? 'ollama' : 'sk-...'} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">模型</label>
            <input className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400"
              value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              placeholder={editing.provider === 'ollama' ? 'llama3.2' : 'gpt-4o-mini'} />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onTest(editing)} className="px-3 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200 flex items-center gap-1">
            <Wifi size={11} /> 测试
          </button>
          <div className="flex-1" />
          <button onClick={onCancel} className="px-3 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200">取消</button>
          <button onClick={() => onSave(editing)} className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">保存</button>
        </div>
        {testState && (
          <div className={`mt-2 text-xs flex items-center gap-1 ${testState.status === 'ok' ? 'text-green-600' : testState.status === 'fail' ? 'text-red-500' : 'text-gray-400'}`}>
            {testState.status === 'ok' ? <CheckCircle size={11} /> : testState.status === 'fail' ? <XCircle size={11} /> : null}
            {testState.message}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AppearanceSettings.tsx src/components/settings/AiSettings.tsx src/components/settings/AiProviderEditor.tsx src/components/settings/PlantUmlSettings.tsx
git commit -m "feat(settings): extract appearance, AI, and PlantUML sub-components"
```

---

### Task 5: 接入 SettingsDialog，切换 App.tsx

**Files:**
- Modify: `src/components/settings/SettingsDialog.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/store/useAppStore.ts`
- Delete: `src/components/SettingsPanel.tsx`

- [ ] **Step 1: SettingsDialog 接入子组件**

更新 `SettingsDialog.tsx` 的内容区域，替换 placeholder：

```typescript
// 在 SettingsDialog.tsx 顶部新增 import
import { AppearanceSettings } from './AppearanceSettings';
import { AiSettings } from './AiSettings';
import { PlantUmlSettings } from './PlantUmlSettings';

// 替换 placeholder div
<div className="flex-1 overflow-y-auto p-5">
  {category === 'appearance' && <AppearanceSettings />}
  {category === 'ai' && <AiSettings />}
  {category === 'plantuml' && <PlantUmlSettings />}
</div>
```

- [ ] **Step 2: 更新 App.tsx**

在 `App.tsx` 中：
1. 新增 `SettingsDialog` 导入和挂载
2. 移除 `SettingsPanel` 导入和条件渲染
3. 快捷键从 `openSettingsTab()` 改为 `toggleSettingsDialog()`
4. ESC 处理增加设置对话框优先级

```typescript
// 导入变更
import { SettingsDialog } from './components/settings/SettingsDialog';
// 移除: import { SettingsPanel } from './components/SettingsPanel';
// 移除: import { SETTINGS_TAB_ID } from './store/useAppStore';
// 保留: import { useAppStore, isFileTab } from './store/useAppStore';

// 在 App 组件中解构新状态
const { settingsDialogOpen, closeSettingsDialog } = useAppStore();

// ESC 键处理变更（handleKeyDown 内）
if (e.key === 'Escape') {
  const { settingsDialogOpen, closeSettingsDialog, rightPanel, setRightPanel } = useAppStore.getState();
  if (settingsDialogOpen) {
    closeSettingsDialog();
    e.preventDefault();
  } else if (rightPanel) {
    setRightPanel(null);
    e.preventDefault();
  }
  return;
}

// Ctrl+, 变更
} else if (e.key === ',') {
  e.preventDefault();
  useAppStore.getState().toggleSettingsDialog();
}

// 移除主内容区的 SETTINGS_TAB_ID 条件分支
// 原来的:
// {activeTabId === SETTINGS_TAB_ID ? (
//   <div className="..."><SettingsPanel /></div>
// ) : (
//   <MarkdownEditor ... />
// )}
// 改为直接渲染 MarkdownEditor:
<MarkdownEditor
  key={activeTabId}
  content={content}
  onChange={(c) => useAppStore.getState().setContent(c)}
/>

// 在 return 的最外层 div 末尾添加
<SettingsDialog open={settingsDialogOpen} onClose={closeSettingsDialog} />
```

- [ ] **Step 3: 更新 Sidebar.tsx**

将齿轮图标的 `onClick` 从 `openSettingsTab()` 改为 `toggleSettingsDialog()`：

```typescript
// 在 Sidebar.tsx 的 handleClick 函数中
// 原来:
} else if (item.id === 'settings') {
  openSettingsTab();
  if (activeView === 'board') setActiveView('editor');

// 改为:
} else if (item.id === 'settings') {
  toggleSettingsDialog();
}
```

同时更新解构：从 `useAppStore` 解构 `toggleSettingsDialog` 替代 `openSettingsTab`。

- [ ] **Step 4: 清理 useAppStore 中的 SETTINGS_TAB_ID 相关代码**

在 `useAppStore.ts` 中：
1. 移除 `openSettingsTab` action
2. 保留 `SETTINGS_TAB_ID` 常量导出（`TabBar` 或其他组件可能仍在引用，如果没有则也删除）
3. 在 `partialize` 中确认设置标签已被过滤（如已有 `filter(isFileTab)` 则无需改动）

- [ ] **Step 5: 删除旧 SettingsPanel.tsx**

```bash
rm src/components/SettingsPanel.tsx
```

- [ ] **Step 6: 验证编译和手动测试**

Run: `npx tsc --noEmit`
Expected: PASS

手动验证：
- `Ctrl+,` 打开/关闭设置对话框
- 齿轮图标点击打开设置对话框
- ESC 关闭对话框
- 点击遮罩关闭对话框
- 三个分类导航可切换
- 原有设置项（颜色模式、主题、AI 配置、PlantUML）功能正常

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): replace tab-based SettingsPanel with modal SettingsDialog

- Settings now open as a centered modal dialog with sidebar navigation
- Three categories: Appearance, AI Service, PlantUML
- Ctrl+, and gear icon toggle the dialog
- ESC closes dialog (priority over panel close)
- Removed SETTINGS_TAB_ID tab-based approach
- Deleted SettingsPanel.tsx, logic split into settings/ sub-components"
```

---

## Phase 2: 字体设置

### Task 6: useSettingsStore 字体扩展

**Files:**
- Modify: `src/store/useSettingsStore.ts`

- [ ] **Step 1: 新增字体相关类型和字段**

在 `useSettingsStore.ts` 中：

1. 导入 `FontConfig` 类型和默认值
2. 扩展 `PersistedSettings`（新增 3 个可选字段）
3. 扩展 `SettingsState`（新增 3 个字体配置 + `systemFonts` + actions）
4. 扩展 `persist` 函数
5. 扩展 `initSettings` 反序列化逻辑

```typescript
// 在文件顶部新增导入
import type { FontConfig } from '../components/settings/settingsTypes';
import { DEFAULT_UI_FONT, DEFAULT_EDITOR_FONT, DEFAULT_CODE_FONT } from '../constants/fontDefaults';

// PersistedSettings 新增字段
uiFontConfig?: FontConfig;
editorFontConfig?: FontConfig;
codeBlockFontConfig?: FontConfig;

// SettingsState 新增字段和 actions
uiFontConfig: FontConfig;
editorFontConfig: FontConfig;
codeBlockFontConfig: FontConfig;
systemFonts: string[];

setUiFontConfig: (config: FontConfig) => void;
setEditorFontConfig: (config: FontConfig) => void;
setCodeBlockFontConfig: (config: FontConfig) => void;
loadSystemFonts: () => Promise<void>;

// store 初始值
uiFontConfig: DEFAULT_UI_FONT,
editorFontConfig: DEFAULT_EDITOR_FONT,
codeBlockFontConfig: DEFAULT_CODE_FONT,
systemFonts: [],

// actions 实现
setUiFontConfig: (config) => { set({ uiFontConfig: config }); persist(get()); },
setEditorFontConfig: (config) => { set({ editorFontConfig: config }); persist(get()); },
setCodeBlockFontConfig: (config) => { set({ codeBlockFontConfig: config }); persist(get()); },

loadSystemFonts: async () => {
  if (get().systemFonts.length > 0) return;
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const fonts = await invoke<string[]>('list_system_fonts');
    set({ systemFonts: fonts });
  } catch (err) {
    console.error('Failed to load system fonts:', err);
  }
},

// persist 函数新增字段
uiFontConfig: state.uiFontConfig,
editorFontConfig: state.editorFontConfig,
codeBlockFontConfig: state.codeBlockFontConfig,

// initSettings 反序列化新增
uiFontConfig: saved.uiFontConfig ?? DEFAULT_UI_FONT,
editorFontConfig: saved.editorFontConfig ?? DEFAULT_EDITOR_FONT,
codeBlockFontConfig: saved.codeBlockFontConfig ?? DEFAULT_CODE_FONT,
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/useSettingsStore.ts
git commit -m "feat(settings): extend store with font config fields and actions"
```

---

### Task 7: CSS 变量注入

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: App.tsx 新增字体 CSS 变量注入 useEffect**

```typescript
// App.tsx 中新增
const uiFontConfig = useSettingsStore((s) => s.uiFontConfig);
const editorFontConfig = useSettingsStore((s) => s.editorFontConfig);
const codeBlockFontConfig = useSettingsStore((s) => s.codeBlockFontConfig);

useEffect(() => {
  const root = document.documentElement;
  root.style.setProperty('--notez-ui-font-family', uiFontConfig.fontFamily);
  root.style.setProperty('--notez-ui-font-size', `${uiFontConfig.fontSize}px`);
  root.style.setProperty('--notez-ui-line-height', `${Math.round(uiFontConfig.fontSize * 1.5)}px`);
  root.style.setProperty('--notez-editor-font-family', editorFontConfig.fontFamily);
  root.style.setProperty('--notez-editor-font-size', `${editorFontConfig.fontSize}px`);
  root.style.setProperty('--notez-code-font-family', codeBlockFontConfig.fontFamily);
  root.style.setProperty('--notez-code-font-size', `${codeBlockFontConfig.fontSize}px`);
}, [uiFontConfig, editorFontConfig, codeBlockFontConfig]);
```

- [ ] **Step 2: App.css 迁移硬编码字体**

`:root` 改为：

```css
:root {
  font-family: var(--notez-ui-font-family, "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif);
  font-size: var(--notez-ui-font-size, 16px);
  line-height: var(--notez-ui-line-height, 24px);
  /* 其余不变 */
}
```

其他 3 处硬编码字体改为引用变量：
- `.diagram-tools-button-group button` → `font-family: var(--notez-ui-font-family);`
- `.notez-toast` → `font-family: var(--notez-ui-font-family);`
- `.plantuml-error__source` → `font-family: var(--notez-code-font-family);`

新增 Milkdown 字号覆盖规则：

```css
.wysiwyg-editor .milkdown .ProseMirror {
  font-size: var(--notez-editor-font-size, 16px);
}
.wysiwyg-editor .milkdown .ProseMirror pre code {
  font-size: var(--notez-code-font-size, 14px);
}
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(settings): inject font CSS variables from store to :root"
```

---

### Task 8: FontPicker 和 FontSizeStepper 组件

**Files:**
- Create: `src/components/settings/FontPicker.tsx`
- Create: `src/components/settings/FontSizeStepper.tsx`

- [ ] **Step 1: 创建 FontSizeStepper**

```typescript
// src/components/settings/FontSizeStepper.tsx
import { useState, useCallback } from 'react';
import { Minus, Plus } from 'lucide-react';
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../constants/fontDefaults';

interface Props {
  value: number;
  onChange: (size: number) => void;
}

function clampSize(v: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)));
}

export function FontSizeStepper({ value, onChange }: Props) {
  const [inputValue, setInputValue] = useState(String(value));

  const handleBlur = useCallback(() => {
    const n = parseInt(inputValue, 10);
    if (isNaN(n)) {
      setInputValue(String(value));
    } else {
      const clamped = clampSize(n);
      setInputValue(String(clamped));
      if (clamped !== value) onChange(clamped);
    }
  }, [inputValue, value, onChange]);

  const step = (delta: number) => {
    const next = clampSize(value + delta);
    setInputValue(String(next));
    onChange(next);
  };

  return (
    <div className="flex items-center border border-gray-200 rounded overflow-hidden">
      <button onClick={() => step(-1)} disabled={value <= FONT_SIZE_MIN}
        className="px-1.5 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 border-r border-gray-200">
        <Minus size={12} />
      </button>
      <input
        className="w-10 text-center text-xs py-1 outline-none bg-white"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') handleBlur(); }}
      />
      <button onClick={() => step(1)} disabled={value >= FONT_SIZE_MAX}
        className="px-1.5 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 border-l border-gray-200">
        <Plus size={12} />
      </button>
      <span className="text-[10px] text-gray-400 px-1">px</span>
    </div>
  );
}
```

- [ ] **Step 2: 创建 FontPicker**

```typescript
// src/components/settings/FontPicker.tsx
import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';

interface Props {
  value: string;
  onChange: (fontFamily: string) => void;
  recommended: readonly string[];
  systemFonts: string[];
}

export function FontPicker({ value, onChange, recommended, systemFonts }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const lowerSearch = search.toLowerCase();
  const filteredRecommended = useMemo(
    () => recommended.filter((f) => f.toLowerCase().includes(lowerSearch)),
    [recommended, lowerSearch],
  );
  const filteredSystem = useMemo(
    () => systemFonts
      .filter((f) => !recommended.includes(f))
      .filter((f) => f.toLowerCase().includes(lowerSearch)),
    [systemFonts, recommended, lowerSearch],
  );

  const displayName = value.replace(/^"(.*)".*$/, '$1').split(',')[0].trim().replace(/^["']|["']$/g, '');

  const select = (font: string) => {
    onChange(font);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 border border-gray-200 rounded text-xs bg-white hover:border-gray-300"
        style={{ fontFamily: value }}>
        <span className="truncate">{displayName}</span>
        <ChevronDown size={12} className="text-gray-400 flex-shrink-0 ml-1" />
      </button>

      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-50 rounded text-xs">
              <Search size={12} className="text-gray-400" />
              <input className="flex-1 bg-transparent outline-none" placeholder="搜索字体..."
                value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="overflow-y-auto">
            {filteredRecommended.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] text-blue-500 uppercase tracking-wider font-semibold">推荐</div>
                {filteredRecommended.map((f) => (
                  <button key={f} onClick={() => select(f)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${f === displayName ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
                    style={{ fontFamily: f }}>
                    {f}
                  </button>
                ))}
              </>
            )}
            {filteredSystem.length > 0 && (
              <>
                <div className="border-t border-gray-100 mx-2 my-1" />
                <div className="px-3 pt-1 pb-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">系统字体</div>
                {filteredSystem.map((f) => (
                  <button key={f} onClick={() => select(f)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${f === displayName ? 'bg-blue-50 text-blue-600' : 'text-gray-500'}`}
                    style={{ fontFamily: f }}>
                    {f}
                  </button>
                ))}
              </>
            )}
            {filteredRecommended.length === 0 && filteredSystem.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-4">无匹配字体</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/FontPicker.tsx src/components/settings/FontSizeStepper.tsx
git commit -m "feat(settings): create FontPicker and FontSizeStepper components"
```

---

### Task 9: 字体设置接入 AppearanceSettings

**Files:**
- Modify: `src/components/settings/AppearanceSettings.tsx`

- [ ] **Step 1: 在 AppearanceSettings 中添加字体设置区域**

在代码块语法主题下方添加字体设置区域，包含三组字体选择器（应用界面 / 编辑器 / 代码块），每组含 `FontPicker` + `FontSizeStepper`。

```typescript
// 新增导入
import { useSettingsStore } from '../../store/useSettingsStore';
import { FontPicker } from './FontPicker';
import { FontSizeStepper } from './FontSizeStepper';
import { RECOMMENDED_FONTS } from '../../constants/fontDefaults';
import { useEffect } from 'react';

// 在 AppearanceSettings 组件中，在代码块语法主题 p 标签之后添加：
const {
  uiFontConfig, setUiFontConfig,
  editorFontConfig, setEditorFontConfig,
  codeBlockFontConfig, setCodeBlockFontConfig,
  systemFonts, loadSystemFonts,
} = useSettingsStore();

useEffect(() => { loadSystemFonts(); }, [loadSystemFonts]);

// JSX：
<div className="border-t border-gray-200 pt-4 mt-4">
  <h3 className="text-xs font-semibold text-gray-700 mb-3">字体设置</h3>

  {/* 应用界面字体 */}
  <div className="mb-4">
    <label className="block text-xs text-gray-500 mb-1.5">应用界面字体</label>
    <div className="flex items-center gap-2">
      <div className="flex-1 max-w-[200px]">
        <FontPicker value={uiFontConfig.fontFamily} onChange={(f) => setUiFontConfig({ ...uiFontConfig, fontFamily: f })}
          recommended={RECOMMENDED_FONTS.ui} systemFonts={systemFonts} />
      </div>
      <FontSizeStepper value={uiFontConfig.fontSize} onChange={(s) => setUiFontConfig({ ...uiFontConfig, fontSize: s })} />
    </div>
  </div>

  {/* 编辑器字体 */}
  <div className="mb-4">
    <label className="block text-xs text-gray-500 mb-1.5">编辑器字体</label>
    <div className="flex items-center gap-2">
      <div className="flex-1 max-w-[200px]">
        <FontPicker value={editorFontConfig.fontFamily} onChange={(f) => setEditorFontConfig({ ...editorFontConfig, fontFamily: f })}
          recommended={RECOMMENDED_FONTS.editor} systemFonts={systemFonts} />
      </div>
      <FontSizeStepper value={editorFontConfig.fontSize} onChange={(s) => setEditorFontConfig({ ...editorFontConfig, fontSize: s })} />
    </div>
  </div>

  {/* 代码块字体 */}
  <div className="mb-4">
    <label className="block text-xs text-gray-500 mb-1.5">代码块字体</label>
    <div className="flex items-center gap-2">
      <div className="flex-1 max-w-[200px]">
        <FontPicker value={codeBlockFontConfig.fontFamily} onChange={(f) => setCodeBlockFontConfig({ ...codeBlockFontConfig, fontFamily: f })}
          recommended={RECOMMENDED_FONTS.code} systemFonts={systemFonts} />
      </div>
      <FontSizeStepper value={codeBlockFontConfig.fontSize} onChange={(s) => setCodeBlockFontConfig({ ...codeBlockFontConfig, fontSize: s })} />
    </div>
  </div>
</div>
```

- [ ] **Step 2: 验证编译和手动测试**

Run: `npx tsc --noEmit`
Expected: PASS

手动验证：打开设置 → 外观 → 字体设置区域显示三组选择器，变更后全局 UI 字体立即响应。

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/AppearanceSettings.tsx
git commit -m "feat(settings): wire font pickers into AppearanceSettings"
```

---

### Task 10: CodeMirror 字体 Compartment

**Files:**
- Modify: `src/components/MarkdownEditor.tsx`

- [ ] **Step 1: 新增 fontCompartment 和字体 Extension**

在 `MarkdownEditor.tsx` 中：

1. 新增 `fontCompartment = new Compartment()`
2. 在 `EditorState.create` 的 extensions 中加入 `fontCompartment.of(getFontExtension(...))`
3. 在现有的主题 `useEffect` 中追加字体 reconfigure

```typescript
// 新增导入
import { useSettingsStore } from '../store/useSettingsStore';

// 在组件中
const editorFontConfig = useSettingsStore((s) => s.editorFontConfig);
const codeBlockFontConfig = useSettingsStore((s) => s.codeBlockFontConfig);

// 新增 Compartment（模块级）
const fontCompartment = new Compartment();

function getFontExtension(editorFont: { fontFamily: string; fontSize: number }) {
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

// EditorState.create extensions 中追加
fontCompartment.of(getFontExtension(editorFontConfig)),

// useEffect 中追加 reconfigure
useEffect(() => {
  const view = viewRef.current;
  if (!view) return;
  view.dispatch({
    effects: [
      // 现有的主题 reconfigure...
      fontCompartment.reconfigure(getFontExtension(editorFontConfig)),
    ],
  });
}, [editorFontConfig]);
```

- [ ] **Step 2: 验证编译和手动测试**

Run: `npx tsc --noEmit`
Expected: PASS

手动验证：源码编辑模式下，变更编辑器字体后编辑器内容字体实时变化。

- [ ] **Step 3: Commit**

```bash
git add src/components/MarkdownEditor.tsx
git commit -m "feat(settings): add CodeMirror font compartment for live font updates"
```

---

### Task 11: Milkdown WYSIWYG 字体注入

**Files:**
- Modify: `src/components/WysiwygEditor.tsx`

- [ ] **Step 1: 注入 Crepe CSS 变量**

在 `WysiwygEditor.tsx` 的容器 div 上添加内联样式覆盖 Crepe CSS 变量：

```typescript
// 新增导入
import { useSettingsStore } from '../store/useSettingsStore';

// 在组件中
const editorFontConfig = useSettingsStore((s) => s.editorFontConfig);
const codeBlockFontConfig = useSettingsStore((s) => s.codeBlockFontConfig);

// 容器 div 添加 style
<div
  ref={containerRef}
  className="wysiwyg-editor h-full overflow-auto"
  style={{
    '--crepe-font-default': editorFontConfig.fontFamily,
    '--crepe-font-code': codeBlockFontConfig.fontFamily,
  } as React.CSSProperties}
>
```

- [ ] **Step 2: 验证编译和手动测试**

Run: `npx tsc --noEmit`
Expected: PASS

手动验证：WYSIWYG 模式下变更字体后正文和代码块字体实时变化。

- [ ] **Step 3: Commit**

```bash
git add src/components/WysiwygEditor.tsx
git commit -m "feat(settings): inject font CSS variables into Milkdown WYSIWYG editor"
```

---

### Task 12: Rust 系统字体枚举

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/font_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 添加 font-kit 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
font-kit = "0.14"
```

- [ ] **Step 2: 创建 font_service.rs**

```rust
// src-tauri/src/font_service.rs
use std::collections::BTreeSet;

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(|| {
        let source = font_kit::source::SystemSource::new();
        let families = source
            .all_families()
            .map_err(|e| format!("Failed to enumerate fonts: {e}"))?;

        let unique: BTreeSet<String> = families.into_iter().collect();
        let mut sorted: Vec<String> = unique.into_iter().collect();
        sorted.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        Ok(sorted)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}
```

- [ ] **Step 3: 在 lib.rs 中注册命令**

```rust
// 在 lib.rs 顶部新增
mod font_service;

// 在 invoke_handler 中新增
.invoke_handler(tauri::generate_handler![
    greet,
    plantuml_runtime::render_plantuml_local,
    plantuml_runtime::plantuml_runtime_available,
    font_service::list_system_fonts,
])
```

- [ ] **Step 4: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/font_service.rs src-tauri/src/lib.rs
git commit -m "feat(settings): add Rust list_system_fonts command using font-kit"
```

---

## Phase 3: AI 服务增强

### Task 13: AiProvider 类型变更

**Files:**
- Modify: `src/store/useSettingsStore.ts`
- Modify: `src/components/settings/AiProviderEditor.tsx`
- Modify: `src/components/settings/AiSettings.tsx`

- [ ] **Step 1: 更新 AiProvider 类型和接口**

在 `useSettingsStore.ts` 中：

```typescript
// 变更前
export type AiProvider = 'openai' | 'ollama' | 'custom';

// 变更后
export type AiProvider = 'openai' | 'anthropic' | 'custom';

export type ProxyMode = 'none' | 'system' | 'custom';

export interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
  proxyMode: ProxyMode;
  proxyUrl?: string;
}
```

更新 `DEFAULT_CONFIGS`（用 `anthropic` 替换 `ollama`）。

更新 `initSettings`：加载时将 `provider === 'ollama'` 映射为 `'custom'`，缺失 `proxyMode` 时默认 `'none'`。

- [ ] **Step 2: 更新 AiProviderEditor 和 AiSettings**

AiProviderEditor：
- 下拉选项从 `openai/ollama/custom` 改为 `openai/anthropic/custom`
- `PROVIDER_PRESETS` 更新（`anthropic` 项：`baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6'`）

AiSettings：
- `PROVIDER_LABELS` 更新（`anthropic: 'Anthropic'`，移除 `ollama`）

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/store/useSettingsStore.ts src/components/settings/AiProviderEditor.tsx src/components/settings/AiSettings.tsx
git commit -m "feat(ai): update provider types (replace ollama with anthropic, add proxy fields)"
```

---

### Task 14: AiProviderEditor 新增代理和模型拉取 UI

**Files:**
- Modify: `src/components/settings/AiProviderEditor.tsx`

- [ ] **Step 1: 在编辑表单中添加代理设置**

API Key 字段下方添加代理设置区域（三选一单选：无代理 / 系统代理 / 自定义代理），选择自定义时展开 URL 输入框。

- [ ] **Step 2: 模型字段改为 combobox + 拉取按钮**

模型输入框右侧添加"拉取模型"按钮，点击后调用 `ai_list_models`（Tauri）或显示预设列表。

- [ ] **Step 3: 验证编译和手动测试**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/AiProviderEditor.tsx
git commit -m "feat(ai): add proxy settings and model fetch UI to provider editor"
```

---

### Task 15: Rust AI 请求后端

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/ai_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 添加 Cargo 依赖**

```toml
reqwest = { version = "0.13", default-features = false, features = ["json", "stream", "socks", "rustls-tls", "system-proxy"] }
futures-util = "0.3"
```

- [ ] **Step 2: 创建 ai_service.rs**

实现 `ai_chat_stream` 和 `ai_list_models` 两个 Tauri 命令，含：
- `reqwest::Client` 构建（含代理配置）
- OpenAI / Anthropic SSE 解析分支
- `tauri::ipc::Channel<StreamEvent>` 流式传输
- `ModelInfo` 返回类型

具体代码参见 spec 第 4.3 / 4.4 节的 Rust 代码片段。

- [ ] **Step 3: 在 lib.rs 中注册命令**

```rust
mod ai_service;

// invoke_handler 新增
ai_service::ai_chat_stream,
ai_service::ai_list_models,
```

- [ ] **Step 4: Cargo check**

Run: `cd src-tauri && cargo check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/ai_service.rs src-tauri/src/lib.rs
git commit -m "feat(ai): add Rust AI service backend with proxy support and streaming"
```

---

### Task 16: 前端 aiService.ts 重构

**Files:**
- Modify: `src/components/aiService.ts`

- [ ] **Step 1: streamChat 增加 Tauri Channel 路径**

`streamChat` 函数内部检测 `isTauri()`：
- Tauri 模式 → 使用 `invoke('ai_chat_stream', ...)` + `Channel`
- 浏览器模式 → 保留现有 `fetch` 逻辑

`testConnection` 同理。

调用签名不变（`streamChat(config, messages, callbacks)`），对 `AiPanel.tsx` 透明。

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/aiService.ts
git commit -m "feat(ai): refactor aiService to use Tauri backend with proxy support"
```

---

### Task 17: 端到端验证和收尾

- [ ] **Step 1: 全量编译验证**

Run: `npx tsc --noEmit && cd src-tauri && cargo check`
Expected: 两个都 PASS

- [ ] **Step 2: 手动端到端测试**

检查清单：
- [ ] `Ctrl+,` 打开/关闭设置对话框
- [ ] 三个分类导航切换正常
- [ ] 外观设置：颜色模式、主题切换正常
- [ ] 字体设置：三组字体选择器显示，系统字体列表加载
- [ ] 字体变更后编辑器（源码 + WYSIWYG）立即响应
- [ ] AI 服务商：增删改查正常
- [ ] AI 服务商编辑：代理设置 UI 显示
- [ ] AI 服务商编辑：模型拉取按钮可用
- [ ] AI 聊天通过 Rust 后端正常工作
- [ ] 旧 settings.json 加载正常（向后兼容）

- [ ] **Step 3: 最终 commit**

```bash
git add -A
git commit -m "feat(settings): complete settings refactor with fonts and AI enhancements

Phase 1: Settings dialog (modal + sidebar navigation)
Phase 2: Three-layer font settings (UI/editor/code)
Phase 3: AI service (proxy, Anthropic, model fetch, Rust backend)"
```
