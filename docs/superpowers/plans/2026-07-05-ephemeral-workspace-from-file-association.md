# 文件关联打开 — 会话级临时工作区 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 OS 文件关联 / CLI / 二次实例打开 Markdown 时，自动以文件所在目录作为会话级临时工作区显示在文件树中，且不写入持久化 `workspaceDirs`。

**Architecture:** 在 `useAppStore` 新增不 persist 的 `ephemeralWorkspaceDirs` 及 actions；`src/utils/workspacePath.ts` 提供同步 path key 比较与异步 Tauri `normalize`/`dirname` 解析；`App.tsx` 的 `openFromPath` 在读盘成功后添加临时根；`FileExplorer` 合并渲染持久化根与 `visibleEphemeralDirs`（过滤与持久化同 key 的临时项）。

**Tech Stack:** React 19, TypeScript, Zustand persist, Vitest, Tauri v2 `@tauri-apps/api/path`, `@tauri-apps/plugin-fs`

**Spec 文档:** `docs/superpowers/specs/2026-07-05-ephemeral-workspace-from-file-association.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/utils/workspacePath.ts` | `workspacePathKey`、`isSameNormalizedPath`、`resolveWorkspaceDirFromFilePath` |
| `src/utils/__tests__/workspacePath.test.ts` | 路径 key 与 resolve 单测 |
| `src/store/__tests__/ephemeralWorkspace.test.ts` | ephemeral store actions 与 persist 隔离单测 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/store/useAppStore.ts` | `ephemeralWorkspaceDirs`、actions；`partialize` 不含该字段 |
| `src/App.tsx` | `openFromPath` 成功后 resolve + `addEphemeralWorkspaceDir` |
| `src/components/FileExplorer.tsx` | `visibleEphemeralDirs`、临时 UI、`TreeItem` active、`WorkspaceSection.ephemeral` |

### 不改动

| 文件 | 原因 |
|------|------|
| `src-tauri/src/lib.rs` | Spec：触发链路已完备 |
| `src-tauri/tauri.conf.json` | Spec：无需改 CLI / 文件关联 |

---

## Task 1: 路径工具 `workspacePath.ts`

**Files:**
- Create: `src/utils/workspacePath.ts`
- Create: `src/utils/__tests__/workspacePath.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/workspacePath.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isSameNormalizedPath,
  resolveWorkspaceDirFromFilePath,
  workspacePathKey,
} from '../workspacePath';

describe('workspacePathKey', () => {
  it('统一斜杠并去掉末尾斜杠', () => {
    expect(workspacePathKey('C:\\foo\\bar\\')).toBe('c:/foo/bar');
  });

  it('Windows 盘符路径大小写不敏感', () => {
    expect(workspacePathKey('D:\\Docs')).toBe('d:/docs');
    expect(isSameNormalizedPath('D:\\Docs', 'd:/docs')).toBe(true);
  });

  it('POSIX 路径保持大小写', () => {
    expect(workspacePathKey('/Home/User')).toBe('/Home/User');
    expect(isSameNormalizedPath('/Home/User', '/home/user')).toBe(false);
  });

  it('盘符根保留', () => {
    expect(workspacePathKey('C:\\')).toBe('c:');
  });
});

describe('resolveWorkspaceDirFromFilePath', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('normalize → dirname → normalize', async () => {
    vi.doMock('@tauri-apps/api/path', () => ({
      normalize: vi.fn(async (p: string) => p.replace(/\\/g, '/')),
      dirname: vi.fn(async (p: string) => {
        const i = p.lastIndexOf('/');
        return i >= 0 ? p.slice(0, i) : p;
      }),
    }));
    const { resolveWorkspaceDirFromFilePath: resolve } = await import('../workspacePath');
    const dir = await resolve('C:\\Docs\\note.md');
    expect(dir).toBe('C:/Docs');
  });

  it('失败返回 null', async () => {
    vi.doMock('@tauri-apps/api/path', () => ({
      normalize: vi.fn(async () => {
        throw new Error('fail');
      }),
      dirname: vi.fn(),
    }));
    const { resolveWorkspaceDirFromFilePath: resolve } = await import('../workspacePath');
    expect(await resolve('C:\\x\\a.md')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/utils/__tests__/workspacePath.test.ts`

Expected: FAIL — `Cannot find module '../workspacePath'`

- [ ] **Step 3: 实现 `workspacePath.ts`**

```typescript
// src/utils/workspacePath.ts

/** Windows 盘符或 UNC 路径 */
function isWindowsStylePath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(p) || /^[a-zA-Z]:$/.test(p) || p.startsWith('//');
}

/** 同步 path key：去重、active 高亮 */
export function workspacePathKey(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (isWindowsStylePath(path)) {
    p = p.toLowerCase();
  }
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

export function isSameNormalizedPath(a: string, b: string): boolean {
  return workspacePathKey(a) === workspacePathKey(b);
}

export async function resolveWorkspaceDirFromFilePath(
  filePath: string
): Promise<string | null> {
  try {
    const { dirname, normalize } = await import('@tauri-apps/api/path');
    const normalizedFile = await normalize(filePath);
    const parent = await dirname(normalizedFile);
    return await normalize(parent);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/utils/__tests__/workspacePath.test.ts`

Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/utils/workspacePath.ts src/utils/__tests__/workspacePath.test.ts
git commit -m "feat(workspace): add workspacePath utils for ephemeral roots"
```

---

## Task 2: Store — `ephemeralWorkspaceDirs` 与 actions

**Files:**
- Modify: `src/store/useAppStore.ts`
- Create: `src/store/__tests__/ephemeralWorkspace.test.ts`

- [ ] **Step 1: 写失败 store 测试**

```typescript
// src/store/__tests__/ephemeralWorkspace.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../useAppStore';
import { workspacePathKey } from '../../utils/workspacePath';

const LS_KEY = 'notez-app-state';

describe('ephemeral workspace store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      workspaceDirs: [],
      ephemeralWorkspaceDirs: [],
      fileTreeVersion: 0,
    });
  });

  it('addEphemeralWorkspaceDir 追加新目录并 bump fileTreeVersion', () => {
    useAppStore.getState().addEphemeralWorkspaceDir('C:/Docs');
    const s = useAppStore.getState();
    expect(s.ephemeralWorkspaceDirs).toEqual(['C:/Docs']);
    expect(s.fileTreeVersion).toBe(1);
  });

  it('重复 path key 不追加', () => {
    useAppStore.getState().addEphemeralWorkspaceDir('C:/Docs');
    useAppStore.getState().addEphemeralWorkspaceDir('c:\\docs');
    expect(useAppStore.getState().ephemeralWorkspaceDirs).toHaveLength(1);
    expect(useAppStore.getState().fileTreeVersion).toBe(1);
  });

  it('已在 workspaceDirs 中则 skip', () => {
    useAppStore.setState({ workspaceDirs: ['D:/Projects'] });
    useAppStore.getState().addEphemeralWorkspaceDir('d:/projects');
    expect(useAppStore.getState().ephemeralWorkspaceDirs).toEqual([]);
  });

  it('removeEphemeralWorkspaceDir 按 key 移除', () => {
    useAppStore.setState({ ephemeralWorkspaceDirs: ['C:/Docs'] });
    useAppStore.getState().removeEphemeralWorkspaceDir('c:\\docs');
    expect(useAppStore.getState().ephemeralWorkspaceDirs).toEqual([]);
  });

  it('remove 不影响 workspaceDirs', () => {
    useAppStore.setState({
      workspaceDirs: ['C:/Keep'],
      ephemeralWorkspaceDirs: ['C:/Temp'],
    });
    useAppStore.getState().removeEphemeralWorkspaceDir('C:/Temp');
    expect(useAppStore.getState().workspaceDirs).toEqual(['C:/Keep']);
  });

  it('persist 不含 ephemeralWorkspaceDirs', () => {
    useAppStore.getState().addEphemeralWorkspaceDir('C:/Docs');
    useAppStore.getState().setEditorMode('edit');
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state).not.toHaveProperty('ephemeralWorkspaceDirs');
    expect(parsed.state.workspaceDirs).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/store/__tests__/ephemeralWorkspace.test.ts`

Expected: FAIL — `addEphemeralWorkspaceDir is not a function`

- [ ] **Step 3: 修改 `useAppStore.ts`**

在 `AppState` interface 中 `workspaceDirs` 下方增加：

```typescript
/** 会话级临时工作区根（不 persist） */
ephemeralWorkspaceDirs: string[];
```

在 actions 区 `removeWorkspaceDir` 下方增加：

```typescript
addEphemeralWorkspaceDir: (dir: string) => void;
removeEphemeralWorkspaceDir: (dir: string) => void;
```

文件顶部 import：

```typescript
import { workspacePathKey } from '../utils/workspacePath';
```

初始 state（`workspaceDirs: []` 附近）：

```typescript
ephemeralWorkspaceDirs: [],
```

实现 actions（在 `removeWorkspaceDir` 之后）：

```typescript
addEphemeralWorkspaceDir: (dir) =>
  set((s) => {
    const key = workspacePathKey(dir);
    if (s.workspaceDirs.some((d) => workspacePathKey(d) === key)) return s;
    if (s.ephemeralWorkspaceDirs.some((d) => workspacePathKey(d) === key)) return s;
    return {
      ephemeralWorkspaceDirs: [...s.ephemeralWorkspaceDirs, dir],
      fileTreeVersion: s.fileTreeVersion + 1,
    };
  }),
removeEphemeralWorkspaceDir: (dir) =>
  set((s) => ({
    ephemeralWorkspaceDirs: s.ephemeralWorkspaceDirs.filter(
      (d) => workspacePathKey(d) !== workspacePathKey(dir)
    ),
  })),
```

确认 `partialize` 返回值 **不含** `ephemeralWorkspaceDirs`（无需改动字段列表，只要不添加即可）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/store/__tests__/ephemeralWorkspace.test.ts`

Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/__tests__/ephemeralWorkspace.test.ts
git commit -m "feat(workspace): add ephemeral workspace dirs to app store"
```

---

## Task 3: `App.tsx` — 关联打开时添加临时根

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 添加 import**

在现有 import 区域增加：

```typescript
import { resolveWorkspaceDirFromFilePath } from './utils/workspacePath';
```

- [ ] **Step 2: 修改 `openFromPath`**

将 `App.tsx` 中（约 L137–140）：

```typescript
const openFromPath = async (filePath: string) => {
  const noteFile = await openMarkdownFileFromPath(filePath);
  if (!cancelled && noteFile) loadFile(noteFile);
};
```

替换为：

```typescript
const openFromPath = async (filePath: string) => {
  const noteFile = await openMarkdownFileFromPath(filePath);
  if (cancelled || !noteFile) return;

  try {
    const dir = await resolveWorkspaceDirFromFilePath(filePath);
    if (dir) useAppStore.getState().addEphemeralWorkspaceDir(dir);
  } catch (e) {
    console.warn('ephemeral workspace:', e);
  }

  loadFile(noteFile);
};
```

- [ ] **Step 3: 运行 TypeScript 检查**

Run: `npm run build`

Expected: 编译成功（或至少 `tsc` 无 App.tsx 相关错误）

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(workspace): add ephemeral root on file association open"
```

---

## Task 4: `FileExplorer` — 合并渲染与 UI

**Files:**
- Modify: `src/components/FileExplorer.tsx`

- [ ] **Step 1: 添加 import**

```typescript
import { isSameNormalizedPath } from '../utils/workspacePath';
```

- [ ] **Step 2: `TreeItem` active 高亮**

将 `TreeItem` 内（约 L135）：

```typescript
const isActive = activePath === node.path;
```

改为：

```typescript
const isActive =
  activePath != null && isSameNormalizedPath(activePath, node.path);
```

- [ ] **Step 3: `WorkspaceSection` 增加 `ephemeral` prop**

Props 类型增加 `ephemeral?: boolean`，解构默认值 `ephemeral = false`。

Section header 中目录名 `<span>` 内，在 `{dirName}` 后条件渲染：

```tsx
{ephemeral && (
  <span className="ml-1 text-[10px] font-normal text-gray-400">临时</span>
)}
```

文件夹图标：`ephemeral` 时用 `text-gray-500`，否则保持 `text-yellow-500`。

移除按钮 `title`：`ephemeral ? '移除此临时工作区' : '移除此工作区'`。

- [ ] **Step 4: `FileExplorer` 合并渲染**

从 store 解构增加：

```typescript
ephemeralWorkspaceDirs,
removeEphemeralWorkspaceDir,
```

在 `handleAddWorkspace` 之后、`// ── Non-Tauri fallback` 之前计算：

```typescript
const visibleEphemeralDirs = ephemeralWorkspaceDirs.filter(
  (e) => !workspaceDirs.some((w) => isSameNormalizedPath(w, e))
);
```

空状态条件（约 L429）改为：

```typescript
if (workspaceDirs.length === 0 && visibleEphemeralDirs.length === 0) {
```

多根渲染区：在 `workspaceDirs.map` 之后追加：

```tsx
{visibleEphemeralDirs.map((dir) => (
  <WorkspaceSection
    key={`ephemeral:${dir}`}
    dir={dir}
    ephemeral
    fileTreeVersion={fileTreeVersion}
    activePath={currentFile.path}
    onFileClick={handleFileClick}
    onContextMenu={handleContextMenu}
    onRemove={removeEphemeralWorkspaceDir}
    onNewFile={handleNewFileInWorkspace}
  />
))}
```

持久化根 `WorkspaceSection` 保持 `onRemove={removeWorkspaceDir}`，不传 `ephemeral`（默认 false）。

- [ ] **Step 5: 运行全量前端测试**

Run: `npx vitest run`

Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/FileExplorer.tsx
git commit -m "feat(workspace): render ephemeral workspace roots in file explorer"
```

---

## Task 5: 最终验证

**Files:**（无新文件）

- [ ] **Step 1: 运行完整测试套件**

Run: `npx vitest run`

Expected: 全部 PASS

- [ ] **Step 2: 构建检查**

Run: `npm run build`

Expected: 成功

- [ ] **Step 3: 手动冒烟（Tauri 桌面）**

Run: `npm run tauri dev`

按 Spec §8.3 验证：

1. 无持久化工作区 → 命令行传入 `.md` 路径或双击关联文件 → 文件树出现带「临时」标签的父目录
2. 文件树中当前文件有高亮
3. 「移除此临时工作区」可移除，tab 仍在

- [ ] **Step 4: 更新 Spec 状态（可选）**

将 `docs/superpowers/specs/2026-07-05-ephemeral-workspace-from-file-association.md` 头部状态改为「已实现」。

---

## Spec 覆盖自检

| Spec 章节 | 对应 Task |
|-----------|-----------|
| §4.1–4.4 数据模型 / persist 隔离 | Task 2 |
| §4.3 路径工具 | Task 1 |
| §5.1 打开成功后再加临时根 | Task 3 |
| §6.1 visibleEphemeralDirs | Task 4 |
| §6.2 active 高亮 | Task 4 Step 2 |
| §6.3 空状态 | Task 4 Step 4 |
| §6.1 临时 UI 区分 | Task 4 Step 3 |
| §8 单测 | Task 1, 2 |
| §9 验收标准 | Task 5 手动 |

**不在范围（确认未实现）：** Rust 改动、对话框打开文件触发、tab path tolerant 去重、持久化 `addWorkspaceDir` refactor。

---

## 执行方式

Plan 已保存至 `docs/superpowers/plans/2026-07-05-ephemeral-workspace-from-file-association.md`。

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每个 Task 派发独立 subagent，Task 间 review  
2. **Inline Execution** — 本会话按 Task 顺序逐步执行，每 Task 结束后 checkpoint

你希望用哪种方式开始实现？
