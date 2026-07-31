# 自动保存开关与未保存提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置「编辑器」中增加默认关闭的自动保存；关 dirty tab / 退出应用时用应用内三按钮（保存 | 不保存 | 取消）统一决策。

**Architecture:** `autoSaveEnabled` 进 `useSettingsStore`；`hasPersistablePath` + `autoSaveController` 门控 `App` debounce；`SavePromptHost`/`promptSaveChanges` 提供命令式三选一；`resolveUnsavedTabs` 按 `tab.content` 顺序保存；`confirmAndCloseTabs` 与 `onCloseRequested`/`beforeunload` 共用该决策。

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, `@tauri-apps/api` window `onCloseRequested`, 现有 `saveMarkdownFileTauri` / `showMessage`

**Spec 文档:** `docs/superpowers/specs/2026-07-31-auto-save-unsaved-prompt-design.md`

## Global Constraints

- `autoSaveEnabled` 默认 **`false`**；旧 settings 缺字段 → `false`
- 自动保存：**仅 Tauri** + 开关开 + `hasPersistablePath`；禁止浏览器「假 clean」
- 无 path / `path === title`：**不**自动保存；用户「保存」路径可另存为
- 批量/退出保存正文必须用 **`tab.content`**，禁止 `tab.file.content`
- 三按钮：应用内 Host，不复用 `confirmAction`
- CloseRequested：abort → `preventDefault`；proceed → **不** prevent（不默认显式 `destroy`）
- debounce 保持约 **1000ms**；不做间隔可配置
- 进入关/退出决策前：`cancelPendingAutoSave()`（清 timer + bump generation）

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/utils/persistablePath.ts` | `hasPersistablePath` |
| `src/utils/__tests__/persistablePath.test.ts` | path 判定单测 |
| `src/utils/autoSaveController.ts` | timer + write generation；`cancelPendingAutoSave` / `scheduleAutoSave` |
| `src/utils/__tests__/autoSaveController.test.ts` | timer / generation 单测 |
| `src/components/SavePromptHost.tsx` | 三按钮 UI + 注册 bridge |
| `src/utils/savePrompt.ts` | `promptSaveChanges` / `SavePromptChoice` / host 注册 |
| `src/utils/__tests__/savePrompt.test.tsx` | Host + Promise 单测 |
| `src/utils/resolveUnsavedTabs.ts` | 文案 + 决策 + 按 `tab.content` 顺序保存 |
| `src/utils/__tests__/resolveUnsavedTabs.test.ts` | 决策单测 |
| `src/components/settings/EditorSettings.tsx` | 自动保存开关 UI |
| `src/store/__tests__/autoSaveSettings.test.ts` | settings 字段持久化 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/store/useSettingsStore.ts` | `autoSaveEnabled` + setter + persist + init |
| `src/components/settings/settingsTypes.ts` | `'editor'` |
| `src/components/settings/settingsLabels.ts` | 标签 |
| `src/components/settings/SettingsSidebar.tsx` | 侧栏项 |
| `src/components/settings/SettingsDialog.tsx` | 渲染 `EditorSettings` |
| `src/utils/confirmCloseTabs.ts` | 改用 `resolveUnsavedTabs` |
| `src/utils/__tests__/confirmCloseTabs.test.ts` | 重写 mock |
| `src/App.tsx` | 门控自动保存、挂 Host、CloseRequested、beforeunload |

### 不改动

| 文件 | 原因 |
|------|------|
| `src/utils/tabCloseTargets.ts` | 关闭目标算法不变 |
| `src-tauri/capabilities/default.json` | 默认不显式 destroy |
| `src/utils/nativeDialog.ts` | 三按钮不走 ask；失败仍可用 `showMessage` |

---

### Task 1: `hasPersistablePath`

**Files:**
- Create: `src/utils/persistablePath.ts`
- Create: `src/utils/__tests__/persistablePath.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `export function hasPersistablePath(file: { path?: string; title: string }): boolean`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/persistablePath.test.ts
import { describe, expect, it } from 'vitest';
import { hasPersistablePath } from '../persistablePath';

describe('hasPersistablePath', () => {
  it('无 path → false', () => {
    expect(hasPersistablePath({ title: '无标题' })).toBe(false);
  });
  it('path === title → false（浏览器文件名占位）', () => {
    expect(hasPersistablePath({ title: 'a.md', path: 'a.md' })).toBe(false);
  });
  it('独立磁盘 path → true', () => {
    expect(hasPersistablePath({ title: 'a', path: 'D:\\notes\\a.md' })).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/utils/__tests__/persistablePath.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// src/utils/persistablePath.ts
/** 与 saveMarkdownFileTauri 另存为条件对齐：可直写磁盘时为 true */
export function hasPersistablePath(file: { path?: string; title: string }): boolean {
  const p = file.path;
  return Boolean(p && p !== file.title);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/utils/__tests__/persistablePath.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/persistablePath.ts src/utils/__tests__/persistablePath.test.ts
git commit -m "feat: add hasPersistablePath helper for auto-save gating"
```

---

### Task 2: `autoSaveController`

**Files:**
- Create: `src/utils/autoSaveController.ts`
- Create: `src/utils/__tests__/autoSaveController.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export function cancelPendingAutoSave(): void` — 清 timer + `writeGeneration++`
  - `export function scheduleAutoSave(fn: () => void | Promise<void>, delayMs?: number): void`
  - `export function beginAutoSaveWrite(): number` — 返回当前 generation
  - `export function isAutoSaveWriteCurrent(gen: number): boolean`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/autoSaveController.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginAutoSaveWrite,
  cancelPendingAutoSave,
  isAutoSaveWriteCurrent,
  scheduleAutoSave,
} from '../autoSaveController';

describe('autoSaveController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelPendingAutoSave();
  });
  afterEach(() => {
    cancelPendingAutoSave();
    vi.useRealTimers();
  });

  it('schedule 后 debounce 执行；cancel 后不执行', () => {
    const fn = vi.fn();
    scheduleAutoSave(fn, 1000);
    cancelPendingAutoSave();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel 使进行中 write generation 过期', () => {
    const gen = beginAutoSaveWrite();
    expect(isAutoSaveWriteCurrent(gen)).toBe(true);
    cancelPendingAutoSave();
    expect(isAutoSaveWriteCurrent(gen)).toBe(false);
  });

  it('后一次 schedule 取代前一次', () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleAutoSave(a, 1000);
    scheduleAutoSave(b, 1000);
    vi.advanceTimersByTime(1000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/utils/__tests__/autoSaveController.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// src/utils/autoSaveController.ts
let timer: ReturnType<typeof setTimeout> | null = null;
let writeGeneration = 0;

export function cancelPendingAutoSave(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  writeGeneration += 1;
}

export function scheduleAutoSave(
  fn: () => void | Promise<void>,
  delayMs = 1000,
): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void fn();
  }, delayMs);
}

export function beginAutoSaveWrite(): number {
  return writeGeneration;
}

export function isAutoSaveWriteCurrent(gen: number): boolean {
  return gen === writeGeneration;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/utils/__tests__/autoSaveController.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/autoSaveController.ts src/utils/__tests__/autoSaveController.test.ts
git commit -m "feat: add autoSaveController for timer and write generation"
```

---

### Task 3: settings `autoSaveEnabled`

**Files:**
- Modify: `src/store/useSettingsStore.ts`
- Create: `src/store/__tests__/autoSaveSettings.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `autoSaveEnabled: boolean`（默认 `false`）
  - `setAutoSaveEnabled(enabled: boolean): void`（立即 persist）
  - `PersistedSettings.autoSaveEnabled?: boolean`
  - `export function normalizeAutoSaveEnabled(raw: unknown): boolean` — 仅 `true` 为 true，其余 false

- [ ] **Step 1: 写失败测试**

```typescript
// src/store/__tests__/autoSaveSettings.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  normalizeAutoSaveEnabled,
  useSettingsStore,
  type PersistedSettings,
} from '../useSettingsStore';

const LS_KEY = 'notez-settings';

describe('normalizeAutoSaveEnabled', () => {
  it('仅 true 为 true', () => {
    expect(normalizeAutoSaveEnabled(true)).toBe(true);
    expect(normalizeAutoSaveEnabled(false)).toBe(false);
    expect(normalizeAutoSaveEnabled(undefined)).toBe(false);
    expect(normalizeAutoSaveEnabled('true')).toBe(false);
    expect(normalizeAutoSaveEnabled(1)).toBe(false);
  });
});

describe('autoSaveEnabled 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ loaded: false, autoSaveEnabled: false });
  });

  it('默认 false', () => {
    expect(useSettingsStore.getState().autoSaveEnabled).toBe(false);
  });

  it('setAutoSaveEnabled(true) 写入载荷', () => {
    useSettingsStore.getState().setAutoSaveEnabled(true);
    const data = JSON.parse(localStorage.getItem(LS_KEY)!) as PersistedSettings;
    expect(data.autoSaveEnabled).toBe(true);
  });

  it('initSettings 缺字段 → false', async () => {
    const configs = useSettingsStore.getState().aiConfigs;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ aiConfigs: configs, activeAiConfigId: null } satisfies PersistedSettings),
    );
    useSettingsStore.setState({ autoSaveEnabled: true, loaded: false });
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().autoSaveEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/store/__tests__/autoSaveSettings.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现 store 变更**

在 `useSettingsStore.ts`：

1. 导出 `normalizeAutoSaveEnabled`：
```typescript
export function normalizeAutoSaveEnabled(raw: unknown): boolean {
  return raw === true;
}
```
2. `PersistedSettings` 增加 `autoSaveEnabled?: boolean`
3. `SettingsState` 增加 `autoSaveEnabled: boolean` 与 `setAutoSaveEnabled`
4. 初始值 `autoSaveEnabled: false`
5. `setAutoSaveEnabled: (enabled) => { set({ autoSaveEnabled: enabled }); persist(get()); }`
6. `persist()` 写入 `autoSaveEnabled: state.autoSaveEnabled`
7. `initSettings`：`autoSaveEnabled: normalizeAutoSaveEnabled(saved.autoSaveEnabled)`

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/store/__tests__/autoSaveSettings.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/useSettingsStore.ts src/store/__tests__/autoSaveSettings.test.ts
git commit -m "feat: persist autoSaveEnabled setting (default false)"
```

---

### Task 4: 设置「编辑器」分类 UI

**Files:**
- Modify: `src/components/settings/settingsTypes.ts`
- Modify: `src/components/settings/settingsLabels.ts`
- Modify: `src/components/settings/SettingsSidebar.tsx`
- Modify: `src/components/settings/SettingsDialog.tsx`
- Create: `src/components/settings/EditorSettings.tsx`

**Interfaces:**
- Consumes: `useSettingsStore.autoSaveEnabled` / `setAutoSaveEnabled`
- Produces: `SettingsCategory` 含 `'editor'`；`EditorSettings` 组件

- [ ] **Step 1: 扩展类型与标签**

```typescript
// settingsTypes.ts
export type SettingsCategory = 'appearance' | 'editor' | 'ai' | 'plantuml' | 'about';

// settingsLabels.ts — CATEGORY_LABELS.editor = '编辑器'
```

- [ ] **Step 2: Sidebar 增加项**（`appearance` 与 `ai` 之间；图标用 `lucide-react` 的 `Pencil` 或 `FilePen`）

```typescript
{ id: 'editor', label: '编辑器', icon: <Pencil size={16} /> },
```

- [ ] **Step 3: 实现 EditorSettings**

```tsx
// src/components/settings/EditorSettings.tsx
import { useSettingsStore } from '../../store/useSettingsStore';

export function EditorSettings() {
  const autoSaveEnabled = useSettingsStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useSettingsStore((s) => s.setAutoSaveEnabled);

  return (
    <div>
      <label className="flex items-start gap-2.5 mb-4 cursor-pointer max-w-md">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={autoSaveEnabled}
          onChange={(e) => setAutoSaveEnabled(e.target.checked)}
        />
        <span>
          <span className="block text-xs text-gray-700">自动保存</span>
          <span className="block text-[10px] text-gray-400 mt-1 leading-snug">
            开启后，桌面端已保存到磁盘的文件在编辑停顿约 1 秒后自动写入。新建未命名文件不会自动保存。浏览器预览模式下此选项不生效。
          </span>
        </span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: SettingsDialog 分支**

```tsx
{category === 'editor' && <EditorSettings />}
```

- [ ] **Step 5: 手工快速确认** — `npm run dev` 打开设置可见「编辑器」与开关（可选；无自动化要求）

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/
git commit -m "feat: add Editor settings category with auto-save toggle"
```

---

### Task 5: `promptSaveChanges` + `SavePromptHost`

**Files:**
- Create: `src/utils/savePrompt.ts`
- Create: `src/components/SavePromptHost.tsx`
- Create: `src/utils/__tests__/savePrompt.test.tsx`

**Interfaces:**
- Consumes: React
- Produces:
  - `export type SavePromptChoice = 'save' | 'discard' | 'cancel'`
  - `export function promptSaveChanges(message: string): Promise<SavePromptChoice>`
  - `export function registerSavePromptHandler(handler: ((msg: string) => Promise<SavePromptChoice>) | null): void`
  - `export function SavePromptHost(): JSX.Element`（从 components 导出）

**约定：** Host 未注册时 `promptSaveChanges` resolve `'cancel'`（安全默认，并单测）。

- [ ] **Step 1: 写失败测试**（用 `@testing-library/react`；若项目无 RTL，用 vitest + 手动 register mock handler 测 bridge，Host 用轻量渲染）

先测 bridge（可不挂真实 DOM）：

```typescript
// src/utils/__tests__/savePrompt.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { promptSaveChanges, registerSavePromptHandler } from '../savePrompt';

describe('promptSaveChanges', () => {
  beforeEach(() => registerSavePromptHandler(null));

  it('未注册 handler → cancel', async () => {
    await expect(promptSaveChanges('x')).resolves.toBe('cancel');
  });

  it('委托已注册 handler', async () => {
    registerSavePromptHandler(async () => 'save');
    await expect(promptSaveChanges('msg')).resolves.toBe('save');
  });

  it('排队：前一个未完成时后一个等待', async () => {
    let resolveFirst!: (c: 'save' | 'discard' | 'cancel') => void;
    registerSavePromptHandler(
      () => new Promise((r) => { resolveFirst = r; }),
    );
    // 重新注册会覆盖；改为内部队列测试：
    // 实现必须保证同一 handler 串行。此处用可控 handler：
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    registerSavePromptHandler(async (msg) => {
      calls.push(msg);
      if (msg === '1') await gate;
      return 'discard';
    });
    const p1 = promptSaveChanges('1');
    const p2 = promptSaveChanges('2');
    expect(calls).toEqual(['1']);
    release();
    await expect(p1).resolves.toBe('discard');
    await expect(p2).resolves.toBe('discard');
    expect(calls).toEqual(['1', '2']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/utils/__tests__/savePrompt.test.tsx`  
Expected: FAIL

- [ ] **Step 3: 实现 `savePrompt.ts`**

```typescript
// src/utils/savePrompt.ts
export type SavePromptChoice = 'save' | 'discard' | 'cancel';

type Handler = (message: string) => Promise<SavePromptChoice>;

let handler: Handler | null = null;
let chain: Promise<void> = Promise.resolve();

export function registerSavePromptHandler(next: Handler | null): void {
  handler = next;
}

export function promptSaveChanges(message: string): Promise<SavePromptChoice> {
  const run = async (): Promise<SavePromptChoice> => {
    if (!handler) return 'cancel';
    return handler(message);
  };
  const result = chain.then(run, run);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
```

- [ ] **Step 4: 实现 `SavePromptHost.tsx`**

- `useEffect` 注册 handler：打开 state `{ message, resolve }`；卸载时 `registerSavePromptHandler(null)`
- UI：`fixed inset-0 z-[60]` 遮罩；面板文案 + 三按钮「保存」「不保存」「取消」
- Esc / 点遮罩 → `resolve('cancel')`
- 按钮文案固定中文

示意结构：

```tsx
export function SavePromptHost() {
  const [open, setOpen] = useState<{ message: string; resolve: (c: SavePromptChoice) => void } | null>(null);

  useEffect(() => {
    registerSavePromptHandler((message) =>
      new Promise<SavePromptChoice>((resolve) => {
        setOpen({ message, resolve });
      }),
    );
    return () => registerSavePromptHandler(null);
  }, []);

  const finish = (choice: SavePromptChoice) => {
    open?.resolve(choice);
    setOpen(null);
  };

  if (!open) return null;
  // ... modal with open.message, buttons calling finish('save'|'discard'|'cancel')
}
```

注意：队列在 `promptSaveChanges`；Host handler 每次 `setOpen` 一次。前一次 `finish` 后 `setOpen(null)`，下一次 Promise 再 `setOpen`。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/utils/__tests__/savePrompt.test.tsx`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/savePrompt.ts src/components/SavePromptHost.tsx src/utils/__tests__/savePrompt.test.tsx
git commit -m "feat: add SavePromptHost and promptSaveChanges bridge"
```

---

### Task 6: `resolveUnsavedTabs`

**Files:**
- Create: `src/utils/resolveUnsavedTabs.ts`
- Create: `src/utils/__tests__/resolveUnsavedTabs.test.ts`

**Interfaces:**
- Consumes: `promptSaveChanges`, `cancelPendingAutoSave`, `saveMarkdownFileTauri`, `showMessage`, `useAppStore.getState().updateTabFile`, `FileEditorTab`
- Produces:
  - `export function buildUnsavedPromptMessage(dirtyTabs: FileEditorTab[]): string`
  - `export async function resolveUnsavedTabs(dirtyTabs: FileEditorTab[]): Promise<'proceed' | 'abort'>`

行为：
1. `cancelPendingAutoSave()`
2. `dirtyTabs.length === 0` → `'proceed'`
3. `promptSaveChanges(buildUnsavedPromptMessage(...))`
4. `'cancel'` → `'abort'`
5. `'discard'` → `'proceed'`
6. `'save'`：对每个 tab 顺序 `saveMarkdownFileTauri({ ...tab.file }, tab.content)`；`null` 或 throw → `showMessage` + `'abort'`（已成功的已 `updateTabFile` clean）；成功则 `updateTabFile(id, { ...file, content: tab.content, path: savedPath ?? file.path, isDirty: false })`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/resolveUnsavedTabs.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type FileEditorTab } from '../../store/useAppStore';
import { buildUnsavedPromptMessage, resolveUnsavedTabs } from '../resolveUnsavedTabs';

vi.mock('../savePrompt', () => ({ promptSaveChanges: vi.fn() }));
vi.mock('../autoSaveController', () => ({ cancelPendingAutoSave: vi.fn() }));
vi.mock('../nativeDialog', () => ({ showMessage: vi.fn() }));
vi.mock('../../components/FileOperations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/FileOperations')>();
  return { ...actual, saveMarkdownFileTauri: vi.fn() };
});

import { promptSaveChanges } from '../savePrompt';
import { cancelPendingAutoSave } from '../autoSaveController';
import { saveMarkdownFileTauri } from '../../components/FileOperations';

function dirtyTab(id: string, content: string, path?: string): FileEditorTab {
  return {
    kind: 'file',
    id,
    content,
    file: {
      id: `f-${id}`,
      title: id,
      content: 'STALE',
      path,
      isDirty: true,
    },
  };
}

describe('buildUnsavedPromptMessage', () => {
  it('单文件含标题', () => {
    expect(buildUnsavedPromptMessage([dirtyTab('笔记', 'x')])).toContain('「笔记」');
  });
  it('多文件含 N', () => {
    expect(buildUnsavedPromptMessage([dirtyTab('a', '1'), dirtyTab('b', '2')])).toContain('2');
  });
});

describe('resolveUnsavedTabs', () => {
  beforeEach(() => {
    vi.mocked(promptSaveChanges).mockReset();
    vi.mocked(saveMarkdownFileTauri).mockReset();
    useAppStore.setState({
      tabs: [dirtyTab('a', 'BODY-A', 'D:\\a.md')],
      activeTabId: 'a',
      currentFile: dirtyTab('a', 'BODY-A', 'D:\\a.md').file,
      content: 'BODY-A',
    });
  });

  it('无 dirty → proceed 且 cancelPending', async () => {
    await expect(resolveUnsavedTabs([])).resolves.toBe('proceed');
    expect(cancelPendingAutoSave).toHaveBeenCalled();
    expect(promptSaveChanges).not.toHaveBeenCalled();
  });

  it('cancel → abort', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('cancel');
    await expect(resolveUnsavedTabs([dirtyTab('a', 'BODY-A', 'D:\\a.md')])).resolves.toBe('abort');
  });

  it('discard → proceed 不保存', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('discard');
    await expect(resolveUnsavedTabs([dirtyTab('a', 'BODY-A', 'D:\\a.md')])).resolves.toBe('proceed');
    expect(saveMarkdownFileTauri).not.toHaveBeenCalled();
  });

  it('save 使用 tab.content 非 file.content', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('save');
    vi.mocked(saveMarkdownFileTauri).mockResolvedValue('D:\\a.md');
    const tab = dirtyTab('a', 'BODY-A', 'D:\\a.md');
    await expect(resolveUnsavedTabs([tab])).resolves.toBe('proceed');
    expect(saveMarkdownFileTauri).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'a' }),
      'BODY-A',
    );
    expect(useAppStore.getState().tabs[0].file.isDirty).toBe(false);
  });

  it('save 取消另存为 → abort', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('save');
    vi.mocked(saveMarkdownFileTauri).mockResolvedValue(null);
    await expect(resolveUnsavedTabs([dirtyTab('a', 'BODY')])).resolves.toBe('abort');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/utils/__tests__/resolveUnsavedTabs.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现 `resolveUnsavedTabs.ts`**（完整逻辑按 Interfaces；`buildUnsavedPromptMessage`：单 → `` `「${title}」有未保存的更改。是否保存？` ``；多 → `` `有 ${n} 个标签有未保存的更改。是否全部保存？` ``）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/utils/__tests__/resolveUnsavedTabs.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/resolveUnsavedTabs.ts src/utils/__tests__/resolveUnsavedTabs.test.ts
git commit -m "feat: add resolveUnsavedTabs save/discard/cancel flow"
```

---

### Task 7: 接入 `confirmAndCloseTabs`

**Files:**
- Modify: `src/utils/confirmCloseTabs.ts`
- Modify: `src/utils/__tests__/confirmCloseTabs.test.ts`

**Interfaces:**
- Consumes: `resolveUnsavedTabs`, `getCloseTargetIds`, `countDirtyInTargets`, `isFileTab`
- Produces: 同名 `confirmAndCloseTabs` 行为变更

- [ ] **Step 1: 改写 `confirmCloseTabs.ts`**

```typescript
import { isFileTab, useAppStore } from '../store/useAppStore';
import { resolveUnsavedTabs } from './resolveUnsavedTabs';
import { countDirtyInTargets, getCloseTargetIds, type TabCloseAction } from './tabCloseTargets';

export async function confirmAndCloseTabs(
  action: TabCloseAction,
  anchorId: string,
): Promise<void> {
  const { tabs } = useAppStore.getState();
  const targetIds = getCloseTargetIds(tabs, action, anchorId);
  if (action !== 'all' && targetIds.length === 0) return;

  const idSet = new Set(targetIds);
  const dirtyTabs = tabs.filter(
    (t) => idSet.has(t.id) && isFileTab(t) && t.file.isDirty,
  );

  if (dirtyTabs.length > 0 || countDirtyInTargets(tabs, targetIds) > 0) {
    const result = await resolveUnsavedTabs(dirtyTabs);
    if (result === 'abort') return;
  }

  const state = useAppStore.getState();
  if (action !== 'all' && !state.tabs.some((t) => t.id === anchorId)) {
    return;
  }

  switch (action) {
    case 'close':
      state.closeTab(anchorId);
      break;
    case 'others':
      state.closeOtherTabs(anchorId);
      break;
    case 'left':
      state.closeTabsToLeft(anchorId);
      break;
    case 'right':
      state.closeTabsToRight(anchorId);
      break;
    case 'all':
      state.closeAllTabs();
      break;
  }
}
```

简化：`if (dirtyTabs.length > 0) { if (await resolveUnsavedTabs(dirtyTabs) === 'abort') return; }` 即可（`resolveUnsavedTabs([])` 也会 cancelPending，可在无 dirty 时也调用一次以清 timer——推荐无 dirty 时仍 `cancelPendingAutoSave()` 一次，或总是 `await resolveUnsavedTabs(dirtyTabs)`）。

**推荐最终形态：**

```typescript
const result = await resolveUnsavedTabs(dirtyTabs);
if (result === 'abort') return;
```

（空数组 → proceed + cancelPending）

- [ ] **Step 2: 重写测试** — mock `resolveUnsavedTabs` 而非 `confirmAction`；覆盖：abort 不关；proceed 关；无 dirty 关；锚点消失 no-op；all 换新标签

- [ ] **Step 3: 运行**

Run: `npx vitest run src/utils/__tests__/confirmCloseTabs.test.ts`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/utils/confirmCloseTabs.ts src/utils/__tests__/confirmCloseTabs.test.ts
git commit -m "feat: route tab close through resolveUnsavedTabs"
```

---

### Task 8: 门控 `App.tsx` 自动保存 + 挂载 Host

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useSettingsStore.autoSaveEnabled`, `hasPersistablePath`, `autoSaveController`, `SavePromptHost`, `isTauri`

- [ ] **Step 1: 渲染树加入 `<SavePromptHost />`**（与 `SettingsDialog` 同级）

- [ ] **Step 2: 替换自动保存 effect**

逻辑要点：

```typescript
const autoSaveEnabled = useSettingsStore((s) => s.autoSaveEnabled);

useEffect(() => {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || !isFileTab(activeTab)) return;
  if (!isTauri()) return;
  if (!autoSaveEnabled) return;
  if (!currentFile.isDirty) return;
  if (!hasPersistablePath(currentFile)) return;

  scheduleAutoSave(async () => {
    const gen = beginAutoSaveWrite();
    const file = fileRef.current;
    const tabId = activeTabIdRef.current;
    const c = contentRef.current;
    if (!file.isDirty || !hasPersistablePath(file)) return;
    const st = useAppStore.getState();
    const tNow = st.tabs.find((x) => x.id === tabId);
    if (!tNow || !isFileTab(tNow)) return;
    try {
      const savedPath = await saveMarkdownFileTauri(file, c);
      if (!isAutoSaveWriteCurrent(gen)) return;
      if (!useAppStore.getState().tabs.some((t) => t.id === tabId)) return;
      if (savedPath) {
        updateTabFile(tabId, { ...file, content: c, isDirty: false, path: savedPath });
        refreshFileTree();
      }
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, 1000);

  return () => {
    // 仅清 timer，不要 bump generation（避免切 tab 误伤进行中写盘）
    // 因此 scheduleAutoSave 的 cleanup 需要「只 clearTimeout」API
  };
}, [content, currentFile.isDirty, currentFile.path, currentFile.title, activeTabId, tabs, autoSaveEnabled, updateTabFile]);
```

**重要：** Task 2 的 `cancelPendingAutoSave` 会 bump generation。effect cleanup **不应**调用完整 `cancelPendingAutoSave`（否则每次 content 变化 cleanup 会作废进行中写盘）。扩展 `autoSaveController`：

```typescript
export function clearAutoSaveTimerOnly(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
```

- effect cleanup → `clearAutoSaveTimerOnly()`
- `resolveUnsavedTabs` / 关退出 → `cancelPendingAutoSave()`（清 timer + bump）

若 Task 2 已提交，本 Task 追加 `clearAutoSaveTimerOnly` + 单测一行，同 commit 或先小 commit。

- [ ] **Step 3: 删除浏览器「just mark clean」分支**

- [ ] **Step 4: Ctrl+S 路径保持手动保存；可选在手动保存前 `clearAutoSaveTimerOnly()`**

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/utils/autoSaveController.ts src/utils/__tests__/autoSaveController.test.ts
git commit -m "feat: gate auto-save on setting, Tauri, and persistable path"
```

---

### Task 9: 退出拦截（CloseRequested + beforeunload）

**Files:**
- Modify: `src/App.tsx`（或新建 `src/hooks/useUnsavedExitGuard.ts` 再在 App 调用——推荐抽 hook 保持 App 瘦）

**Interfaces:**
- Consumes: `resolveUnsavedTabs`, `isFileTab`, `useAppStore`, `isTauri`
- Produces: 副作用 hook

- [ ] **Step 1: 实现 `useUnsavedExitGuard`**

```typescript
// src/hooks/useUnsavedExitGuard.ts
import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isFileTab, useAppStore } from '../store/useAppStore';
import { isTauri } from '../components/FileOperations';
import { resolveUnsavedTabs } from '../utils/resolveUnsavedTabs';

export function useUnsavedExitGuard(): void {
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isTauri()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        const dirty = useAppStore.getState().tabs.some(
          (t) => isFileTab(t) && t.file.isDirty,
        );
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }

    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (inFlight.current) {
          event.preventDefault();
          return;
        }
        const dirtyTabs = useAppStore
          .getState()
          .tabs.filter((t) => isFileTab(t) && t.file.isDirty);
        if (dirtyTabs.length === 0) return;

        inFlight.current = true;
        try {
          const result = await resolveUnsavedTabs(dirtyTabs);
          if (result === 'abort') {
            event.preventDefault();
          }
          // proceed: do not preventDefault → Tauri destroys
        } finally {
          inFlight.current = false;
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);
}
```

- [ ] **Step 2: 在 `App` 调用 `useUnsavedExitGuard()`**

- [ ] **Step 3: 手工验证清单（桌面 `npm run tauri dev`）**

1. 设置默认关；编辑已落盘文件不停顿落盘
2. 打开自动保存；停顿约 1s 落盘；无标题不落盘、不弹另存为
3. 关 dirty tab：三按钮；保存 / 不保存 / 取消
4. 关全部 / Ctrl+W
5. 点窗口关闭：有 dirty 弹三按钮；取消留下；不保存退出
6. 保存失败（只读等）不退出

- [ ] **Step 4: 跑相关单测全集**

Run: `npx vitest run src/utils/__tests__/persistablePath.test.ts src/utils/__tests__/autoSaveController.test.ts src/store/__tests__/autoSaveSettings.test.ts src/utils/__tests__/savePrompt.test.tsx src/utils/__tests__/resolveUnsavedTabs.test.ts src/utils/__tests__/confirmCloseTabs.test.ts`  
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUnsavedExitGuard.ts src/App.tsx
git commit -m "feat: intercept window close for unsaved tabs"
```

---

## Spec 覆盖自检

| Spec 要求 | Task |
|-----------|------|
| `autoSaveEnabled` 默认 false + persist | 3 |
| 「编辑器」分类 + 开关文案 | 4 |
| 仅 Tauri 自动保存；无假 clean | 8 |
| `hasPersistablePath` 跳过自动保存 | 1, 8 |
| 三按钮 Host + Promise | 5 |
| `tab.content` 顺序保存 | 6 |
| `confirmAndCloseTabs` 接入 | 7 |
| CloseRequested 正确时序 + in-flight | 9 |
| beforeunload | 9 |
| 关/退出前 cancelPendingAutoSave | 6（经 resolve） |
| generation 忽略过期写回 | 2, 8 |
| 不显式 destroy / 不动 capabilities | 9 |

**Placeholder 扫描：** 无 TBD；`clearAutoSaveTimerOnly` 在 Task 8 明确追加。

**类型一致性：** `SavePromptChoice` / `resolveUnsavedTabs` → `'proceed' \| 'abort'` / `hasPersistablePath` 命名跨 Task 一致。
