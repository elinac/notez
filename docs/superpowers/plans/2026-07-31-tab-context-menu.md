# 标签栏右键关闭菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为标签栏增加右键菜单（关闭 / 关闭其他 / 关闭左侧 / 关闭右侧 / 关闭全部），并用统一的 dirty 确认覆盖 X 与 Ctrl+W。

**Architecture:** 纯函数 `tabCloseTargets` 定义关闭目标；`useAppStore` 批量 actions 调用该纯函数并 `syncActive`；UI 层 `confirmAndCloseTabs` 先关菜单 → `confirmAction` → 快照校验 → 分发 store；`TabBar` 内联右键菜单对齐 FileExplorer。

**Tech Stack:** React 19, TypeScript, Zustand 5, Vitest, `confirmAction`（`@tauri-apps/plugin-dialog` `ask`）

**Spec 文档:** `docs/superpowers/specs/2026-07-29-tab-context-menu-design.md`

## Global Constraints

- 确认必须走 `confirmAction`，禁止裸 `window.confirm` / 直接 `import '@tauri-apps/plugin-dialog'`
- 批量关闭必须 `syncActive` 更新 `currentFile` / `content`
- Store 批量规则必须调用 `getCloseTargetIds`，不得另写一套
- 不新增快捷键；改现有 Ctrl+W；不抽公共 ContextMenu 组件；不改 Rust
- `closeAllTabs` 使用 `createNewFile()`（非空串模板）
- 点菜单项：**先关菜单**再确认；确认后锚点失效则整次 no-op

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/utils/tabCloseTargets.ts` | `TabCloseAction`、`getCloseTargetIds`、`countDirtyInTargets` |
| `src/utils/__tests__/tabCloseTargets.test.ts` | 纯函数单测 |
| `src/utils/confirmCloseTabs.ts` | `confirmAndCloseTabs` 共用入口 |
| `src/utils/__tests__/confirmCloseTabs.test.ts` | 确认取消 / 锚点失效 no-op |
| `src/store/__tests__/tabCloseActions.test.ts` | store 批量关闭单测 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/store/useAppStore.ts` | 接口 + `closeOtherTabs` / `closeTabsToLeft` / `closeTabsToRight` / `closeAllTabs` |
| `src/components/TabBar.tsx` | 右键菜单；X 走 `confirmAndCloseTabs` |
| `src/App.tsx` | Ctrl+W 走 `confirmAndCloseTabs('close', activeTabId)` |

### 不改动

| 文件 | 原因 |
|------|------|
| `src/components/FileExplorer.tsx` | Spec：不抽公共菜单 |
| `src-tauri/**` | Spec：dialog 已具备 |
| `src/utils/nativeDialog.ts` | 直接复用 `confirmAction` |

---

### Task 1: 关闭目标纯函数 `tabCloseTargets`

**Files:**
- Create: `src/utils/tabCloseTargets.ts`
- Create: `src/utils/__tests__/tabCloseTargets.test.ts`

**Interfaces:**
- Consumes: `import type { EditorTab }`；`isFileTab`（值导入）from `../store/useAppStore`
- Produces:
  - `export type TabCloseAction = 'close' | 'others' | 'left' | 'right' | 'all'`
  - `export function getCloseTargetIds(tabs: EditorTab[], action: TabCloseAction, anchorTabId: string): string[]`
  - `export function countDirtyInTargets(tabs: EditorTab[], ids: string[]): number`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/tabCloseTargets.test.ts
import { describe, expect, it } from 'vitest';
import type { EditorTab } from '../../store/useAppStore';
import { countDirtyInTargets, getCloseTargetIds } from '../tabCloseTargets';

function fileTab(id: string, dirty = false): EditorTab {
  return {
    kind: 'file',
    id,
    content: '',
    file: {
      id: `f-${id}`,
      title: id,
      content: '',
      isDirty: dirty,
    },
  };
}

const tabs = [fileTab('a'), fileTab('b', true), fileTab('c')];

describe('getCloseTargetIds', () => {
  it('close: 仅锚点', () => {
    expect(getCloseTargetIds(tabs, 'close', 'b')).toEqual(['b']);
  });

  it('others: 除锚点外全部', () => {
    expect(getCloseTargetIds(tabs, 'others', 'b')).toEqual(['a', 'c']);
  });

  it('left / right', () => {
    expect(getCloseTargetIds(tabs, 'left', 'b')).toEqual(['a']);
    expect(getCloseTargetIds(tabs, 'right', 'b')).toEqual(['c']);
    expect(getCloseTargetIds(tabs, 'left', 'a')).toEqual([]);
    expect(getCloseTargetIds(tabs, 'right', 'c')).toEqual([]);
  });

  it('all: 忽略锚点，返回全部 id', () => {
    expect(getCloseTargetIds(tabs, 'all', 'missing')).toEqual(['a', 'b', 'c']);
  });

  it('锚点无效且非 all → []', () => {
    expect(getCloseTargetIds(tabs, 'others', 'x')).toEqual([]);
    expect(getCloseTargetIds(tabs, 'close', 'x')).toEqual([]);
  });
});

describe('countDirtyInTargets', () => {
  it('只计 dirty file tab', () => {
    expect(countDirtyInTargets(tabs, ['a', 'b', 'c'])).toBe(1);
    expect(countDirtyInTargets(tabs, ['a', 'c'])).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/utils/__tests__/tabCloseTargets.test.ts`

Expected: FAIL（模块不存在或导出未定义）

- [ ] **Step 3: 实现纯函数**

```typescript
// src/utils/tabCloseTargets.ts
import type { EditorTab } from '../store/useAppStore';
import { isFileTab } from '../store/useAppStore';

export type TabCloseAction = 'close' | 'others' | 'left' | 'right' | 'all';

export function getCloseTargetIds(
  tabs: EditorTab[],
  action: TabCloseAction,
  anchorTabId: string,
): string[] {
  if (action === 'all') {
    return tabs.map((t) => t.id);
  }
  const idx = tabs.findIndex((t) => t.id === anchorTabId);
  if (idx < 0) return [];

  switch (action) {
    case 'close':
      return [anchorTabId];
    case 'others':
      return tabs.filter((t) => t.id !== anchorTabId).map((t) => t.id);
    case 'left':
      return tabs.slice(0, idx).map((t) => t.id);
    case 'right':
      return tabs.slice(idx + 1).map((t) => t.id);
    default:
      return [];
  }
}

export function countDirtyInTargets(tabs: EditorTab[], ids: string[]): number {
  const idSet = new Set(ids);
  return tabs.filter(
    (t) => idSet.has(t.id) && isFileTab(t) && t.file.isDirty,
  ).length;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/utils/__tests__/tabCloseTargets.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/tabCloseTargets.ts src/utils/__tests__/tabCloseTargets.test.ts
git commit -m "feat: add tab close target helpers for context menu"
```

---

### Task 2: Store 批量关闭 actions

**Files:**
- Modify: `src/store/useAppStore.ts`（`AppState` 接口约 L113–118；实现约在 `closeTab` 之后）
- Create: `src/store/__tests__/tabCloseActions.test.ts`

**Interfaces:**
- Consumes: `getCloseTargetIds` from `../utils/tabCloseTargets`；现有 `syncActive`、`removeTabSplitRatio`、`createNewFile`、`isFileTab`
- Produces:
  - `closeOtherTabs: (tabId: string) => void`
  - `closeTabsToLeft: (tabId: string) => void`
  - `closeTabsToRight: (tabId: string) => void`
  - `closeAllTabs: () => void`

- [ ] **Step 1: 写失败测试**

```typescript
// src/store/__tests__/tabCloseActions.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore, type FileEditorTab } from '../useAppStore';
import { getCloseTargetIds } from '../../utils/tabCloseTargets';

function makeTab(id: string, title = id): FileEditorTab {
  return {
    kind: 'file',
    id,
    content: `content-${id}`,
    file: {
      id: `f-${id}`,
      title,
      content: `content-${id}`,
      isDirty: false,
    },
  };
}

describe('tab close batch actions', () => {
  beforeEach(() => {
    localStorage.clear();
    const a = makeTab('a');
    const b = makeTab('b');
    const c = makeTab('c');
    useAppStore.setState({
      tabs: [a, b, c],
      activeTabId: 'b',
      currentFile: b.file,
      content: b.content,
      splitPaneRatioByTabId: { a: 0.4, b: 0.5, c: 0.6 },
    });
  });

  it('closeOtherTabs 只留锚点并 syncActive', () => {
    useAppStore.getState().closeOtherTabs('b');
    const s = useAppStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual(['b']);
    expect(s.activeTabId).toBe('b');
    expect(s.content).toBe('content-b');
    expect(s.currentFile.title).toBe('b');
    expect(s.splitPaneRatioByTabId).toEqual({ b: 0.5 });
  });

  it('closeTabsToLeft / Right 与 getCloseTargetIds 一致', () => {
    const tabs = useAppStore.getState().tabs;
    useAppStore.getState().closeTabsToLeft('b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b', 'c']);
    expect(
      getCloseTargetIds(tabs, 'left', 'b'),
    ).toEqual(['a']);

    useAppStore.setState({
      tabs: [makeTab('a'), makeTab('b'), makeTab('c')],
      activeTabId: 'a',
      currentFile: makeTab('a').file,
      content: 'content-a',
      splitPaneRatioByTabId: { a: 0.4, b: 0.5, c: 0.6 },
    });
    useAppStore.getState().closeTabsToRight('b');
    const s = useAppStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    // active 在被关集合 → 切到锚点
    expect(s.activeTabId).toBe('b');
    expect(s.content).toBe('content-b');
  });

  it('closeTabsToRight 时 active 不在被关集合则不变', () => {
    useAppStore.setState({ activeTabId: 'a', currentFile: makeTab('a').file, content: 'content-a' });
    useAppStore.getState().closeTabsToRight('b');
    expect(useAppStore.getState().activeTabId).toBe('a');
    expect(useAppStore.getState().content).toBe('content-a');
  });

  it('closeAllTabs 换成单个 createNewFile 风格 tab', () => {
    useAppStore.getState().closeAllTabs();
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.tabs[0].kind).toBe('file');
    expect(s.currentFile.title).toBe('无标题');
    expect(s.content).toBe(s.tabs[0].content);
    expect(s.splitPaneRatioByTabId).toEqual({});
  });

  it('锚点无效 no-op', () => {
    const before = useAppStore.getState().tabs;
    useAppStore.getState().closeOtherTabs('missing');
    expect(useAppStore.getState().tabs).toEqual(before);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/store/__tests__/tabCloseActions.test.ts`

Expected: FAIL（`closeOtherTabs` is not a function）

- [ ] **Step 3: 在 AppState 增加四个 action 签名**

在 `// Tab actions` 段（`closeTab` 旁）增加：

```typescript
  closeOtherTabs: (tabId: string) => void;
  closeTabsToLeft: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeAllTabs: () => void;
```

文件顶部增加：

```typescript
import { getCloseTargetIds } from '../utils/tabCloseTargets';
```

- [ ] **Step 4: 实现四个 action（紧接现有 `closeTab`）**

在 `closeTab` 实现后插入（保持与现有 `syncActive` / `initialFile` 闭包一致）：

```typescript
        closeOtherTabs: (tabId) =>
          set((state) => {
            const targetIds = getCloseTargetIds(state.tabs, 'others', tabId);
            if (targetIds.length === 0) return {};
            if (!state.tabs.some((t) => t.id === tabId)) return {};
            const remove = new Set(targetIds);
            const newTabs = state.tabs.filter((t) => !remove.has(t.id));
            let splitPaneRatioByTabId = state.splitPaneRatioByTabId;
            for (const id of targetIds) {
              splitPaneRatioByTabId = removeTabSplitRatio(splitPaneRatioByTabId, id);
            }
            return {
              tabs: newTabs,
              activeTabId: tabId,
              splitPaneRatioByTabId,
              ...syncActive(newTabs, tabId, initialFile),
            };
          }),

        closeTabsToLeft: (tabId) =>
          set((state) => {
            const targetIds = getCloseTargetIds(state.tabs, 'left', tabId);
            if (targetIds.length === 0) return {};
            if (!state.tabs.some((t) => t.id === tabId)) return {};
            const remove = new Set(targetIds);
            const newTabs = state.tabs.filter((t) => !remove.has(t.id));
            let newActiveTabId = state.activeTabId;
            if (remove.has(state.activeTabId)) newActiveTabId = tabId;
            let splitPaneRatioByTabId = state.splitPaneRatioByTabId;
            for (const id of targetIds) {
              splitPaneRatioByTabId = removeTabSplitRatio(splitPaneRatioByTabId, id);
            }
            return {
              tabs: newTabs,
              activeTabId: newActiveTabId,
              splitPaneRatioByTabId,
              ...syncActive(newTabs, newActiveTabId, initialFile),
            };
          }),

        closeTabsToRight: (tabId) =>
          set((state) => {
            const targetIds = getCloseTargetIds(state.tabs, 'right', tabId);
            if (targetIds.length === 0) return {};
            if (!state.tabs.some((t) => t.id === tabId)) return {};
            const remove = new Set(targetIds);
            const newTabs = state.tabs.filter((t) => !remove.has(t.id));
            let newActiveTabId = state.activeTabId;
            if (remove.has(state.activeTabId)) newActiveTabId = tabId;
            let splitPaneRatioByTabId = state.splitPaneRatioByTabId;
            for (const id of targetIds) {
              splitPaneRatioByTabId = removeTabSplitRatio(splitPaneRatioByTabId, id);
            }
            return {
              tabs: newTabs,
              activeTabId: newActiveTabId,
              splitPaneRatioByTabId,
              ...syncActive(newTabs, newActiveTabId, initialFile),
            };
          }),

        closeAllTabs: () =>
          set(() => {
            const file = createNewFile();
            const newTab: FileEditorTab = {
              kind: 'file',
              id: file.path ?? `tab-${Date.now()}`,
              file,
              content: file.content,
            };
            const newTabs = [newTab];
            return {
              tabs: newTabs,
              activeTabId: newTab.id,
              splitPaneRatioByTabId: {},
              ...syncActive(newTabs, newTab.id, initialFile),
            };
          }),
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/store/__tests__/tabCloseActions.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.ts src/store/__tests__/tabCloseActions.test.ts
git commit -m "feat: add batch tab close actions to app store"
```

---

### Task 3: 共用确认入口 `confirmAndCloseTabs`

**Files:**
- Create: `src/utils/confirmCloseTabs.ts`
- Create: `src/utils/__tests__/confirmCloseTabs.test.ts`

**Interfaces:**
- Consumes: `confirmAction` from `./nativeDialog`；`getCloseTargetIds` / `countDirtyInTargets` / `TabCloseAction` from `./tabCloseTargets`；`useAppStore`
- Produces: `export async function confirmAndCloseTabs(action: TabCloseAction, anchorId: string): Promise<void>`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/confirmCloseTabs.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type FileEditorTab } from '../../store/useAppStore';
import { confirmAndCloseTabs } from '../confirmCloseTabs';

vi.mock('../nativeDialog', () => ({
  confirmAction: vi.fn(),
}));

import { confirmAction } from '../nativeDialog';

function makeTab(id: string, dirty = false): FileEditorTab {
  return {
    kind: 'file',
    id,
    content: `c-${id}`,
    file: {
      id: `f-${id}`,
      title: id,
      content: `c-${id}`,
      isDirty: dirty,
    },
  };
}

describe('confirmAndCloseTabs', () => {
  beforeEach(() => {
    vi.mocked(confirmAction).mockReset();
    localStorage.clear();
    const a = makeTab('a', true);
    const b = makeTab('b');
    useAppStore.setState({
      tabs: [a, b],
      activeTabId: 'b',
      currentFile: b.file,
      content: b.content,
      splitPaneRatioByTabId: {},
    });
  });

  it('dirty 且用户取消 → tabs 不变', async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(confirmAction).toHaveBeenCalled();
  });

  it('dirty 且用户确认 → 执行关闭', async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('无 dirty → 不弹确认并关闭', async () => {
    useAppStore.setState({
      tabs: [makeTab('a'), makeTab('b')],
      activeTabId: 'b',
    });
    await confirmAndCloseTabs('others', 'b');
    expect(confirmAction).not.toHaveBeenCalled();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('确认后锚点已消失 → no-op', async () => {
    vi.mocked(confirmAction).mockImplementation(async () => {
      useAppStore.setState({
        tabs: [makeTab('a', true)],
        activeTabId: 'a',
        currentFile: makeTab('a', true).file,
        content: 'c-a',
      });
      return true;
    });
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a']);
  });
});
```

注意：测试文件在 `src/utils/__tests__/`，mock 路径为 `../nativeDialog`；若 vitest 解析以被测模块为准，改为：

```typescript
vi.mock('../../utils/nativeDialog', ...) // 不要用这个
```

正确做法：在 `confirmCloseTabs.test.ts` 里 `vi.mock('../nativeDialog')`（相对测试文件到 `src/utils/nativeDialog.ts`）。被测模块 `confirmCloseTabs.ts` 也用 `./nativeDialog`。Vitest 会按模块图 hoist mock。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/utils/__tests__/confirmCloseTabs.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `confirmAndCloseTabs`**

```typescript
// src/utils/confirmCloseTabs.ts
import { useAppStore } from '../store/useAppStore';
import { confirmAction } from './nativeDialog';
import {
  countDirtyInTargets,
  getCloseTargetIds,
  type TabCloseAction,
} from './tabCloseTargets';

export async function confirmAndCloseTabs(
  action: TabCloseAction,
  anchorId: string,
): Promise<void> {
  const { tabs } = useAppStore.getState();
  const targetIds = getCloseTargetIds(tabs, action, anchorId);

  // `all` 即使仅 1 个 tab 也继续；其它 action 无目标则结束
  if (action !== 'all' && targetIds.length === 0) return;

  const dirtyCount = countDirtyInTargets(tabs, targetIds);
  if (dirtyCount > 0) {
    const ok = await confirmAction(
      `有 ${dirtyCount} 个未保存的标签，关闭后修改将丢失。确定关闭？`,
      { okLabel: '关闭', cancelLabel: '取消' },
    );
    if (!ok) return;
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

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/utils/__tests__/confirmCloseTabs.test.ts`

Expected: PASS

若 mock 未生效：在测试顶部改用

```typescript
vi.mock('../nativeDialog', () => ({
  confirmAction: vi.fn(),
}));
```

并确保在 import `confirmAndCloseTabs` **之前**声明 mock（vitest 会 hoist `vi.mock`）。

- [ ] **Step 5: Commit**

```bash
git add src/utils/confirmCloseTabs.ts src/utils/__tests__/confirmCloseTabs.test.ts
git commit -m "feat: add confirmAndCloseTabs shared close entry"
```

---

### Task 4: TabBar 右键菜单 + X 走确认

**Files:**
- Modify: `src/components/TabBar.tsx`（整文件重写为带菜单版本）

**Interfaces:**
- Consumes: `confirmAndCloseTabs`；`TabCloseAction`（仅类型或内联字面量）；`useAppStore` 的 `tabs` / `activeTabId` / `switchTab`
- Produces: 用户可见右键菜单；X 调用 `confirmAndCloseTabs('close', tab.id)`

- [ ] **Step 1: 用下列实现替换 `TabBar.tsx`**

对齐 FileExplorer 菜单样式与「点项先关菜单」；禁用态灰显。

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useAppStore, isFileTab } from '../store/useAppStore';
import { confirmAndCloseTabs } from '../utils/confirmCloseTabs';
import type { TabCloseAction } from '../utils/tabCloseTargets';

type TabContextMenu = { x: number; y: number; tabId: string };

export function TabBar() {
  const { tabs, activeTabId, switchTab } = useAppStore();
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const anchorIndex = contextMenu
    ? tabs.findIndex((t) => t.id === contextMenu.tabId)
    : -1;
  const onlyOne = tabs.length === 1;
  const disableClose = onlyOne;
  const disableOthers = onlyOne;
  const disableLeft = anchorIndex <= 0;
  const disableRight = anchorIndex < 0 || anchorIndex >= tabs.length - 1;

  const runAction = async (action: TabCloseAction, tabId: string) => {
    setContextMenu(null);
    await confirmAndCloseTabs(action, tabId);
  };

  return (
    <div className="flex items-end notez-tab-bar notez-chrome border-b border-gray-200 overflow-x-auto overflow-y-hidden flex-shrink-0 select-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;
        const title = isFileTab(tab) ? (tab.file.path ?? tab.file.title) : 'Unknown';
        const label = isFileTab(tab) ? tab.file.title : 'Unknown';
        const showDirty = isFileTab(tab) && tab.file.isDirty;

        return (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 border-r border-gray-200
              text-xs font-medium max-w-[180px] flex-shrink-0 group relative
              ${isActive
                ? 'notez-tab-active text-gray-800 border-b-2 -mb-px'
                : 'bg-transparent text-gray-500 hover:bg-white/60 hover:text-gray-700'}
            `}
            title={title}
          >
            <span className="truncate min-w-0">{label}</span>
            {showDirty && (
              <span className="text-[color:var(--notez-accent,var(--notez-accent-fallback))] text-xs flex-shrink-0">●</span>
            )}
            {!isOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void confirmAndCloseTabs('close', tab.id);
                }}
                className={`
                  flex-shrink-0 rounded p-0.5 ml-0.5
                  ${isActive
                    ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    : 'text-gray-300 hover:text-gray-600 hover:bg-gray-200 opacity-0 group-hover:opacity-100'}
                `}
                title="关闭标签"
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}

      {contextMenu && (
        <div
          ref={menuRef}
          data-native-context-menu
          className="fixed z-50 notez-panel border border-gray-200 rounded shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '130px' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem
            disabled={disableClose}
            onClick={() => void runAction('close', contextMenu.tabId)}
          >
            关闭
          </MenuItem>
          <MenuItem
            disabled={disableOthers}
            onClick={() => void runAction('others', contextMenu.tabId)}
          >
            关闭其他
          </MenuItem>
          <MenuItem
            disabled={disableLeft}
            onClick={() => void runAction('left', contextMenu.tabId)}
          >
            关闭左侧
          </MenuItem>
          <MenuItem
            disabled={disableRight}
            onClick={() => void runAction('right', contextMenu.tabId)}
          >
            关闭右侧
          </MenuItem>
          <div className="border-t border-gray-100 my-1" />
          <MenuItem
            disabled={false}
            onClick={() => void runAction('all', contextMenu.tabId)}
          >
            关闭全部
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-left ${
        disabled
          ? 'text-gray-300 cursor-not-allowed'
          : 'hover:bg-gray-100 text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`

Expected: 无与 TabBar / confirmCloseTabs 相关的错误

- [ ] **Step 3: 跑相关单测**

Run: `npx vitest run src/utils/__tests__/tabCloseTargets.test.ts src/utils/__tests__/confirmCloseTabs.test.ts src/store/__tests__/tabCloseActions.test.ts`

Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat: add tab bar context menu for close actions"
```

---

### Task 5: Ctrl+W 走同一确认入口

**Files:**
- Modify: `src/App.tsx`（约 L289–292 的 `e.key === 'w'` 分支）

**Interfaces:**
- Consumes: `confirmAndCloseTabs`
- Produces: Ctrl+W 与 X / 菜单「关闭」行为一致

- [ ] **Step 1: 增加 import**

在 `App.tsx` 其它 utils import 旁增加：

```typescript
import { confirmAndCloseTabs } from './utils/confirmCloseTabs';
```

- [ ] **Step 2: 替换 Ctrl+W 分支**

将：

```typescript
      } else if (e.key === 'w') {
        e.preventDefault();
        const { tabs: tabList, activeTabId: aid, closeTab } = useAppStore.getState();
        if (tabList.length > 1) closeTab(aid);
      }
```

改为：

```typescript
      } else if (e.key === 'w') {
        e.preventDefault();
        const { tabs: tabList, activeTabId: aid } = useAppStore.getState();
        if (tabList.length > 1) {
          void confirmAndCloseTabs('close', aid);
        }
      }
```

- [ ] **Step 3: 全量相关回归**

Run: `npx vitest run src/utils/__tests__/tabCloseTargets.test.ts src/utils/__tests__/confirmCloseTabs.test.ts src/store/__tests__/tabCloseActions.test.ts`

Expected: PASS

Run: `npx tsc --noEmit`

Expected: 无错误

- [ ] **Step 4: 手工冒烟（开发者）**

1. `npm run tauri dev`（或 `npm run dev`）
2. 打开 ≥3 个标签，右键中间标签：关左/右/其他
3. 制造 dirty（编辑不保存），关其他 → 出现确认；取消则不变
4. 点 X / Ctrl+W 对 dirty 标签 → 同一确认文案
5. 关闭全部 → 剩一个「无标题」新建标签

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: route Ctrl+W through confirmAndCloseTabs"
```

---

## Spec 覆盖自检

| Spec 要求 | Task |
|-----------|------|
| `getCloseTargetIds` / `countDirtyInTargets` | Task 1 |
| Store 四 actions + `syncActive` + `createNewFile` 构造 | Task 2 |
| `confirmAction`、先关菜单、快照 A、分发表 | Task 3–4 |
| 右键菜单五项 + 禁用态 | Task 4 |
| X / Ctrl+W 共用确认 | Task 4–5 |
| 单测路径与 mock `confirmAction` | Task 1–3 |

无占位符；类型名与 Spec §4 一致（`TabCloseAction`、`confirmAndCloseTabs`）。
`}