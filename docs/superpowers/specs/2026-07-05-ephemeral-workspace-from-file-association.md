# 文件关联打开 — 会话级临时工作区

> **日期**: 2026-07-05  
> **状态**: 已批准（含二次审核修订），待实现  
> **类型**: 功能设计 spec  
> **修订**: 2026-07-05 — 路径 API 分层、打开成功后再加临时根、已知限制与 active 高亮  
> **二次修订**: 2026-07-05 — normalize 文件路径后再 dirname、渲染层过滤重复临时根、active guard、tab 去重限制

---

## 1. 背景与动机

### 1.1 现状

NoteZ 支持通过 OS 文件关联（`.md` / `.markdown`）、CLI `path` 参数、以及 `single_instance` 二次实例事件 `open-markdown-path` 打开外部 Markdown 文件（`App.tsx` → `openMarkdownFileFromPath` → `loadFile`）。

工作区根目录 `workspaceDirs` 由用户在文件树中手动「添加工作区目录」，并 **持久化** 到 `localStorage`（`useAppStore`）。

**问题**：若用户未配置持久化工作区，通过关联打开文件后编辑器有内容，但文件树仍显示「未添加工作区」，无法浏览同目录下的其它文件。

### 1.2 目标

从关联文件打开应用时，自动将 **文件所在目录** 作为 **会话级临时工作区** 显示在文件树中，使用户能浏览同级/子目录文件。

**约束**：不得修改或写入持久化的 `workspaceDirs` 配置。

---

## 2. 需求决策（brainstorming 结论）

| 决策点 | 结论 |
|--------|------|
| 生命周期 | **A** — 仅本次应用会话有效；关闭应用后清除 |
| 多目录 | **A** — 每个不同目录各保留一个临时根 |
| 与持久化重复 | **A** — 目录已在 `workspaceDirs` 中则跳过，只打开文件 |
| 视觉区分 | **A** — 临时根需有明确 UI 标识 |
| 触发范围 | **A** — 仅 OS 关联 / CLI / 二次实例（`open-markdown-path`） |
| 手动移除 | **A** — 可移除，只影响会话，不写持久化 |

### 2.1 不在范围内

- 应用内「打开文件」对话框、最近文件列表 → **不**触发临时工作区
- Rust 端（`lib.rs`）、`tauri.conf.json` → **无需修改**
- 将临时工作区「升级」为持久化 → 用户需显式「添加工作区目录」
- **Refactor 持久化 `addWorkspaceDir` / `removeWorkspaceDir` 的去重逻辑** → 本 spec 不改动；仅 ephemeral 侧使用 tolerant compare

### 2.2 已知限制（Known limitations）

1. **子目录与持久化根重叠**：若持久化根为 `D:\Projects`，关联打开 `D:\Projects\sub\readme.md` 时，仍会新增临时根 `D:\Projects\sub`（与 brainstorming 决策「仅 exact match 跳过」一致）。不做「目录被持久化根包含」检测；若需避免冗余根，可在后续版本增加 `isPathUnderWorkspaceRoot()`。
2. **重启后会话丢失**：`tabs` 会 persist（含关联打开的文件 path），`ephemeralWorkspaceDirs` 不会。重启后用户可能仍有编辑 tab，但文件树无对应临时根——这是 session-only 的预期行为，非 bug。
3. **Tab 去重仍为精确 path 匹配**：`openTab` 使用 `t.file.path === file.path`（`useAppStore.ts`），本 spec 不 refactor。同一文件若以不同 path 字符串二次关联打开，仍可能产生多个 tab；active 高亮由 `isSameNormalizedPath` tolerant compare 单独处理。

---

## 3. 方案选择

### 3.1 候选方案

| 方案 | 描述 | 评价 |
|------|------|------|
| **A（采用）** | Store 独立 `ephemeralWorkspaceDirs`，不 persist | 职责清晰，改动小，易测 |
| B | 统一 `WorkspaceRoot { path, source }` 模型 | 类型更统一，当前需求略重 |
| C | React Context 局部 state | 与 FileExplorer 现有 store 模式不一致 |

**采用方案 A**。

---

## 4. 架构与数据模型

### 4.1 新增状态（仅内存）

```typescript
/** 会话级临时工作区根目录（有序，不 persist） */
ephemeralWorkspaceDirs: string[];
```

初始值：`[]`。

### 4.2 新增 actions

```typescript
addEphemeralWorkspaceDir(dir: string): void;
removeEphemeralWorkspaceDir(dir: string): void;
```

**`addEphemeralWorkspaceDir` 逻辑**（**同步**；入参必须是已通过 Tauri `normalize` 的 canonical 路径）：

1. 用 `workspacePathKey(dir)` 与任一 `workspaceDirs` 条目比较 → 等价则 **no-op**
2. 用 `workspacePathKey(dir)` 与任一 `ephemeralWorkspaceDirs` 比较 → 等价则 **no-op**
3. 否则 append **原始 canonical 字符串** `dir` 到 `ephemeralWorkspaceDirs`，并 `fileTreeVersion++`

> **`fileTreeVersion` 仅在 ephemeral 添加时 bump**：持久化 `addWorkspaceDir` 当前不 bump；临时根首次出现时需触发文件树挂载，故此处递增。

**`removeEphemeralWorkspaceDir` 逻辑**：

- 从 `ephemeralWorkspaceDirs` 移除与 `dir` 等价（`workspacePathKey` / `isSameNormalizedPath`）的条目
- 不修改 `workspaceDirs`
- 已打开编辑器标签页 **保留**（与移除持久化工作区行为一致）

### 4.3 路径工具（两层 API）

新建 `src/utils/workspacePath.ts`。Tauri 官方 `@tauri-apps/api/path` 中 `dirname` / `normalize` 均为 **异步** `Promise<string>`（`invoke('plugin:path|…')`）；工程已在 `capabilities/default.json` 声明 `core:path:default`。

**禁止**在同步 store action 内调用 Tauri path API。

```typescript
/**
 * 同步：仅用于等价比较（去重、active 高亮）。
 * 规则：统一 `/`、Windows 小写、去末尾 `/`（盘符根除外）。
 */
export function workspacePathKey(path: string): string;

/**
 * 两条路径是否等价（目录或文件均可；用于去重、active 高亮）。
 * 实现：`workspacePathKey(a) === workspacePathKey(b)`。
 */
export function isSameNormalizedPath(a: string, b: string): boolean;

/**
 * 异步：从关联文件路径解析 canonical 工作区根。
 * 1. normalizedFile = await normalize(filePath)  — 先 canonical 化文件路径（含 Windows `\\?\` 前缀）
 * 2. parent = await dirname(normalizedFile)
 * 3. return await normalize(parent)
 * 任一步失败 → 返回 null（caller 打 console.warn，不阻断 loadFile）。
 */
export async function resolveWorkspaceDirFromFilePath(
  filePath: string
): Promise<string | null>;
```

**参考实现**：

```typescript
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

**与持久化 `workspaceDirs` 的去重**：ephemeral 侧用 `workspacePathKey` tolerant compare；持久化侧仍用现有 `includes(dir)`，本 spec 不 refactor。

### 4.4 持久化隔离

- `partialize` **不得**包含 `ephemeralWorkspaceDirs`
- `migrate` 无需处理该字段
- 应用重启后 `ephemeralWorkspaceDirs` 自动为空

---

## 5. 数据流

### 5.1 主流程

```
OS 双击 .md
  → CLI path 参数 或 single_instance 发出 open-markdown-path
  → App.tsx openFromPath(filePath)
      → noteFile = await openMarkdownFileFromPath(filePath)
      → 若 noteFile 为 null → 结束（不加临时根）
      → dir = await resolveWorkspaceDirFromFilePath(filePath)
      → 若 dir 非 null → useAppStore.getState().addEphemeralWorkspaceDir(dir)
      → loadFile(noteFile)
  → FileExplorer 合并渲染 workspaceDirs + visibleEphemeralDirs（§6.1）
```

**实现约定**：

- 关联打开逻辑通过 `useAppStore.getState()` 取 action，避免 `useEffect` 依赖膨胀
- **必须先打开文件成功，再添加临时根**（避免读盘失败时出现空临时根）

触发点 **仅限** `App.tsx` 中处理关联/CLI/二次实例的 `openFromPath` 路径。

**参考实现（伪代码）**：

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

### 5.2 边界情况

| 场景 | 行为 |
|------|------|
| 非 `.md` / `.markdown` | 现有过滤逻辑，不触发临时工作区 |
| `openMarkdownFileFromPath` 失败 | 不加临时根；不 `loadFile` |
| 同一目录多次关联打开 | 临时列表中只保留一条 |
| 二次实例打开不同目录文件 | 各目录各加一条临时根 |
| 非 Tauri（浏览器） | 不触发；列表始终为空 |
| `resolveWorkspaceDirFromFilePath` 失败 | 仍 `loadFile`；`console.warn`；不添加临时根 |
| 目录读取失败（文件树） | 文件树已有错误展示；不影响编辑器 |
| 应用重启 | 临时根清空；persist 的 tabs 可能仍在，文件树无临时根（见 §2.2） |
| 持久化根包含文件所在子目录 | 仍可能新增子目录临时根（见 §2.2） |
| 用户手动添加与临时根同目录的持久化工作区 | `ephemeralWorkspaceDirs` 可能仍保留该条目；**渲染层过滤**（§6.1），文件树不重复显示 |

---

## 6. UI 与交互

### 6.1 文件树合并展示

**可见临时根**（渲染前去重，避免与持久化根重复显示）：

```typescript
const visibleEphemeralDirs = ephemeralWorkspaceDirs.filter(
  (e) => !workspaceDirs.some((w) => isSameNormalizedPath(w, e))
);
```

> 场景：关联打开产生临时根 `D:\Docs` 后，用户再「添加工作区」选同一目录。`addWorkspaceDir` 不改动 ephemeral 列表，但渲染时 `visibleEphemeralDirs` 为空，文件树只显示持久化根。

`FileExplorer` 渲染顺序：

1. 持久化 `workspaceDirs`（`ephemeral: false`）
2. `visibleEphemeralDirs`（`ephemeral: true`）

`WorkspaceSection` 新增 prop：`ephemeral?: boolean`。

| 元素 | 持久化工作区 | 临时工作区 |
|------|-------------|-----------|
| 目录名旁 | 无额外标签 | 灰色小字「临时」 |
| 文件夹图标 | `FolderOpen` 黄色 | `FolderOpen` 灰色（`text-gray-500`） |
| 移除按钮 tooltip | 「移除此工作区」 | 「移除此临时工作区」 |
| 移除 action | `removeWorkspaceDir` | `removeEphemeralWorkspaceDir` |

面板标题保持「工作区」，不改为「临时工作区」。

### 6.2 当前文件高亮（active）

`TreeItem` 中 `activePath === node.path` 改为：

```typescript
activePath != null && isSameNormalizedPath(activePath, node.path)
```

避免关联路径与 `readDir` + `join` 产物格式不一致导致树中不高亮；`activePath` 为空（新建无路径文件）时不高亮。

### 6.3 空状态逻辑

```
if (!_hasHydrated)           → 「正在恢复工作区…」
else if (workspaceDirs.length === 0 && visibleEphemeralDirs.length === 0)
                              → 「未添加工作区」+ 添加按钮
else                          → 渲染合并后的工作区列表（含面板工具栏「添加工作区」）
```

> 空状态用 `visibleEphemeralDirs`（§6.1 过滤后），而非原始 `ephemeralWorkspaceDirs`。

### 6.4 「添加工作区目录」

行为不变：调用 `addWorkspaceDir`，写入持久化。临时根不会被自动升级。

---

## 7. 涉及文件

| 文件 | 改动 |
|------|------|
| `src/store/useAppStore.ts` | 新增 `ephemeralWorkspaceDirs` + actions；确认不 persist |
| `src/App.tsx` | `openFromPath`：成功打开后 `resolveWorkspaceDirFromFilePath` + `getState().addEphemeralWorkspaceDir` |
| `src/components/FileExplorer.tsx` | 合并渲染、`visibleEphemeralDirs` 过滤、视觉区分、移除分支、active 高亮、空状态条件 |
| `src/utils/workspacePath.ts` | `workspacePathKey`、`isSameNormalizedPath`、`resolveWorkspaceDirFromFilePath`（新建） |
| `src/utils/__tests__/workspacePath.test.ts` | 路径 key 单测；`resolveWorkspaceDirFromFilePath` 可 mock Tauri path |
| `src/store/__tests__/ephemeralWorkspace.test.ts` | Store 行为单测（新建） |

---

## 8. 测试策略

### 8.1 单元测试

**`workspacePath`**：

- `workspacePathKey`：Windows 大小写不敏感；`\` 与 `/` 等价；末尾斜杠
- `isSameNormalizedPath`：与 `workspacePathKey` 一致；目录与文件路径均可
- `resolveWorkspaceDirFromFilePath`：mock `normalize` + `dirname` 三步；失败返回 null

**Store actions**（工程尚无 `useAppStore` 单测先例；可直接 `useAppStore.setState` 设初值后调 action，或抽纯函数辅助测试）：

- `addEphemeralWorkspaceDir`：新目录加入；重复 no-op；`workspacePathKey` 与 `workspaceDirs` 等价时 skip
- `removeEphemeralWorkspaceDir`：移除成功；不影响 `workspaceDirs`
- `addEphemeralWorkspaceDir` 成功时 `fileTreeVersion` 递增
- `partialize` 输出不含 `ephemeralWorkspaceDirs`

### 8.2 组件测试（可选，轻量）

- 仅有临时根时不显示「未添加工作区」
- 临时根渲染「临时」标签
- 临时根与持久化根同 key 时，文件树只显示持久化根

### 8.3 手动验证清单

1. 无持久化工作区 → 双击 `.md` → 文件树显示带「临时」标签的父目录
2. 重启应用 → 临时根消失，持久化配置不变；若 tab 仍在则文件树可能无临时根（预期）
3. 父目录已在持久化工作区（同 key）→ 不出现重复临时根
4. 运行中二次实例打开另一目录文件 → 两个临时根并存
5. 移除临时根 → 编辑器标签仍在，文件树该项消失
6. 关联打开不存在/无权限文件 → 无临时根、无新 tab
7. 关联打开后树中当前文件有高亮
8. 先有临时根 → 手动「添加工作区」选同目录 → 文件树只显示一个持久化根（无重复）

---

## 9. 验收标准

- [ ] 通过 OS 关联打开 `.md` 且读盘成功时，文件树展示该文件父目录（除非 `workspacePathKey` 与某持久化根等价）
- [ ] 读盘失败时不出现临时根
- [ ] `workspaceDirs` 的 localStorage 内容在关联打开前后 **不变**
- [ ] 关闭并重启应用后，临时工作区 **全部消失**
- [ ] 多个不同目录的关联打开产生多个临时根
- [ ] 临时根有视觉区分，可手动移除
- [ ] 应用内「打开文件」对话框 **不**产生临时工作区
- [ ] 文件树 active 高亮在路径格式差异下仍正确（含 `activePath` 为空时不误判）
- [ ] 临时根与持久化根同 key 时，文件树不重复显示
- [ ] 相关单元测试通过
