# 依赖升级方案 D — 完整工具链升级与修改验证方案

> **日期**: 2026-07-05（审核修订）  
> **状态**: 待执行  
> **策略**: D（激进 major）— 在保守/中等批次之上，推进 TypeScript 6、Vite 8、reqwest 0.13 等 major 升级  
> **前置**: 当前工程版本 0.2.0；Milkdown 7.19.2 + `patches/@milkdown+components+7.19.2.patch`  
> **平台**: Windows 为主验证平台（`apply_mica`、`window-vibrancy` 仅 Windows）；无 CI workflow，Phase 7 自动化命令等价本地 CI

---

## 0. 策略拆分（审核结论）

方案 D 在概念上包含 A+B+C+major，但**不应一次性捆绑执行**。拆分为三条可独立发版的线：

| 子策略 | 范围 | 优先级 | 说明 |
|---|---|---|---|
| **D-1** | Phase 1 + 2 + 3 | **推荐先做** | patch + Tauri 同步 + reqwest 0.13 |
| **D-2** | Phase 4 | 独立里程碑 | Milkdown 7.21 + patch 迁移（可 skip） |
| **D-3** | Phase 5 | 专项 1–2 周 | TS6 + Vite8 + plugin-react6（同 Phase 完成后再做 TS 终验） |

Phase 6（sharp 等）与 Phase 7（全量回归）在 D-1 或 D-3 完成后均需执行。

---

## 1. 升级范围清单

### 1.1 前端 major / 联动（P0，D-3）

| 包 | 当前 | 目标 | 类型 | peer / 约束 |
|---|---|---|---|---|
| `typescript` | ~5.8.3 | 6.x | major | — |
| `vite` | ^7.x | 8.x | major | `@types/node: ^20.19 \|\| >=22.12` |
| `@vitejs/plugin-react` | ^4.x | 6.x | major | **必须** `vite ^8.0.0` |

### 1.2 前端 minor / patch（P1）

| 包 | 当前 | 目标 | 备注 |
|---|---|---|---|
| `@milkdown/crepe`, `kit`, `react` | 7.19.2 | 7.21.x | D-2；需 patch 迁移 |
| `@tauri-apps/api` | 2.10.x | **2.11.x** | core，与 Rust `tauri` 同步 |
| `@tauri-apps/cli` | 2.10.x | **2.11.x** | 升级后执行 `tauri migrate` |
| `@tauri-apps/plugin-dialog` | 2.6.0 | **2.7.x** | 非 2.11，独立 semver |
| `@tauri-apps/plugin-fs` | 2.4.5 | **2.5.x** | 同上 |
| `@tauri-apps/plugin-opener` | 2.5.x | **2.5.x** latest | 同上 |
| `@tauri-apps/plugin-cli` | 2.4.1 | **2.4.x** latest | 同上 |
| `@codemirror/state`, `@codemirror/view` | 6.6 / 6.40 | latest 6.x | 与 `@uiw/codemirror-theme-*` 联动 |
| `tailwindcss`, `@tailwindcss/postcss` | 4.2.2 | 4.3.x | PostCSS 仅 `@tailwindcss/postcss` |
| `mermaid` | 11.13 | 11.16+ | Vite 8 CJS interop 敏感（`mermaidSingleton.ts`） |
| `react`, `react-dom` | 19.2.4 | 19.2.7+ | patch |
| `sharp` | 0.34.5 | 0.35.x | 仅 `scripts/generate-icon-svg.mjs` |
| `vitest`, `zustand`, `radix-ui`, `postcss`, `autoprefixer`, `jsdom`, `lucide-react` | 各落后 | latest 同 major | 低 risk |

### 1.3 Rust（P1）

| crate | 当前约束 / lock | 目标 | 类型 |
|---|---|---|---|
| `tauri`, `tauri-build` | 2.10.x | **2.11.x** | minor |
| `tauri-plugin-dialog` | 2.6.0 | **2.7.x** | 对齐 npm |
| `tauri-plugin-fs` | 2.4.5 | **2.5.x** | 对齐 npm |
| `tauri-plugin-opener` | `"2"` | latest 2.x | 对齐 npm |
| `tauri-plugin-cli` | `"2"` | latest 2.x | 对齐 npm |
| `tauri-plugin-single-instance` | `"2"` | latest 2.x | — |
| `tauri-plugin-window-state` | `"2"` | latest 2.x | — |
| `reqwest` | 0.12 | **0.13** | **major**；feature `rustls-tls` → **`rustls`** |
| `window-vibrancy` | 0.5 | **0.7.x** | 与 Phase 2 同批（`apply_mica`） |
| `chrono`, `serde_json` | 0.4.44 / 1.0.x | latest 同 major | Phase 1 patch |

### 1.4 npm ↔ Cargo 对照表（Phase 2 逐项 pin）

| 能力 | npm | Cargo.toml |
|---|---|---|
| Core | `@tauri-apps/api`, `@tauri-apps/cli` | `tauri`, `tauri-build` |
| Dialog | `@tauri-apps/plugin-dialog` | `tauri-plugin-dialog` |
| FS | `@tauri-apps/plugin-fs` | `tauri-plugin-fs` |
| Opener | `@tauri-apps/plugin-opener` | `tauri-plugin-opener` |
| CLI | `@tauri-apps/plugin-cli` | `tauri-plugin-cli` |
| 窗口状态 | —（前端无 npm 包） | `tauri-plugin-window-state` |
| 单实例 | — | `tauri-plugin-single-instance` |

### 1.5 不在本方案范围（YAGNI）

- `edition = "2024"` / Rust toolchain major 切换
- 移除 `patch-package`（除非 Milkdown 7.21 upstream 已吸收 diagram-preview 行为）
- MDXEditor 迁移或其它 WYSIWYG 替换
- Linux/macOS 交叉验证（本方案仅 Windows 手工冒烟）

---

## 2. 分阶段执行顺序（修订后）

```text
Phase 0  基线快照 + 分支 + tag
Phase 1  保守 patch（npm + cargo patch）— green baseline
Phase 2  Tauri core 2.11 + plugins 独立版本 + migrate + capabilities + window-vibrancy
Phase 3  reqwest 0.13（feature: rustls）+ ai_service
Phase 4  Milkdown 7.21 + patch 迁移（D-2，可 skip / 独立 PR）
Phase 5  TypeScript 6 + Vite 8 + @vitejs/plugin-react 6（D-3，同 Phase 完成）
Phase 6  sharp / 其余 dev patch
Phase 7  全量验证 + 打包 smoke
```

**原则**: 每 Phase 独立 commit；任一 Phase 失败则在该 Phase 内修复或回滚，不跨 Phase 堆叠未验证变更。

**TS 终验**: Phase 5 内先升 Vite 8 + plugin-react 6，再升 TS 6，最后在 Vite 8 环境下复跑 §4 Phase 5 全部检查（避免「TS6 在 Vite7 通过、Vite8 失败」的虚假 green）。

---

## 3. Phase 0 — 基线

### 3.1 操作

```bash
git checkout -b chore/deps-option-d
git tag deps-option-d-baseline   # 回滚锚点
npm ci                           # 触发 postinstall patch-package
cd src-tauri && cargo test -- --nocapture
cd .. && npx vitest run
npm run build
npm run tauri build              # 可选，Windows 打包耗时
```

### 3.2 记录基线

| 检查项 | 命令 | 通过标准 |
|---|---|---|
| patch 应用 | `npm ci` 输出 | 无 patch-package fail |
| 前端单测 | `npx vitest run` | 全部 pass |
| Rust 单测 | `cd src-tauri && cargo test` | 全部 pass（含 `plan_fixture`） |
| PlantUML fixture | `cd src-tauri && cargo test plan_fixture -- --nocapture` | 全部 pass |
| TS 编译 | `npm run build`（含 `tsc`） | 零 error |
| 生产构建 | `vite build` | 无失败 |

保存输出到 `tasks/deps-option-d-baseline.txt`（本地，不提交）。

---

## 4. 各 Phase 修改要点与验证

### Phase 1 — 保守 patch（D-1）

**修改（npm）** — 排除 `typescript`、`vite`、`@vitejs/plugin-react`、`@milkdown/*`、`@tauri-apps/*`：

```bash
# 示例：逐项升级，勿 blind npm update
npm install react@latest react-dom@latest tailwindcss@latest @tailwindcss/postcss@latest
npm install vitest@latest zustand@latest mermaid@latest lucide-react@latest
npm install @codemirror/state@latest @codemirror/view@latest
npm install @radix-ui/react-dialog@latest @radix-ui/react-tabs@latest
npm install postcss@latest autoprefixer@latest jsdom@latest
npm install @types/react@latest @types/react-dom@latest
```

**修改（Rust）**:

```bash
cd src-tauri
cargo update -p chrono -p serde_json
cargo test
```

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 1.1 | postinstall | `npm ci` | patch 成功 |
| 1.2 | 单测 | `npx vitest run` | 全绿 |
| 1.3 | Rust | `cargo test` | 全绿 |
| 1.4 | PlantUML Rust | `cargo test plan_fixture` | 全绿 |
| 1.5 | 构建 | `npm run build` | 成功 |

---

### Phase 2 — Tauri 双端同步 + window-vibrancy（D-1）

**修改**:

1. `package.json` — 按 §1.4 对照表 pin **各包 latest 2.x**（非统一 2.11）
2. `src-tauri/Cargo.toml` — 同步 plugin crate 版本
3. `npm install` + `cd src-tauri && cargo update -p tauri -p tauri-build`（及各 plugin）
4. 升级 CLI 后：`npm run tauri migrate`；diff `src-tauri/capabilities/default.json` 与 `tauri.conf.json`
5. `window-vibrancy` 0.5 → 0.7.x（`src-tauri/Cargo.toml` `[target.'cfg(windows)'.dependencies]`）

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 2.1 | migrate | `npm run tauri migrate` | 无报错；capabilities 合法 |
| 2.2 | 应用启动 | `npm run tauri dev` | 窗口正常、无 invoke 报错 |
| 2.3 | FS 插件 | 打开/保存 Markdown | 读写正常 |
| 2.4 | Dialog | 设置页、文件选择 | 正常弹出 |
| 2.5 | Opener | About → LICENSE 链接 | 系统浏览器打开 |
| 2.6 | CLI | `notez.exe <path.md>` | 正确打开文件 |
| 2.7 | 单实例 | 二次启动 | 聚焦已有窗口 |
| 2.8 | 窗口状态 | 调整大小后重启 | window-state 恢复 |
| 2.9 | 窗口透明 | Windows 启动 | `apply_mica` 视觉与升级前一致 |
| 2.10 | 系统字体 | 设置 → 字体列表 | `list_system_fonts` 有数据 |
| 2.11 | Channel IPC | AI 助手发一条消息 | `Channel` 流式 token/done（`aiService.ts`） |
| 2.12 | 打包 | `npm run tauri build` | 成功；permissions 无缺失 |

---

### Phase 3 — reqwest 0.13（D-1）

**修改**:

`src-tauri/Cargo.toml` — **必须**改 feature 名（reqwest 0.13 breaking change）:

```toml
# 旧（0.12）
# reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "socks", "rustls-tls"] }

# 新（0.13）
reqwest = { version = "0.13", default-features = false, features = ["json", "stream", "socks", "rustls"] }
```

说明（[reqwest CHANGELOG v0.13.0](https://github.com/seanmonstar/reqwest/blob/master/CHANGELOG.md)）:

- `rustls-tls` 重命名为 **`rustls`**
- `query` / `form` 为 opt-in feature；本工程未用 `.query()`/`.form()`，但 **`json` feature 必须保留**（`ai_list_models` 使用 `resp.json()`）

审阅 `src-tauri/src/ai_service.rs`: `Client::builder`, `Proxy::all`, `bytes_stream`, header API（改动面仅限此文件）。

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 3.1 | 编译 | `cargo check` | 零 error（先于 build） |
| 3.2 | 构建 | `cargo build` | 零 error |
| 3.3 | Rust 单测 | `cargo test` | 全绿 |
| 3.4 | AI 直连 | 有效 API Key，无代理 | 流式响应正常 |
| 3.5 | AI 代理 | system/custom 代理 | 连接成功或明确错误 |
| 3.6 | 无效 Key | 错误 Key | 前端可读错误，不 panic |
| 3.7 | 模型列表 | 设置页拉取 models | `ai_list_models` 正常 |

---

### Phase 4 — Milkdown 7.21 + patch（D-2，可 skip）

**修改**:

1. 升级 `@milkdown/crepe`, `kit`, `react` → 7.21.x
2. 检查 `@milkdown/components` 上游 `PreviewPanel` 是否已支持 `diagram-preview` appendChild
3. 若未合并：patch 重命名为 `patches/@milkdown+components+7.21.x.patch` 并 `patch-package` 重打
4. 若 upstream 已修复：删除 patch，评估移除 `postinstall: patch-package`

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 4.1 | postinstall | `npm ci` | patch 成功 |
| 4.2 | WYSIWYG | 含 PlantUML 代码块文档 | 编辑器正常 |
| 4.3 | PlantUML 成功 | 合法序列图 | SVG 正常 |
| 4.4 | PlantUML 错误 | 语法错误 | 错误视图 + 复制代码/图片 |
| 4.5 | Mermaid | ` ```mermaid ` 块 | 渲染与 zoom 正常 |
| 4.6 | 复制图片 | WYSIWYG 图块 | 剪贴板含 PNG/SVG |
| 4.7 | 分屏 PlantUML | 错误/成功 | 与 WYSIWYG 一致（`mountPlantUmlErrorView`） |

**自动化**: `npx vitest run src/components/__tests__/diagramCopy.test.ts src/components/plantuml-offline`

---

### Phase 5 — 工具链 major：Vite 8 + plugin-react 6 + TypeScript 6（D-3）

**修改顺序**（同 Phase 内）:

1. `vite` → 8.x，`@vitejs/plugin-react` → 6.x
2. 对照 [Vite 8 Migration](https://vite.dev/guide/migration) 更新配置
3. `typescript` → ~6.0.x
4. 可选：`tsconfig.vitest.json` 或在 Phase 7 用 vitest 覆盖测试类型

**`vite.config.ts` 必改项**:

```ts
server: {
  port: 3000,
  strictPort: true,   // 原 false；Tauri devUrl 硬编码 3000（见 AGENTS.md）
  // ...
}
```

保留: `clearScreen: false`、`watch.ignored: ['**/src-tauri/**']`、`TAURI_DEV_HOST` HMR 逻辑。

**Vite 8 专项风险**（Rolldown + Oxc 替代 esbuild/Rollup）:

- CJS default import 语义变更 → 影响 `import mermaid from 'mermaid'`（`mermaidSingleton.ts`）
- 可选中间步骤：先 `rolldown-vite@7.2.2` 再升 Vite 8（见官方 Migration Guide）
- 若 build 失败：临时 `legacy.inconsistentCjsInterop: true` 排查，不作为最终态

**Vitest 配置**:

- `vitest@4.x` peer 支持 Vite 8
- 若 dev/build 与 test 的 `resolve` 不一致，让 `vitest.config.ts` merge `vite.config.ts`
- `tsconfig.node.json` 增加 `"vitest.config.ts"`

**TypeScript 6 重点文件**:

- `src/components/plantuml-offline/*`
- `src/components/diagramCopy.ts`, `diagramRenderers.ts`, `mermaidSingleton.ts`
- `src/components/aiService.ts`, `FileOperations.ts`
- `src/components/WysiwygEditor.tsx`, `MarkdownEditor.tsx`
- `src/store/useSettingsStore.ts`

**验证**（Vite 8 落地后执行全部；TS 6 在最后子步骤复验）:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 5.1 | Dev server | `npm run dev` | localhost:3000 |
| 5.2 | Tauri dev | `npm run tauri dev` | HMR 正常 |
| 5.3 | 生产构建 | `npm run build` | `dist/` 完整 |
| 5.4 | Tauri build | `npm run tauri build` | Windows 包成功 |
| 5.5 | Mermaid 标签 | 分屏/WYSIWYG Mermaid 图 | SVG **含文字节点**（非空形状） |
| 5.6 | CJS 产物 | 启动后 console | 无 CJS interop 报错 |
| 5.7 | 资源/主题 | 设置页、主题切换 | 无 404 / blank |
| 5.8 | Fast Refresh | 改 React 组件 | 无 reload 循环 |
| 5.9 | TS 生产代码 | `npx tsc --noEmit -p tsconfig.json` | 零 error |
| 5.10 | TS 测试代码 | `npx tsc --noEmit -p tsconfig.vitest.json`（若已建） | 零 error |
| 5.11 | 单测 | `npx vitest run` | 全绿 |

---

### Phase 6 — sharp 等 dev patch

**修改**:

- `sharp` 0.34 → 0.35（devDependency）
- 其余 dev 依赖按需 patch

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 6.1 | 图标脚本 | `npm run icons:svg` | 无 native 模块错误 |
| 6.2 | potrace CJS | 脚本内 `import potrace from 'potrace'` | trace 成功输出 SVG |

---

## 5. Phase 7 — 全量回归矩阵

### 7.1 自动化（本地 CI 等价）

```bash
npm ci                    # 必须验证 patch-package 成功
npx vitest run
npm run build
cd src-tauri && cargo test -- --nocapture
cd src-tauri && cargo test plan_fixture -- --nocapture
cd .. && npm run tauri build
```

### 7.2 手工冒烟（Windows）

| 模块 | 检查点 |
|---|---|
| 编辑器 | 多标签打开/关闭/未保存提示 |
| 分屏预览 | Markdown、PlantUML、Mermaid |
| WYSIWYG | Crepe 切换、代码块、图表工具栏 |
| PlantUML JAR | 默认 JAR 渲染；退出应用无僵尸 JVM（PicoWeb shutdown） |
| PlantUML Rust | 设置切换实验引擎；fixture 级序列图 |
| 设置 | 字体列表、主题、PlantUML 后端、AI 配置持久化 |
| AI 助手 | Channel 流式、取消、错误态、代理 |
| 关于页 | 版本 0.2.0、LICENSE 链接 |

### 7.3 性能与体积（可选）

| 指标 | 方法 | 通过标准 |
|---|---|---|
| `tauri build` 耗时 | 对比 Phase 0 baseline | ±10% |
| 安装包体积 | 对比 baseline | 显著增大需说明 |
| 冷启动 | 3 次均值 | 劣化 ≤15% |

---

## 6. 回滚策略

| 失败 Phase | 回滚方式 |
|---|---|
| 任意 | `git revert` 该 Phase commit，或 `git reset --hard deps-option-d-baseline` |
| npm | 恢复 `package.json` + `package-lock.json` → `npm ci` |
| Rust | 恢复 `Cargo.toml` + `Cargo.lock` → `cargo build` |
| Milkdown patch | 恢复旧 lock + 旧 patch 文件名 |

---

## 7. 风险登记与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| reqwest `rustls-tls` 未改名导致编译失败 | 高 | 高 | Phase 3 写死 `rustls` feature |
| Vite 8 Rolldown/CJS 破坏 mermaid | 中 | 高 | Phase 5.5/5.6；可选 rolldown-vite 中间步 |
| TS 6 在 Vite 7 下虚假通过 | 中 | 中 | TS 终验在 Vite 8 之后 |
| TS 6 测试代码未覆盖 | 中 | 中 | `tsconfig.vitest.json` 或 vitest typecheck |
| Tauri 插件 npm/Cargo 版本漂移 | 中 | 高 | §1.4 对照表逐项 pin |
| capabilities 权限缺失 | 中 | 高 | Phase 2 `tauri migrate` + build |
| Milkdown patch 无法应用 | 中 | 高 | D-2 独立 PR；查 upstream |
| strictPort false 端口漂移 | 低 | 高 | Phase 5 改 `strictPort: true` |
| sharp 原生模块 Windows | 低 | 中 | Phase 6 单独验证 icons |
| major 与 patch 捆绑回滚成本高 | 中 | 中 | 遵循 D-1/D-2/D-3 拆分 |

---

## 8. 完成定义（Definition of Done）

- [ ] D-1（Phase 1–3）验证表全部通过 — **可独立 merge**
- [ ] D-2（Phase 4）若执行则验证通过 — **可独立 merge**
- [ ] D-3（Phase 5）验证表全部通过，且 TS 检查在 Vite 8 环境下完成
- [ ] Phase 6–7 在目标 release 前完成
- [ ] Phase 7 自动化命令全绿（含 `npm ci` patch）
- [ ] Phase 7 手工冒烟已勾选（Windows）
- [ ] `AGENTS.md` / README dev 命令仍有效
- [ ] PR 描述含 major 升级说明与测试证据

---

## 9. 参考

- 依赖评估与审核报告（2026-07-05）
- `docs/superpowers/specs/2026-07-03-milkdown-toolbar-governance-design.md`
- `AGENTS.md` — postinstall、Vite 3000、PlantUML 契约、PicoWeb shutdown
- [Vite 8 Migration](https://vite.dev/guide/migration)
- [TypeScript 6.0 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [reqwest CHANGELOG](https://github.com/seanmonstar/reqwest/blob/master/CHANGELOG.md)
- [window-vibrancy apply_mica 0.7](https://docs.rs/window-vibrancy/0.7.1/window_vibrancy/fn.apply_mica.html)
- [Tauri migrate CLI](https://v2.tauri.app/start/migrate/from-tauri-2-beta/)
