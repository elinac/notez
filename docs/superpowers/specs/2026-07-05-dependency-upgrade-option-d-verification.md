# 依赖升级方案 D — 完整工具链升级与修改验证方案

> **日期**: 2026-07-05  
> **状态**: 待执行  
> **策略**: D（激进 major）— 在保守/中等批次之上，同步推进 TypeScript 6、Vite 8、reqwest 0.13 等 major 升级  
> **前置**: 当前工程版本 0.2.0；Milkdown 7.19.2 + `patches/@milkdown+components+7.19.2.patch`

---

## 1. 升级范围清单

### 1.1 前端 major / 联动（P0）

| 包 | 当前 | 目标 | 类型 |
|---|---|---|---|
| `typescript` | ~5.8.3 | 6.x | major |
| `vite` | ^7.x | 8.x | major |
| `@vitejs/plugin-react` | ^4.x | 6.x | major（需与 Vite 8 对齐） |

### 1.2 前端 minor / patch（P1，与 major 同批或紧接）

| 包 | 当前 | 目标 | 备注 |
|---|---|---|---|
| `@milkdown/crepe`, `kit`, `react` | 7.19.2 | 7.21.x | 需 patch 迁移 |
| `@tauri-apps/api`, `cli` | 2.10.x | 2.11.x | 与 Rust 同步 |
| `@tauri-apps/plugin-dialog/fs/opener/cli` | 各落后 1 minor | latest 2.x | npm 与 Cargo 对齐 |
| `@codemirror/state`, `@codemirror/view` | 6.6 / 6.40 | latest 6.x | 编辑器回归 |
| `tailwindcss`, `@tailwindcss/postcss` | 4.2.2 | 4.3.x | 样式回归 |
| `mermaid` | 11.13 | 11.16+ | 图表预览 |
| `react`, `react-dom` | 19.2.4 | 19.2.7+ | patch |
| `sharp` | 0.34.5 | 0.35.x | `npm run icons` |
| `vitest`, `zustand`, `radix-ui`, `postcss`, `autoprefixer`, `jsdom`, `lucide-react` | 各落后 | latest 同 major | 低 risk |

### 1.3 Rust（P1）

| crate | 当前约束 / lock | 目标 | 类型 |
|---|---|---|---|
| `tauri`, `tauri-build` | 2.10.x | 2.11.x | minor |
| `tauri-plugin-*` | 各固定或 `"2"` | 与 npm 插件一致 | minor |
| `reqwest` | 0.12 | 0.13 | **major** |
| `window-vibrancy` | 0.5 | 0.7.x | minor~major |
| `chrono`, `serde_json` | 0.4.44 / 1.0.x | latest 同 major | patch |

### 1.4 不在本方案范围（YAGNI）

- `edition = "2024"` / Rust toolchain major 切换
- 移除 `patch-package`（除非 Milkdown 7.21 upstream 已吸收 diagram-preview 行为）
- MDXEditor 迁移或其它 WYSIWYG 替换

---

## 2. 分阶段执行顺序

```text
Phase 0  基线快照 + 分支
Phase 1  保守 patch（React/Tailwind/Vitest/Rust patch）— 建立 green baseline
Phase 2  Tauri 2.11 双端同步
Phase 3  Milkdown 7.21 + patch 迁移
Phase 4  reqwest 0.13 + ai_service 适配
Phase 5  TypeScript 6
Phase 6  Vite 8 + @vitejs/plugin-react 6
Phase 7  window-vibrancy / sharp 等剩余项
Phase 8  全量验证 + 打包 smoke
```

**原则**: 每 Phase 独立 commit；任一 Phase 失败则在该 Phase 内修复或回滚，不跨 Phase 堆叠未验证变更。

---

## 3. Phase 0 — 基线

### 3.1 操作

```bash
git checkout -b chore/deps-option-d
npm ci
cd src-tauri && cargo test -- --nocapture
cd .. && npx vitest run
npm run build
npm run tauri build   # 可选，Windows 打包耗时
```

### 3.2 记录基线

| 检查项 | 命令 | 通过标准 |
|---|---|---|
| 前端单测 | `npx vitest run` | 全部 pass |
| Rust 单测 | `cd src-tauri && cargo test` | 全部 pass |
| TS 编译 | `npm run build`（含 `tsc`） | 零 error |
| 生产构建 | `vite build` | 无 warning 级失败 |

保存输出到 `tasks/deps-option-d-baseline.txt`（本地，不提交）。

---

## 4. 各 Phase 修改要点与验证

### Phase 1 — 保守 patch

**修改**: `npm update` 限定 patch/minor（排除 ts/vite/milkdown/tauri major）。

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 1.1 | 单测 | `npx vitest run` | 全绿 |
| 1.2 | Rust | `cargo test` | 全绿 |
| 1.3 | 构建 | `npm run build` | 成功 |

---

### Phase 2 — Tauri 2.11 双端同步

**修改**:

- `package.json`: `@tauri-apps/api`, `cli`, 各 `plugin-*` → 2.11 对齐版本
- `src-tauri/Cargo.toml`: `tauri`, `tauri-build`, `tauri-plugin-*` → crates.io 最新 2.x
- `npm install` + `cargo update -p tauri -p tauri-build`（及插件 crate）

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 2.1 | 应用启动 | `npm run tauri dev` | 窗口正常、无 invoke 报错 |
| 2.2 | FS 插件 | 打开/保存 Markdown 文件 | 读写正常 |
| 2.3 | Dialog | 设置页、文件选择对话框 | 正常弹出 |
| 2.4 | Opener | 设置 About → 打开 LICENSE 链接 | 系统浏览器打开 |
| 2.5 | CLI | `notez.exe <path>` 传入文件路径 | 正确打开文件 |
| 2.6 | 单实例 | 二次启动应用 | 聚焦已有窗口 |
| 2.7 | 窗口状态 | 调整大小后重启 | 尺寸/位置恢复（window-state） |

---

### Phase 3 — Milkdown 7.21 + patch

**修改**:

1. 升级 `@milkdown/crepe`, `kit`, `react` → 7.21.x
2. 检查 `@milkdown/components` 上游 `PreviewPanel` 是否已支持 `diagram-preview` appendChild
3. 若未合并：将 `patches/@milkdown+components+7.19.2.patch` 重命名为 `7.21.x` 并 `patch-package` 重打
4. 若 upstream 已修复：删除 patch，评估移除 `postinstall: patch-package`

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 3.1 | postinstall | `npm ci` | patch 成功应用，无 fail |
| 3.2 | WYSIWYG 编辑 | 打开含 PlantUML 代码块的文档 | 编辑器正常 |
| 3.3 | PlantUML 成功渲染 | 合法 `@startuml` 序列图 | 预览区 SVG 正常 |
| 3.4 | PlantUML 错误 | 故意语法错误 | 错误视图 + 复制代码/图片 |
| 3.5 | Mermaid 块 | ` ```mermaid ` 块 | 渲染与 zoom 正常 |
| 3.6 | 复制图片 | WYSIWYG 图块 → 复制图片 | 剪贴板含 PNG/SVG |
| 3.7 | 分屏 PlantUML | 分屏模式错误/成功 | 与 WYSIWYG 错误 UI 一致（`mountPlantUmlErrorView`） |

**自动化**: `npx vitest run src/components/__tests__/diagramCopy.test.ts src/components/plantuml-offline`

---

### Phase 4 — reqwest 0.13

**修改**:

- `Cargo.toml`: `reqwest = { version = "0.13", ... }`（核对 0.13 feature 名：`json`, `stream`, `socks`, `rustls-tls` 是否仍有效）
- 审阅 `src-tauri/src/ai_service.rs`: `Client::builder`, `Proxy::all`, streaming, header API

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 4.1 | 编译 | `cargo build` | 零 error |
| 4.2 | Rust 单测 | `cargo test` | 全绿 |
| 4.3 | AI 直连 | 设置有效 API Key，无代理，发一条消息 | 流式响应正常 |
| 4.4 | AI 代理 | `proxy_mode=system/custom`，配置 SOCKS/HTTP 代理 | 连接成功或明确错误信息 |
| 4.5 | 无效 Key | 错误 Key | 前端展示可读错误，不 panic |

---

### Phase 5 — TypeScript 6

**修改**:

- `package.json`: `"typescript": "~6.0.x"`
- 阅读 [TS 6 breaking changes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- 重点文件: `src/components/plantuml-offline/*`, `diagramCopy.ts`, Milkdown 集成, `zustand` stores

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 5.1 | 类型检查 | `npx tsc --noEmit` | 零 error |
| 5.2 | 构建 | `npm run build` | 成功 |
| 5.3 | 单测 | `npx vitest run` | 全绿 |
| 5.4 | IDE | 打开 `HeadingDropdown.tsx`, `PlantUMLRenderer.tsx` | 无新增类型红线 |

---

### Phase 6 — Vite 8 + plugin-react 6

**修改**:

- `vite` → 8.x，`@vitejs/plugin-react` → 6.x
- 对照 Vite 8 [Migration Guide](https://vite.dev/guide/migration) 更新 `vite.config.ts`
- 确认: `server.port: 3000`（Tauri `devUrl` 硬编码）、`clearScreen: false`、`ignored: src-tauri`
- 确认 `tsconfig.node.json` 与 Vite 8 兼容

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 6.1 | Dev server | `npm run dev` | localhost:3000 可访问 |
| 6.2 | Tauri dev | `npm run tauri dev` | 前后端联调正常，HMR 生效 |
| 6.3 | 生产构建 | `npm run build` | `dist/` 产物完整 |
| 6.4 | Tauri build | `npm run tauri build` | Windows 安装包/可执行文件生成 |
| 6.5 | 资源加载 | 启动后浏览各设置页、主题切换 | 无 404、无 blank screen |
| 6.6 | Fast Refresh | 修改任意 React 组件保存 | 热更新无 full reload 循环 |

---

### Phase 7 — window-vibrancy / sharp

**修改**:

- `window-vibrancy` 0.5 → 0.7（Windows 透明窗口）
- `sharp` 0.34 → 0.35（devDependency）

**验证**:

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| 7.1 | 窗口透明 | Windows 启动应用 | 标题栏/背景 vibrancy 与升级前视觉一致 |
| 7.2 | 图标脚本 | `npm run icons:svg` 或 `npm run icons` | 无 native 模块加载错误 |

---

## 5. Phase 8 — 全量回归矩阵

### 5.1 自动化（CI 等价）

```bash
npm ci
npx vitest run
npm run build
cd src-tauri && cargo test -- --nocapture
cd .. && npm run tauri build
```

### 5.2 手工冒烟（Windows 主平台）

| 模块 | 检查点 |
|---|---|
| 编辑器 | 多标签打开/关闭/未保存提示 |
| 分屏预览 | Markdown 渲染、PlantUML、Mermaid |
| WYSIWYG | Crepe 切换、代码块、图表工具栏 |
| PlantUML 双后端 | JAR 默认 + Rust 实验引擎（设置中切换） |
| 设置 | 字体、主题、PlantUML 后端、AI 配置持久化 |
| AI 助手 | 流式对话、取消、错误态 |
| 关于页 | 版本号 0.2.0、LICENSE 链接 |

### 5.3 性能与体积（可选记录）

| 指标 | 方法 | 记录 |
|---|---|---|
| `tauri build` 耗时 | 对比 Phase 0 baseline | ±10% 内可接受 |
| 安装包体积 | 对比 baseline | 显著增大需说明原因 |
| 冷启动 | 秒表 3 次均值 | 无劣化 >15% |

---

## 6. 回滚策略

| 失败 Phase | 回滚方式 |
|---|---|
| 任意 | `git revert` 该 Phase 的 commit，或 `git reset --hard` 到 Phase 开始前 tag |
| npm 依赖 | 恢复 `package.json` + `package-lock.json`，`npm ci` |
| Rust | 恢复 `Cargo.toml` + `Cargo.lock`，`cargo build` |
| Milkdown patch | 保留旧版 lock + patch 文件名版本 |

建议在 Phase 0 打 tag: `deps-option-d-baseline`.

---

## 7. 风险登记与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| TS 6 严格模式新报错 | 高 | 中 | Phase 5 独立分支，逐文件修复 |
| Vite 8 破坏 Tauri HMR | 中 | 高 | 对照 Tauri 官方 Vite 模板；保留 port 3000 |
| Milkdown patch 无法应用 | 中 | 高 | 优先查 upstream；必要时 DOM 层 workaround |
| reqwest 0.13 API 变更 | 中 | 中 | 限改动 `ai_service.rs`；补集成测试 |
| sharp 原生模块 Windows 构建 | 低 | 中 | 锁定 sharp 版本；icons 脚本单独验证 |
| Tauri 插件版本不一致 | 中 | 高 | Phase 2 表格逐项对齐 npm ↔ Cargo |

---

## 8. 完成定义（Definition of Done）

- [ ] Phase 1–7 各 Phase 验证表全部通过
- [ ] Phase 8 自动化命令全绿
- [ ] Phase 8 手工冒烟矩阵已勾选（Windows）
- [ ] `AGENTS.md` / README 中 dev 命令仍有效（若 Vite/TS 命令有变则更新文档）
- [ ] 无新增 `patch-package` 失败或 CI 红灯
- [ ] 变更以 PR 提交，描述含 major 升级说明与测试证据

---

## 9. 参考

- 依赖评估对话（2026-07-05）：策略 A/B/C/D 分档
- `docs/superpowers/specs/2026-07-03-milkdown-toolbar-governance-design.md` — patch 治理
- `AGENTS.md` — postinstall、Vite 3000、PlantUML 契约
- [Vite 8 Migration](https://vite.dev/guide/migration)
- [reqwest CHANGELOG](https://github.com/seanmonstar/reqwest/blob/master/CHANGELOG.md)
