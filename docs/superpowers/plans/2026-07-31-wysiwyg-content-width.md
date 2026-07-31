# 全屏（WYSIWYG）内容宽度百分比 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在外观设置中增加全屏内容宽度滑块（50–100%，默认 100%），仅影响 WYSIWYG，用 CSS 变量覆盖 Crepe 水平 padding。

**Architecture:** 常量 + `normalize` / `wysiwygPadInlineCss` 纯函数；`useSettingsStore` 内存 setter 与显式 `persistWysiwygContentWidthPercent` 分离；`WysiwygEditor` 注入 `--notez-wysiwyg-pad-inline`；`App.css` 覆盖 `.ProseMirror` 水平 padding（策略 A）；`AppearanceSettings` 滑块 `input` 改内存、`change` 落盘。

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, CSS 变量, Milkdown Crepe 7.21.x 主题覆盖

**Spec 文档:** `docs/superpowers/specs/2026-07-31-wysiwyg-content-width-design.md`

## Global Constraints

- 仅全屏（WYSIWYG）；源码 / 分屏预览不得改宽度
- 范围整数 50–100；默认 **100**；非法 → 100
- `N === 100` → `padding-inline: 120px`（对齐 Crepe `reset.css`）；`N < 100` → `max(24px, calc((100% - N%) / 2))`
- 拖动中 **禁止** 写 `settings.json`；松手（`change`）再 persist
- 宽度变化 **不得** 加入 `WysiwygEditor` 父级 `key={...}`
- 不引入 Crepe JS feature 配置；不引入 px 最大宽度钳制；不新建设置分类

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/constants/wysiwygContentWidth.ts` | MIN/MAX/DEFAULT、`normalizeWysiwygContentWidthPercent`、`wysiwygPadInlineCss` |
| `src/constants/__tests__/wysiwygContentWidth.test.ts` | 归一化与 pad CSS 单测 |
| `src/store/__tests__/wysiwygContentWidthSettings.test.ts` | store setter / 不写盘 / persist / init |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/store/useSettingsStore.ts` | 字段、setter、persist 方法、`PersistedSettings`、`persist()`、`initSettings` |
| `src/App.css` | `.wysiwyg-editor .milkdown .ProseMirror` 覆盖水平 padding |
| `src/components/WysiwygEditor.tsx` | 订阅百分比并注入 `--notez-wysiwyg-pad-inline` |
| `src/components/settings/AppearanceSettings.tsx` | 滑块 UI |

### 不改动

| 文件 | 原因 |
|------|------|
| `src/components/MarkdownEditor.tsx` | 勿把宽度加入 remount `key` |
| `src-tauri/**` | 纯前端设置 |
| Crepe 主题包内文件 | 只覆盖，不改 `node_modules` |

---

### Task 1: 常量与 pad CSS 纯函数

**Files:**
- Create: `src/constants/wysiwygContentWidth.ts`
- Create: `src/constants/__tests__/wysiwygContentWidth.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export const WYSIWYG_CONTENT_WIDTH_MIN = 50`
  - `export const WYSIWYG_CONTENT_WIDTH_MAX = 100`
  - `export const WYSIWYG_CONTENT_WIDTH_DEFAULT = 100`
  - `export function normalizeWysiwygContentWidthPercent(raw: unknown): number`
  - `export function wysiwygPadInlineCss(percent: number): string`

- [ ] **Step 1: 写失败测试**

```typescript
// src/constants/__tests__/wysiwygContentWidth.test.ts
import { describe, expect, it } from 'vitest';
import {
  WYSIWYG_CONTENT_WIDTH_DEFAULT,
  normalizeWysiwygContentWidthPercent,
  wysiwygPadInlineCss,
} from '../wysiwygContentWidth';

describe('normalizeWysiwygContentWidthPercent', () => {
  it('缺省与非法回落默认 100', () => {
    expect(normalizeWysiwygContentWidthPercent(undefined)).toBe(WYSIWYG_CONTENT_WIDTH_DEFAULT);
    expect(normalizeWysiwygContentWidthPercent(null)).toBe(100);
    expect(normalizeWysiwygContentWidthPercent('x')).toBe(100);
    expect(normalizeWysiwygContentWidthPercent(NaN)).toBe(100);
    expect(normalizeWysiwygContentWidthPercent(Infinity)).toBe(100);
  });

  it('clamp 并四舍五入', () => {
    expect(normalizeWysiwygContentWidthPercent(49)).toBe(50);
    expect(normalizeWysiwygContentWidthPercent(101)).toBe(100);
    expect(normalizeWysiwygContentWidthPercent(80.6)).toBe(81);
    expect(normalizeWysiwygContentWidthPercent('70')).toBe(70);
  });
});

describe('wysiwygPadInlineCss', () => {
  it('100 → 120px', () => {
    expect(wysiwygPadInlineCss(100)).toBe('120px');
  });

  it('<100 → max(24px, calc(...))', () => {
    expect(wysiwygPadInlineCss(70)).toBe('max(24px, calc((100% - 70%) / 2))');
    expect(wysiwygPadInlineCss(50)).toBe('max(24px, calc((100% - 50%) / 2))');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/constants/__tests__/wysiwygContentWidth.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现常量模块**

```typescript
// src/constants/wysiwygContentWidth.ts
export const WYSIWYG_CONTENT_WIDTH_MIN = 50;
export const WYSIWYG_CONTENT_WIDTH_MAX = 100;
export const WYSIWYG_CONTENT_WIDTH_DEFAULT = 100;

export function normalizeWysiwygContentWidthPercent(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return WYSIWYG_CONTENT_WIDTH_DEFAULT;
  return Math.min(
    WYSIWYG_CONTENT_WIDTH_MAX,
    Math.max(WYSIWYG_CONTENT_WIDTH_MIN, Math.round(n)),
  );
}

/** Crepe 策略 A：N=100 还原主题 120px；否则用侧边距塑造内容占比 ≈ N% */
export function wysiwygPadInlineCss(percent: number): string {
  const n = normalizeWysiwygContentWidthPercent(percent);
  if (n >= WYSIWYG_CONTENT_WIDTH_MAX) return '120px';
  return `max(24px, calc((100% - ${n}%) / 2))`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/constants/__tests__/wysiwygContentWidth.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/constants/wysiwygContentWidth.ts src/constants/__tests__/wysiwygContentWidth.test.ts
git commit -m "feat: add wysiwyg content width normalize and pad CSS helpers"
```

---

### Task 2: Settings store 字段与分离持久化

**Files:**
- Modify: `src/store/useSettingsStore.ts`
- Create: `src/store/__tests__/wysiwygContentWidthSettings.test.ts`

**Interfaces:**
- Consumes: `normalizeWysiwygContentWidthPercent`、`WYSIWYG_CONTENT_WIDTH_DEFAULT` from `../constants/wysiwygContentWidth`
- Produces（在 `SettingsState` / store 上）:
  - `wysiwygContentWidthPercent: number`
  - `setWysiwygContentWidthPercent: (n: number) => void` — **仅** `set`，不调用 `persist`
  - `persistWysiwygContentWidthPercent: () => void` — 调用现有 `persist(get())`
  - `PersistedSettings.wysiwygContentWidthPercent?: number`
  - `persist()` 载荷包含 `wysiwygContentWidthPercent`
  - `initSettings` 用 `normalizeWysiwygContentWidthPercent(saved.wysiwygContentWidthPercent)`

- [ ] **Step 1: 写失败测试**

```typescript
// src/store/__tests__/wysiwygContentWidthSettings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WYSIWYG_CONTENT_WIDTH_DEFAULT } from '../../constants/wysiwygContentWidth';
import type { PersistedSettings } from '../useSettingsStore';
import { useSettingsStore } from '../useSettingsStore';

const LS_KEY = 'notez-settings';

describe('wysiwygContentWidthPercent settings', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      loaded: false,
      wysiwygContentWidthPercent: WYSIWYG_CONTENT_WIDTH_DEFAULT,
    });
  });

  it('setWysiwygContentWidthPercent clamp 且不写盘', () => {
    useSettingsStore.getState().setEditorThemeId('nord');
    const before = localStorage.getItem(LS_KEY)!;

    useSettingsStore.getState().setWysiwygContentWidthPercent(49);
    expect(useSettingsStore.getState().wysiwygContentWidthPercent).toBe(50);
    expect(localStorage.getItem(LS_KEY)).toBe(before);
    expect(
      (JSON.parse(before) as PersistedSettings).wysiwygContentWidthPercent,
    ).toBeUndefined();
  });

  it('persistWysiwygContentWidthPercent 写入载荷', () => {
    useSettingsStore.getState().setWysiwygContentWidthPercent(72);
    useSettingsStore.getState().persistWysiwygContentWidthPercent();
    const data = JSON.parse(localStorage.getItem(LS_KEY)!) as PersistedSettings;
    expect(data.wysiwygContentWidthPercent).toBe(72);
  });

  it('initSettings 缺省字段为 100', async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: useSettingsStore.getState().aiConfigs,
        activeAiConfigId: null,
      }),
    );
    useSettingsStore.setState({ wysiwygContentWidthPercent: 60, loaded: false });
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().wysiwygContentWidthPercent).toBe(100);
  });

  it('initSettings 恢复已存合法值', async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: useSettingsStore.getState().aiConfigs,
        activeAiConfigId: null,
        wysiwygContentWidthPercent: 65,
      } satisfies PersistedSettings),
    );
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().wysiwygContentWidthPercent).toBe(65);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/store/__tests__/wysiwygContentWidthSettings.test.ts`

Expected: FAIL（字段 / 方法不存在）

- [ ] **Step 3: 改 `useSettingsStore.ts`**

在文件顶部增加：

```typescript
import {
  WYSIWYG_CONTENT_WIDTH_DEFAULT,
  normalizeWysiwygContentWidthPercent,
} from '../constants/wysiwygContentWidth';
```

在 `PersistedSettings` 增加：

```typescript
wysiwygContentWidthPercent?: number;
```

在 `SettingsState` 增加：

```typescript
wysiwygContentWidthPercent: number;
setWysiwygContentWidthPercent: (n: number) => void;
persistWysiwygContentWidthPercent: () => void;
```

在 `persist(state)` 的对象中增加：

```typescript
wysiwygContentWidthPercent: state.wysiwygContentWidthPercent,
```

在 `create(...)` 初始状态中增加：

```typescript
wysiwygContentWidthPercent: WYSIWYG_CONTENT_WIDTH_DEFAULT,
```

在 actions 中增加（放在字体 setter 附近）：

```typescript
setWysiwygContentWidthPercent: (n) => {
  set({ wysiwygContentWidthPercent: normalizeWysiwygContentWidthPercent(n) });
},

persistWysiwygContentWidthPercent: () => {
  persist(get());
},
```

在 `initSettings` 的 `set({...})` 中增加：

```typescript
wysiwygContentWidthPercent: normalizeWysiwygContentWidthPercent(
  saved.wysiwygContentWidthPercent,
),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/store/__tests__/wysiwygContentWidthSettings.test.ts`

Expected: PASS

另跑：`npx vitest run src/store/__tests__/editorThemeSettings.test.ts`

Expected: PASS（既有主题 persist 不回归）

- [ ] **Step 5: Commit**

```bash
git add src/store/useSettingsStore.ts src/store/__tests__/wysiwygContentWidthSettings.test.ts
git commit -m "feat: persist wysiwyg content width percent in settings store"
```

---

### Task 3: App.css + WysiwygEditor 接线

**Files:**
- Modify: `src/App.css`（约 939–945 行，扩展既有 `.wysiwyg-editor .milkdown .ProseMirror`）
- Modify: `src/components/WysiwygEditor.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` 的 `wysiwygContentWidthPercent`；`wysiwygPadInlineCss` from `../constants/wysiwygContentWidth`
- Produces: 根节点 style 含 `--notez-wysiwyg-pad-inline`；CSS 覆盖水平 padding

- [ ] **Step 1: 扩展 `App.css`**

将：

```css
.wysiwyg-editor .milkdown .ProseMirror {
  font-size: var(--notez-editor-font-size, 16px);
}
```

改为：

```css
.wysiwyg-editor .milkdown .ProseMirror {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding-top: 60px;
  padding-bottom: 60px;
  padding-inline: var(--notez-wysiwyg-pad-inline, 120px);
  font-size: var(--notez-editor-font-size, 16px);
}
```

保留紧随其后的 `pre code` 字号规则不变。

- [ ] **Step 2: 改 `WysiwygEditor.tsx`**

1. 增加 import：

```typescript
import { wysiwygPadInlineCss } from '../constants/wysiwygContentWidth';
```

2. 在组件内订阅：

```typescript
const wysiwygContentWidthPercent = useSettingsStore((s) => s.wysiwygContentWidthPercent);
```

3. 扩展根 `div` 的 `style`（保留现有 `--crepe-font-*`）：

```typescript
style={{
  '--crepe-font-default': editorFontConfig.fontFamily,
  '--crepe-font-code': codeBlockFontConfig.fontFamily,
  '--notez-wysiwyg-pad-inline': wysiwygPadInlineCss(wysiwygContentWidthPercent),
} as React.CSSProperties}
```

**禁止**修改 `MarkdownEditor.tsx` 中的 `key={...}`。

- [ ] **Step 3: 类型检查（可选快速确认）**

Run: `npx tsc --noEmit -p tsconfig.json`（若项目脚本不同，用 `npm run build` 中等价检查；或跳过若过慢，以编辑器诊断为准）

Expected: 无与本次改动相关的错误

- [ ] **Step 4: Commit**

```bash
git add src/App.css src/components/WysiwygEditor.tsx
git commit -m "feat: apply wysiwyg content width via Crepe padding CSS override"
```

---

### Task 4: AppearanceSettings 滑块

**Files:**
- Modify: `src/components/settings/AppearanceSettings.tsx`

**Interfaces:**
- Consumes:
  - `wysiwygContentWidthPercent`
  - `setWysiwygContentWidthPercent`
  - `persistWysiwygContentWidthPercent`
  - `WYSIWYG_CONTENT_WIDTH_MIN` / `MAX` from constants
- Produces: 文档主题说明之后、「代码块语法高亮」之前的 range 控件

- [ ] **Step 1: 从 store 解构新字段与方法**

在 `AppearanceSettings` 的 `useSettingsStore()` 解构中增加：

```typescript
wysiwygContentWidthPercent, setWysiwygContentWidthPercent, persistWysiwygContentWidthPercent,
```

并增加常量 import：

```typescript
import {
  WYSIWYG_CONTENT_WIDTH_MIN,
  WYSIWYG_CONTENT_WIDTH_MAX,
} from '../../constants/wysiwygContentWidth';
```

- [ ] **Step 2: 插入 UI（文档主题说明 `</p>` 之后、代码块 `SettingsSelect` 之前）**

```tsx
<div className="mb-4">
  <label className="block text-xs text-gray-500 mb-1.5">全屏内容宽度</label>
  <div className="flex items-center gap-3 max-w-xs">
    <input
      type="range"
      min={WYSIWYG_CONTENT_WIDTH_MIN}
      max={WYSIWYG_CONTENT_WIDTH_MAX}
      step={1}
      value={wysiwygContentWidthPercent}
      onInput={(e) =>
        setWysiwygContentWidthPercent(Number((e.target as HTMLInputElement).value))
      }
      onChange={() => persistWysiwygContentWidthPercent()}
      className="flex-1 accent-gray-600"
    />
    <span className="text-xs text-gray-600 w-10 tabular-nums text-right">
      {wysiwygContentWidthPercent}%
    </span>
  </div>
  <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
    仅作用于全屏（WYSIWYG）模式；源码/分屏不受影响。百分比相对编辑区宽度；小于 100% 时两侧留白由本设置控制。
  </p>
</div>
```

说明：
- `onInput`：拖动中更新内存（→ CSS）
- `onChange`：松手时 persist（浏览器对 `range` 在松手时触发 `change`）
- 不要在 `onInput` 里调用 `persistWysiwygContentWidthPercent`

- [ ] **Step 3: 跑相关单测回归**

Run:

```bash
npx vitest run src/constants/__tests__/wysiwygContentWidth.test.ts src/store/__tests__/wysiwygContentWidthSettings.test.ts src/store/__tests__/editorThemeSettings.test.ts
```

Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/AppearanceSettings.tsx
git commit -m "feat: add fullscreen content width slider in appearance settings"
```

---

### Task 5: 手动验收（对照 Spec §6.2）

**Files:** 无代码变更（除非发现缺陷再开修复 commit）

- [ ] **Step 1: 启动应用**

Run: `npm run tauri dev`（或当前环境等价命令）

- [ ] **Step 2: 按清单验收**

1. 设置 → 外观 → 拖「全屏内容宽度」至约 70%，关闭对话框后 WYSIWYG 正文明显收窄且两侧留白对称  
2. 切到源码 / 分屏：布局宽度无变化  
3. 重启后百分比仍为所设值  
4. 将宽度调回 **100%**（或新装/清掉该字段）：水平边距约为 Crepe 主题 `120px`（与升级前接近）  
5. 窗口约 800px 宽、宽度 **50%**：正文可读，无异常整页横向滚动  

- [ ] **Step 3: 若全部通过，无需额外 commit；若有缺陷，先修再 commit，说明根因**

---

## Spec 覆盖自检

| Spec 要求 | 任务 |
|-----------|------|
| 常量 MIN/MAX/DEFAULT=100 + normalize | Task 1 |
| `wysiwygPadInlineCss`（100→120px / 公式） | Task 1 |
| Store 字段、内存 setter、显式 persist、init 缺省 100 | Task 2 |
| App.css 策略 A 覆盖水平 padding | Task 3 |
| WysiwygEditor 注入变量、不 remount | Task 3 |
| AppearanceSettings 滑块位置与文案 | Task 4 |
| input 不写盘 / change 写盘 | Task 4 |
| 手动验收 5 条 | Task 5 |

无占位符；类型名与 Task 间一致（`persistWysiwygContentWidthPercent`、`wysiwygPadInlineCss`）。
