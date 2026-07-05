# 依赖升级方案 D 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec 分 Phase 升级 NoteZ 前后端依赖（D-1 优先：patch + Tauri 2.11 + reqwest 0.13；可选 D-2 Milkdown；D-3 TS6/Vite8），每 Phase 独立 commit 且验证通过。

**Architecture:** 不改动业务逻辑；仅更新 `package.json`/`package-lock.json`、`src-tauri/Cargo.toml`/`Cargo.lock`、构建配置（`vite.config.ts`、`vitest.config.ts`、`tsconfig*.json`）及 Milkdown patch 文件。验证依赖现有 Vitest + `cargo test` + Windows 手工冒烟。

**Tech Stack:** npm, Cargo, Tauri 2.11, reqwest 0.13, Vite 8, TypeScript 6, Vitest 4, patch-package, Milkdown 7.21（D-2）

**Spec 文档:** `docs/superpowers/specs/2026-07-05-dependency-upgrade-option-d-verification.md`

**版本 pin 参考（2026-07-05 npm/crates.io）：**

| 包 | 目标版本 |
|---|---|
| `@tauri-apps/api` | 2.11.1 |
| `@tauri-apps/cli` | 2.11.4 |
| `@tauri-apps/plugin-dialog` | 2.7.1 |
| `@tauri-apps/plugin-fs` | 2.5.1 |
| `@tauri-apps/plugin-opener` | 2.5.4 |
| `@tauri-apps/plugin-cli` | 2.4.1 |
| `tauri` / `tauri-build` | 2.11.5 / 2.6.3（`cargo update` 解析） |
| `tauri-plugin-dialog` | 2.7.1 |
| `tauri-plugin-fs` | 2.5.1 |
| `window-vibrancy` | 0.7.1 |
| `reqwest` | 0.13.x，feature `rustls` |
| `vite` | 8.1.3 |
| `@vitejs/plugin-react` | 6.0.3 |
| `typescript` | 6.0.3 |
| `@milkdown/crepe`, `kit`, `react` | 7.21.2（D-2） |

---

## 文件结构

### 修改文件（按 Phase）

| Phase | 文件 | 变更 |
|---|---|---|
| 1 | `package.json`, `package-lock.json` | patch 级前端依赖 |
| 1 | `src-tauri/Cargo.lock` | `chrono`, `serde_json` patch |
| 2 | `package.json`, `package-lock.json` | Tauri npm 全家桶 |
| 2 | `src-tauri/Cargo.toml`, `Cargo.lock` | Tauri + plugins + `window-vibrancy` 0.7 |
| 2 | `src-tauri/capabilities/default.json`, `tauri.conf.json` | `tauri migrate` 可能更新 |
| 3 | `src-tauri/Cargo.toml`, `Cargo.lock` | reqwest 0.13 + `rustls` feature |
| 4 | `package.json`, `package-lock.json` | Milkdown 7.21 |
| 4 | `patches/@milkdown+components+*.patch` | 重打或删除 |
| 5 | `package.json`, `package-lock.json` | vite 8, plugin-react 6, typescript 6 |
| 5 | `vite.config.ts` | `strictPort: true` |
| 5 | `vitest.config.ts` | merge `vite.config.ts` |
| 5 | `tsconfig.node.json` | include `vitest.config.ts` |
| 5 | Create: `tsconfig.vitest.json` | 测试代码 TS6 检查 |
| 6 | `package.json`, `package-lock.json` | `sharp` 0.35 |

### 不修改（除非 TS6 报错）

- `src-tauri/src/ai_service.rs` — reqwest 0.13 API 与 0.12 兼容（仅 Cargo feature 变更）
- `src-tauri/src/lib.rs` — `apply_mica` 签名在 window-vibrancy 0.7 未变
- `src/components/mermaidSingleton.ts` — Vite 8 后仅验证，默认不改

---

## Task 0: Phase 0 — 基线与分支

**Files:**
- Create (local): `tasks/deps-option-d-baseline.txt`
- Git: branch `chore/deps-option-d`, tag `deps-option-d-baseline`

- [ ] **Step 1: 创建分支与回滚 tag**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
git checkout -b chore/deps-option-d
git tag deps-option-d-baseline
```

- [ ] **Step 2: 安装依赖并跑自动化基线**

```bash
npm ci
cd src-tauri && cargo test -- --nocapture
cd ..
npx vitest run
npm run build
```

Expected: 全部 pass，patch-package 无 fail。

- [ ] **Step 3: PlantUML fixture 基线**

```bash
cd src-tauri && cargo test plan_fixture -- --nocapture
```

Expected: 全部 pass。

- [ ] **Step 4: 可选打包基线**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
npm run tauri build
```

Expected: Windows 安装包/可执行文件生成成功。

- [ ] **Step 5: 保存基线输出**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
{
  echo "=== npm ci ==="
  npm ci 2>&1
  echo "=== vitest ==="
  npx vitest run 2>&1
  echo "=== cargo test ==="
  cd src-tauri && cargo test 2>&1
} | Tee-Object -FilePath tasks/deps-option-d-baseline.txt
```

不提交 `tasks/` 目录。

---

## Task 1: Phase 1 — 保守 patch（D-1）

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: 升级 npm patch（排除 major 与 Tauri/Milkdown/工具链）**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
npm install react@latest react-dom@latest
npm install tailwindcss@latest @tailwindcss/postcss@latest
npm install vitest@latest zustand@latest mermaid@latest lucide-react@latest
npm install @codemirror/state@latest @codemirror/view@latest
npm install @radix-ui/react-dialog@latest @radix-ui/react-tabs@latest
npm install postcss@latest autoprefixer@latest jsdom@latest
npm install @types/react@latest @types/react-dom@latest
```

**勿** 升级：`typescript`, `vite`, `@vitejs/plugin-react`, `@milkdown/*`, `@tauri-apps/*`。

- [ ] **Step 2: 升级 Rust patch crate**

```bash
cd src-tauri
cargo update -p chrono -p serde_json
cargo test
cd ..
```

Expected: 全绿。

- [ ] **Step 3: 验证 postinstall patch**

```bash
npm ci
```

Expected: `@milkdown+components+7.19.2.patch` 成功应用。

- [ ] **Step 4: 前端验证**

```bash
npx vitest run
npm run build
cd src-tauri && cargo test plan_fixture -- --nocapture
```

Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.lock
git commit -m "$(cat <<'EOF'
chore(deps): bump patch-level npm and Rust crates (Phase 1)

Update React, Tailwind, Vitest, Codemirror, and chrono/serde_json without Tauri or toolchain majors.
EOF
)"
```

---

## Task 2: Phase 2 — Tauri 双端 + window-vibrancy（D-1）

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- Modify (可能): `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`

- [ ] **Step 1: 升级 npm Tauri 包（独立 semver，非统一 2.11）**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
npm install @tauri-apps/api@2.11.1 @tauri-apps/cli@2.11.4
npm install @tauri-apps/plugin-dialog@2.7.1 @tauri-apps/plugin-fs@2.5.1
npm install @tauri-apps/plugin-opener@2.5.4 @tauri-apps/plugin-cli@2.4.1
```

- [ ] **Step 2: 更新 `src-tauri/Cargo.toml`**

将 plugin 版本 pin 为与 npm 对齐，并升级 window-vibrancy：

```toml
tauri-plugin-dialog = "2.7.1"
tauri-plugin-fs = "2.5.1"
# opener/cli/single-instance/window-state 保持 "2" 或 pin 到 latest 2.x

[target.'cfg(windows)'.dependencies]
window-vibrancy = "0.7"
```

- [ ] **Step 3: Cargo update Tauri 栈**

```bash
cd src-tauri
cargo update -p tauri -p tauri-build -p tauri-plugin-dialog -p tauri-plugin-fs
cargo update -p window-vibrancy
cargo build
cd ..
```

Expected: 零 error。

- [ ] **Step 4: 运行 tauri migrate**

```bash
npm run tauri migrate
git diff src-tauri/capabilities/default.json src-tauri/tauri.conf.json
```

Expected: 无报错；若有 diff，审阅 permissions 仍包含 `fs:*`, `dialog:*`, `opener:*`, `core:path:default`, `window-state:default`（见当前 `default.json`）。

- [ ] **Step 5: 自动化验证**

```bash
npx vitest run
npm run build
cd src-tauri && cargo test
```

- [ ] **Step 6: Windows 手工冒烟（Phase 2 验证表）**

启动 `npm run tauri dev`，逐项确认：

1. 窗口启动 + Mica 透明正常
2. 打开/保存 `.md` 文件
3. 设置对话框、About → LICENSE 链接
4. 设置 → 字体列表有数据（`list_system_fonts`）
5. AI 助手发一条消息（Channel 流式）
6. 二次启动聚焦单实例
7. 调整窗口大小后重启恢复

- [ ] **Step 7: 打包验证**

```bash
npm run tauri build
```

Expected: 成功，无 permission denied。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git add src-tauri/capabilities/ src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
chore(deps): sync Tauri 2.11 stack and window-vibrancy 0.7 (Phase 2)

Align npm plugins with Cargo crates; run tauri migrate; verify capabilities on Windows.
EOF
)"
```

**D-1 可在 Task 3 完成后 merge 到 main（若跳过 D-2/D-3）。**

---

## Task 3: Phase 3 — reqwest 0.13（D-1）

**Files:**
- Modify: `src-tauri/Cargo.toml:34`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: 修改 reqwest 依赖（feature 更名）**

`src-tauri/Cargo.toml` 第 34 行改为：

```toml
reqwest = { version = "0.13", default-features = false, features = ["json", "stream", "socks", "rustls"] }
```

**注意:** `rustls-tls` → `rustls`；必须保留 `json`（`ai_list_models` 使用 `resp.json()`）。

- [ ] **Step 2: 编译验证**

```bash
cd src-tauri
cargo check
cargo build
cargo test
cd ..
```

Expected: 零 error；`ai_service.rs` 无需改代码（除非编译报错）。

- [ ] **Step 3: 手工 AI 验证**

`npm run tauri dev` 后：

1. 设置有效 API Key → AI 流式回复
2. 错误 Key → 前端可读错误
3. 设置页拉取 models 列表

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "$(cat <<'EOF'
chore(deps): upgrade reqwest to 0.13 with rustls feature (Phase 3)

Rename rustls-tls feature per reqwest 0.13 breaking change; ai_service unchanged.
EOF
)"
```

**D-1 完成点：** Task 1–3 全部通过 → 可开 PR `chore/deps-option-d-1`。

---

## Task 4: Phase 4 — Milkdown 7.21 + patch（D-2，可 skip）

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify/Create/Delete: `patches/@milkdown+components+*.patch`

- [ ] **Step 1: 检查 upstream 是否已修复 diagram-preview**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
npm install @milkdown/crepe@7.21.2 @milkdown/kit@7.21.2 @milkdown/react@7.21.2
# 临时移除 patch，测试 npm ci 后查看 node_modules/@milkdown/components/.../preview-panel.tsx
grep -n "diagram-preview" node_modules/@milkdown/components/src/code-block/view/components/preview-panel.tsx || true
```

若已有 `diagram-preview` appendChild 分支 → 跳 Step 3 删除 patch。

- [ ] **Step 2a: upstream 未修复 — 重打 patch**

```bash
# 手动编辑 node_modules/@milkdown/components/.../preview-panel.tsx（与 7.19.2 patch 相同逻辑）
npx patch-package @milkdown/components
mv patches/@milkdown+components+7.19.2.patch patches/@milkdown+components+7.21.2.patch
# 删除旧 patch 文件
rm patches/@milkdown+components+7.19.2.patch
npm ci
```

Expected: patch 成功。

- [ ] **Step 2b: 验证 diagram 单测**

```bash
npx vitest run src/components/__tests__/diagramCopy.test.ts src/components/plantuml-offline
```

Expected: 全绿。

- [ ] **Step 3: upstream 已修复 — 删除 patch**

```bash
rm patches/@milkdown+components+7.19.2.patch
# 若 patches/ 为空，评估移除 package.json postinstall 与 patch-package devDep
npm ci
```

- [ ] **Step 4: WYSIWYG / 分屏手工验证**

1. PlantUML 成功/错误视图 + 复制
2. Mermaid 块 zoom
3. 分屏与 WYSIWYG 错误 UI 一致

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json patches/
git commit -m "$(cat <<'EOF'
chore(deps): upgrade Milkdown to 7.21 and migrate components patch (Phase 4)
EOF
)"
```

**D-2 独立 PR，可与 D-1 并行或后续 merge。**

---

## Task 5: Phase 5 — 工具链 major（D-3）

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `vitest.config.ts`
- Modify: `tsconfig.node.json`
- Create: `tsconfig.vitest.json`

- [ ] **Step 1: 升级 Vite 8 + plugin-react 6**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
npm install -D vite@8.1.3 @vitejs/plugin-react@6.0.3
npm run build
```

若 build 失败且与 CJS 相关，临时在 `vite.config.ts` 加 `legacy: { inconsistentCjsInterop: true }` 排查，**不得**作为最终提交态。

- [ ] **Step 2: 更新 `vite.config.ts`**

```typescript
  server: {
    port: 3000,
    strictPort: true,
    host: host || false,
```

保留 `clearScreen: false`、`watch.ignored`、`TAURI_DEV_HOST` HMR 块不变。

- [ ] **Step 3: 合并 vitest 与 vite 配置**

`vitest.config.ts` 改为：

```typescript
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
    },
  })
);
```

若 `vite.config.ts` 的 `defineConfig(async () => ...)` 导致 merge 类型问题，改为同步 `export default defineConfig({...})` 或 duplicate 必要 `resolve` 块。

- [ ] **Step 4: 更新 `tsconfig.node.json`**

```json
  "include": ["vite.config.ts", "vitest.config.ts"]
```

- [ ] **Step 5: Vite 8 验证（TS 升级前）**

```bash
npm run dev
# 另终端
npm run tauri dev
npm run build
npx vitest run
```

手工：Mermaid 图 **含文字标签**；console 无 CJS interop 错误。

- [ ] **Step 6: 升级 TypeScript 6**

```bash
npm install -D typescript@~6.0.3
npx tsc --noEmit -p tsconfig.json
```

逐文件修复 TS 报错（重点见 spec §4 Phase 5 文件列表）。

- [ ] **Step 7: 创建 `tsconfig.vitest.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src"],
  "exclude": []
}
```

```bash
npx tsc --noEmit -p tsconfig.vitest.json
```

Expected: 零 error（含 `__tests__`）。

- [ ] **Step 8: 终验命令**

```bash
npx vitest run
npm run build
npm run tauri build
```

- [ ] **Step 9: Commit（可拆两个 commit：先 Vite 后 TS）**

```bash
git add package.json package-lock.json vite.config.ts vitest.config.ts tsconfig.node.json tsconfig.vitest.json src/
git commit -m "$(cat <<'EOF'
chore(deps): upgrade to Vite 8, plugin-react 6, and TypeScript 6 (Phase 5)

Set strictPort for Tauri devUrl; merge vitest with vite config; add tsconfig.vitest.json.
EOF
)"
```

---

## Task 6: Phase 6 — sharp dev patch

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: 升级 sharp**

```bash
npm install -D sharp@latest
npm run icons:svg
```

Expected: 生成 `src-tauri/icons/icon.svg`，无 native 模块错误。

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): bump sharp for icon generation scripts (Phase 6)
EOF
)"
```

---

## Task 7: Phase 7 — 全量回归

**Files:**
- Modify (可选): `AGENTS.md` — 若 dev 流程或端口说明有变

- [ ] **Step 1: 自动化矩阵**

```bash
cd d:/dev/workspaces/QCoder/NoteZ
npm ci
npx vitest run
npm run build
cd src-tauri && cargo test -- --nocapture
cd src-tauri && cargo test plan_fixture -- --nocapture
cd ..
npm run tauri build
```

Expected: 全部 pass；`npm ci` patch 成功。

- [ ] **Step 2: Windows 手工冒烟（spec §5.7.2）**

勾选：多标签、分屏 PlantUML/Mermaid、WYSIWYG、JAR+Rust 双后端、设置持久化、AI Channel、About 页、退出无 JVM 僵尸。

- [ ] **Step 3: 可选性能记录**

对比 `tasks/deps-option-d-baseline.txt`：`tauri build` 耗时 ±10%，冷启动劣化 ≤15%。

- [ ] **Step 4: 更新 AGENTS.md（若需要）**

若 `strictPort: true` 或 TS/Vite 版本约束变化，在 AGENTS.md Known Gotchas 补充一行。

- [ ] **Step 5: 最终 commit / PR**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
docs: note deps upgrade verification complete (Phase 7)
EOF
)"
```

开 PR：`chore/deps-option-d` → `main`，描述含 D-1/D-2/D-3 完成项与测试证据。

---

## Spec 覆盖自检

| Spec 章节 | 对应 Task |
|---|---|
| §0 D-1/D-2/D-3 拆分 | Task 1–3 / 4 / 5 |
| §1 升级清单 | Task 1–6 各 Step |
| §3 Phase 0 基线 | Task 0 |
| §4 Phase 1–6 | Task 1–6 |
| §5 Phase 7 回归 | Task 7 |
| §6 回滚 | Task 0 tag `deps-option-d-baseline` |
| §8 DoD | Task 7 Step 1–5 |

无 TBD / 占位符。

---

## 执行 handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-05-dependency-upgrade-option-d.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派发新 subagent，Task 间人工/代理 review  
2. **Inline Execution** — 本会话用 executing-plans 按 Task 0→7 连续执行，Phase 边界 checkpoint

**Which approach?**
