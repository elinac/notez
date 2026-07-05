# 文件关联打开 — 会话级临时工作区

> **日期**: 2026-07-05  
> **状态**: 已批准，待实现  
> **类型**: 功能设计 spec

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

**`addEphemeralWorkspaceDir` 逻辑**：

1. 规范化 `dir`（见 §4.3）
2. 若与任一 `workspaceDirs` 条目等价 → **no-op**
3. 若已在 `ephemeralWorkspaceDirs` → **no-op**
4. 否则 append 到 `ephemeralWorkspaceDirs`，并 `fileTreeVersion++`

**`removeEphemeralWorkspaceDir` 逻辑**：

- 从 `ephemeralWorkspaceDirs` 移除匹配项（按等价比较）
- 不修改 `workspaceDirs`
- 已打开编辑器标签页 **保留**（与移除持久化工作区行为一致）

### 4.3 路径规范化

新建 `src/utils/workspacePath.ts`（或等价模块）：

```typescript
/** 用于工作区去重比较的路径规范化 */
export function normalizeWorkspacePath(path: string): string;

/** 两条路径是否指向同一工作区目录 */
export function isSameWorkspacePath(a: string, b: string): boolean;
```

规则：

- 统一分隔符为 `/`
- Windows 下比较前转小写
- 去除末尾 `/`（根目录除外）
- 优先使用 Tauri `@tauri-apps/api/path` 的 `normalize`（若可用）；失败时回退到手写规则

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
      → dirname(filePath) → normalizeWorkspacePath
      → addEphemeralWorkspaceDir(parentDir)   // 内部去重
      → openMarkdownFileFromPath(filePath)
      → loadFile(noteFile)
  → FileExplorer 合并渲染 workspaceDirs + ephemeralWorkspaceDirs
```

触发点 **仅限** `App.tsx` 中处理关联/CLI/二次实例的 `openFromPath` 路径。

### 5.2 边界情况

| 场景 | 行为 |
|------|------|
| 非 `.md` / `.markdown` | 现有过滤逻辑，不触发临时工作区 |
| 同一目录多次关联打开 | 临时列表中只保留一条 |
| 二次实例打开不同目录文件 | 各目录各加一条临时根 |
| 非 Tauri（浏览器） | 不触发；列表始终为空 |
| `dirname` 失败 | 仅 `loadFile`；`console.warn`；不添加临时根 |
| 目录读取失败 | 文件树已有错误展示；不影响编辑器 |

---

## 6. UI 与交互

### 6.1 文件树合并展示

`FileExplorer` 渲染顺序：

1. 持久化 `workspaceDirs`（`ephemeral: false`）
2. 临时 `ephemeralWorkspaceDirs`（`ephemeral: true`）

`WorkspaceSection` 新增 prop：`ephemeral?: boolean`。

| 元素 | 持久化工作区 | 临时工作区 |
|------|-------------|-----------|
| 目录名旁 | 无额外标签 | 灰色小字「临时」 |
| 文件夹图标 | `FolderOpen` 黄色 | `FolderOpen` 蓝色或灰色 |
| 移除按钮 tooltip | 「移除此工作区」 | 「移除此临时工作区」 |
| 移除 action | `removeWorkspaceDir` | `removeEphemeralWorkspaceDir` |

面板标题保持「工作区」，不改为「临时工作区」。

### 6.2 空状态逻辑

```
if (!_hasHydrated)           → 「正在恢复工作区…」
else if (workspaceDirs.length === 0 && ephemeralWorkspaceDirs.length === 0)
                              → 「未添加工作区」+ 添加按钮
else                          → 渲染合并后的工作区列表
```

### 6.3 「添加工作区目录」

行为不变：调用 `addWorkspaceDir`，写入持久化。临时根不会被自动升级。

---

## 7. 涉及文件

| 文件 | 改动 |
|------|------|
| `src/store/useAppStore.ts` | 新增 `ephemeralWorkspaceDirs` + actions；确认不 persist |
| `src/App.tsx` | `openFromPath` 中调用 `addEphemeralWorkspaceDir` |
| `src/components/FileExplorer.tsx` | 合并渲染、视觉区分、移除分支 |
| `src/utils/workspacePath.ts` | 路径规范化与等价比较（新建） |
| `src/utils/__tests__/workspacePath.test.ts` | 路径工具单测（新建） |
| `src/store/__tests__/ephemeralWorkspace.test.ts` | Store 行为单测（新建，或并入现有 store 测试） |

---

## 8. 测试策略

### 8.1 单元测试

**`workspacePath`**：

- Windows 大小写不敏感等价
- `\` 与 `/` 等价
- 末尾斜杠处理

**Store actions**：

- `addEphemeralWorkspaceDir`：新目录加入；重复 no-op；已在 `workspaceDirs` 中 skip
- `removeEphemeralWorkspaceDir`：移除成功；不影响 `workspaceDirs`
- `partialize` 输出不含 `ephemeralWorkspaceDirs`

### 8.2 组件测试（可选，轻量）

- 仅有临时根时不显示「未添加工作区」
- 临时根渲染「临时」标签

### 8.3 手动验证清单

1. 无持久化工作区 → 双击 `.md` → 文件树显示带「临时」标签的父目录
2. 重启应用 → 临时根消失，持久化配置不变
3. 父目录已在持久化工作区 → 不出现重复临时根
4. 运行中二次实例打开另一目录文件 → 两个临时根并存
5. 移除临时根 → 编辑器标签仍在，文件树该项消失

---

## 9. 验收标准

- [ ] 通过 OS 关联打开 `.md` 时，文件树展示该文件父目录（除非已在持久化工作区中）
- [ ] `workspaceDirs` 的 localStorage 内容在关联打开前后 **不变**
- [ ] 关闭并重启应用后，临时工作区 **全部消失**
- [ ] 多个不同目录的关联打开产生多个临时根
- [ ] 临时根有视觉区分，可手动移除
- [ ] 应用内「打开文件」对话框 **不**产生临时工作区
- [ ] 相关单元测试通过
