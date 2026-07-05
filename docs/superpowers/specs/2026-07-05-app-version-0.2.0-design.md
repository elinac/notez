# NoteZ 0.2.0 版本发布 — 版本统一、关于页与 CHANGELOG

> **日期**: 2026-07-05  
> **状态**: 已实现  
> **Brainstorming 结论**: 用户确认方案 1（`package.json` 单一来源）+ Tauri `getVersion()` 运行时读取 + 设置页「关于」分类 + git log 自动生成 CHANGELOG + `v0.2.0` tag

---

## 1. 背景

### 1.1 当前状态

| 位置 | 版本 |
|------|------|
| `package.json` | **0.2.0**（已提交） |
| `package-lock.json` | **0.2.0** |
| `src-tauri/Cargo.toml` | **0.1.0** |
| `src-tauri/tauri.conf.json` | **0.1.0** |
| `src-tauri/Cargo.lock`（notez 包） | **0.1.0** |

- 无 git tag
- 无 `CHANGELOG.md`
- 设置对话框无「关于」入口，应用内不展示版本号

### 1.2 目标

1. 全仓库应用版本统一为 **0.2.0**
2. **单一写入点**：今后发版只改 `package.json` 的 `version`
3. 设置对话框新增 **「关于」** 页，运行时显示版本号
4. 自动生成 **CHANGELOG.md**（基于 git log）
5. 打 annotated tag **`v0.2.0`**

---

## 2. 版本同步机制

### 2.1 单一来源

**`package.json` 的 `version` 字段为唯一人工写入点。**

```
package.json (version)
    ↓ scripts/sync-version.mjs
    ├── src-tauri/Cargo.toml          (version = "...")
    ├── src-tauri/tauri.conf.json     ("version": "...")
    └── src-tauri/Cargo.lock          (cargo check 更新 notez 包版本)
```

发版时另需确认 **`package-lock.json`** 根级 `version` 与 `packages[""].version` 与 `package.json` 一致（`npm install` 或手动 bump 后自动对齐）。

### 2.2 `scripts/sync-version.mjs`

职责：

1. 读取 `package.json` 的 `version`
2. 用正则替换 `src-tauri/Cargo.toml` 中 `[package]` 下的 `version = "..."`（仅首段 `[package]`，避免误改依赖）
3. 用 JSON 解析替换 `src-tauri/tauri.conf.json` 的 `version` 字段
4. 在 `src-tauri/` 下执行 `cargo check -q` 以刷新 `Cargo.lock`
5. 若三处版本已与目标一致则 no-op（幂等）
6. stdout 打印 `Synced version to X.Y.Z`

**可测试性**：从 `sync-version.mjs` **export** 纯函数 `applyVersionToCargoToml(content, version)` 与 `applyVersionToTauriConf(conf, version)`，供 Vitest 直接 import `.mjs` 单测。

约束：

- 使用 Node ESM（与现有 `scripts/*.mjs` 一致）
- 不依赖第三方 npm 包
- 版本号格式校验：`/^\d+\.\d+\.\d+$/`（SemVer 三段，不含 prerelease）

### 2.3 npm scripts

在 `package.json` 增加：

```json
{
  "scripts": {
    "version:sync": "node scripts/sync-version.mjs",
    "prebuild": "npm run version:sync",
    "changelog": "node scripts/generate-changelog.mjs"
  }
}
```

- `prebuild` 确保 `npm run build` 与 `npm run tauri build`（其 `beforeBuildCommand` 为 `npm run build`）前自动同步
- **`npm run tauri dev` 不触发 `prebuild`**（`beforeDevCommand` 为 `npm run dev`）。每次 bump `package.json` 版本后须**手动**执行 `npm run version:sync`，否则 `getVersion()` 在 dev 中仍读旧的 `tauri.conf.json`

### 2.4 本次 0.2.0 同步

实现时执行一次 `npm run version:sync`，将 Rust/Tauri 侧从 `0.1.0` 升至 `0.2.0`（`package.json` 已是 0.2.0，脚本应幂等完成其余文件）。

---

## 3. 运行时版本读取

### 3.1 `src/hooks/useAppVersion.ts`

```typescript
export function useAppVersion(): {
  version: string;
  loading: boolean;
  error: string | null;
};
```

逻辑：

1. **Tauri 环境**：复用工程既有 `import { isTauri } from '../components/FileOperations'`（检测 `__TAURI_INTERNALS__`，与全项目一致）
2. Tauri 下调用 `@tauri-apps/api/app` 的 `getVersion()`，返回值与 `tauri.conf.json` / 安装包一致
3. **`getVersion()` 失败**：回退 `package.json` 的 `version`，`error` 设为简短提示（如 `'无法读取 Tauri 版本，已回退 package.json'`）
4. **非 Tauri（浏览器 dev）**：直接读 `package.json`（`import pkg from '../../package.json'`，`tsconfig` 已启用 `resolveJsonModule`）
5. 加载中 `loading: true`，完成后 `loading: false`

### 3.2 为何不用 Vite 注入

Brainstorming 选定 Tauri API 为桌面权威来源；dev 回退 `package.json` 即可，无需额外 `vite.config.ts` define。

---

## 4. 关于页 UI

### 4.1 入口

在设置对话框侧边栏新增第四项 **「关于」**（`SettingsCategory` 扩展为 `'appearance' | 'ai' | 'plantuml' | 'about'`）。

| 文件 | 变更 |
|------|------|
| `settingsTypes.ts` | 增加 `'about'` |
| `settingsTypes.ts` 或 `settingsLabels.ts` | 新增 `CATEGORY_LABELS: Record<SettingsCategory, string>` |
| `SettingsSidebar.tsx` | 增加 `Info` 图标 + 「关于」按钮 |
| `SettingsDialog.tsx` | 用 `CATEGORY_LABELS[category]` 替换嵌套三元；渲染 `AboutSettings` |
| `AboutSettings.tsx` | **新建** |

### 4.2 `AboutSettings` 内容

| 区块 | 内容 |
|------|------|
| 应用名 | **NoteZ**（UI 固定；不用 `getName()`，因 `productName` 为 `"notez"`） |
| 版本 | `v{version}`，来自 `useAppVersion()`；loading 时显示 `…` |
| 许可证 | 文案 **Apache-2.0**；按钮「查看许可证」 |
| 第三方组件 | 一句摘要（PlantUML JRE、Graphviz、Mermaid 等）；按钮「查看第三方声明」 |
| 版权 | `© 2026 NoteZ Contributors`（与 `Cargo.toml` authors 一致） |

样式：与现有 `AppearanceSettings` 等保持一致（`text-xs` / `text-sm`、gray 色阶、蓝色链接按钮）。

### 4.3 打开许可证与第三方声明

**打包资源**：在 `tauri.conf.json` 的 `bundle.resources` 数组中追加：

```json
"resources": [
  "resources/plantuml-runtime/",
  "../LICENSE",
  "../THIRD_PARTY_NOTICES.md"
]
```

**Tauri 运行时**（路径须与 `bundle.resources` 配置**完全一致**，见 [Tauri Resources — Path syntax](https://v2.tauri.app/develop/resources/)）：

1. `resolveResource('../LICENSE')` / `resolveResource('../THIRD_PARTY_NOTICES.md')`
2. `@tauri-apps/plugin-opener` 的 `openPath(path)` 用系统默认应用打开
3. **`openPath` 失败**：在按钮旁显示 `text-red-500 text-[10px]` 错误提示，不 silent fail

**Capabilities**（`src-tauri/capabilities/default.json`）追加：

```json
{
  "identifier": "opener:allow-open-path",
  "allow": [{ "path": "$RESOURCE/**/*" }]
}
```

现有 `opener:default` **不包含**对 bundle 资源的 `openPath` 权限，必须显式添加上述 scope。

**浏览器 dev 回退**：

- 不调用 opener；「查看许可证」「查看第三方声明」按钮 **disabled**，`title="仅在 Tauri 桌面应用中可用"`
- 关于页底部一行灰色提示：`完整许可证与第三方声明见仓库根目录 LICENSE、THIRD_PARTY_NOTICES.md`

### 4.4 图标

侧边栏使用 `lucide-react` 的 `Info` 图标（与现有 Monitor / Sparkles / FileCode 一致）。

---

## 5. CHANGELOG 自动生成

### 5.1 `scripts/generate-changelog.mjs`

行为：

1. 接受可选参数 `--from <tag>`（默认：无 tag 时从首 commit）
2. 接受可选参数 `--to <ref>`（默认：`HEAD`）
3. 接受可选参数 `--version <semver>`（默认：读 `package.json` 的 `version`）
4. 执行 `git log --pretty=format:%s|%h|%ad --date=short <range>`
5. 跳过 subject 以 `Merge` 开头的行
6. 按 Conventional Commits 前缀分组：
   - `feat` → **Features**
   - `fix` → **Bug Fixes**
   - `docs` → **Documentation**
   - `test` → **Tests**
   - `refactor` / `chore` / `style` / 其他 → **Other**
7. 写入或更新 `CHANGELOG.md`：
   - 新条目 **prepend** 到文件顶部（Keep a Changelog 风格）
   - 标题：`## [{version}] - {date}`，其中 **date = 该 range 内最新 commit 的 `--date=short`**（非脚本运行日）
   - 保留历史条目（若文件已存在）

### 5.2 本次 0.2.0

- 运行 `npm run changelog` 生成首版
- 当前仓库约 40 个 commit、无 tag，范围 = 全部历史
- 生成后人工快速扫一眼，必要时删去纯 meta 条目（如本次 spec 自身的 docs commit）

### 5.3 不在 CI 中自动跑

CHANGELOG 生成作为**发版手动步骤**，与 `version:sync` + tag 同属 release checklist。

---

## 6. Git Tag

实现并提交全部变更后：

```powershell
git tag -a v0.2.0 -m "NoteZ 0.2.0"
```

- 使用 **annotated tag**（非 lightweight）
- Tag message 一行摘要即可；详情见 CHANGELOG
- **不自动 push**；由用户决定 `git push origin v0.2.0`

---

## 7. 测试

| 测试 | 文件 | 断言 |
|------|------|------|
| sync-version 纯函数 | `src/utils/__tests__/syncVersion.test.ts`（import `scripts/sync-version.mjs` 导出） | `applyVersionToCargoToml` / `applyVersionToTauriConf` 正确替换 |
| useAppVersion Tauri | `src/hooks/__tests__/useAppVersion.test.ts` | mock `getVersion` → 返回 `0.2.0` |
| useAppVersion 回退 | 同上 | 无 Tauri → 返回 package.json 版本 |
| useAppVersion 错误回退 | 同上 | `getVersion` reject → 回退 package.json + `error` 非 null |
| AboutSettings 渲染 | `src/components/settings/__tests__/AboutSettings.test.tsx` | 显示 `NoteZ`、`v0.2.0`、Apache-2.0 文案 |

不要求对 `generate-changelog.mjs` 写单测（纯 git 依赖；手动验证即可）。

---

## 8. 发版 Checklist（0.2.0）

1. [ ] 确认 `package.json` version = `0.2.0`
2. [ ] 确认 `package-lock.json` 根级 version 一致
3. [ ] `npm run version:sync`（**dev 前亦须执行**，不仅 build 前）
4. [ ] 实现关于页 + hook
5. [ ] 更新 `tauri.conf.json` bundle resources
6. [ ] 更新 `src-tauri/capabilities/default.json` opener scope
7. [ ] `npm run changelog`
8. [ ] `npm run test` 通过
9. [ ] `npm run tauri build` 验证安装包版本为 0.2.0
10. [ ] 提交所有变更
11. [ ] `git tag -a v0.2.0 -m "NoteZ 0.2.0"`

---

## 9. 不在范围内

- 应用内自动更新（Tauri updater）
- README 版本号段落（README 描述环境要求，非应用版本）
- 修改 `useAppStore` persist 的 `version: 1`（数据迁移版本，与应用版本无关）
- npm publish（`private: true`）
- 关于页内嵌全文展示 LICENSE（采用 `openPath`；后续可改 `readTextFile` + 页内 modal）

---

## 10. 未来发版流程

1. 修改 `package.json` 的 `version`（如 `0.3.0`）
2. `npm run version:sync`（立即执行，勿等 build）
3. 确认 `package-lock.json` version 一致
4. 开发功能…
5. `npm run changelog -- --from v0.2.0`
6. 提交 + `git tag -a v0.3.0 -m "NoteZ 0.3.0"`

单一来源 + prebuild 同步，避免再次出现 npm / Rust / Tauri 版本不一致。
