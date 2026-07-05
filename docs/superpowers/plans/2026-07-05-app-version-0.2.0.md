# NoteZ 0.2.0 版本发布 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将应用版本统一为 0.2.0（`package.json` 单一来源），在设置页新增「关于」页展示运行时版本，自动生成 CHANGELOG，并打 `v0.2.0` tag。

**Architecture:** `scripts/sync-version.mjs` 在 `prebuild` 时将 `package.json` version 同步至 Cargo.toml / tauri.conf.json / Cargo.lock；`useAppVersion` 在 Tauri 下调用 `getVersion()`（失败回退 package.json），浏览器 dev 直接读 package.json；关于页通过 `resolveResource('../LICENSE')` + `openPath` 打开 bundle 资源（capabilities 需 `$RESOURCE/**/*` scope）。

**Tech Stack:** Node ESM scripts, React 19 hooks, Vitest + Testing Library, Tauri 2 (`@tauri-apps/api/app`, `@tauri-apps/api/path`, `@tauri-apps/plugin-opener`)

**Spec 文档:** `docs/superpowers/specs/2026-07-05-app-version-0.2.0-design.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `scripts/sync-version.mjs` | 读 package.json，写 Cargo.toml / tauri.conf.json，跑 cargo check；export 纯函数供 Vitest |
| `scripts/generate-changelog.mjs` | 从 git log 生成/prepend CHANGELOG.md |
| `src/hooks/useAppVersion.ts` | 运行时版本 hook（Tauri getVersion + 回退） |
| `src/hooks/__tests__/useAppVersion.test.ts` | hook 单测 |
| `src/components/settings/settingsLabels.ts` | `CATEGORY_LABELS` 映射表 |
| `src/components/settings/AboutSettings.tsx` | 关于页 UI |
| `src/components/settings/__tests__/AboutSettings.test.tsx` | 关于页渲染单测 |
| `src/utils/__tests__/syncVersion.test.ts` | sync-version 纯函数单测 |
| `CHANGELOG.md` | 由脚本生成（Task 7） |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 增加 `version:sync` / `prebuild` / `changelog` scripts |
| `src-tauri/Cargo.toml` | version → 0.2.0（由 sync 脚本写入） |
| `src-tauri/tauri.conf.json` | version → 0.2.0；resources 追加 LICENSE 等 |
| `src-tauri/Cargo.lock` | notez 包 version（cargo check 刷新） |
| `src-tauri/capabilities/default.json` | 追加 `opener:allow-open-path` + `$RESOURCE/**/*` |
| `src/components/settings/settingsTypes.ts` | 增加 `'about'` |
| `src/components/settings/SettingsSidebar.tsx` | 增加「关于」导航项 |
| `src/components/settings/SettingsDialog.tsx` | 用 CATEGORY_LABELS；渲染 AboutSettings |

### 不改动

| 文件 | 原因 |
|------|------|
| `vite.config.ts` | Spec：不用 Vite define 注入版本 |
| `src/store/useAppStore.ts` | persist `version: 1` 是数据迁移版本，非应用版本 |
| `README.md` | Spec 明确不在范围 |

---

## Task 1: 版本同步脚本 + 纯函数单测

**Files:**
- Create: `scripts/sync-version.mjs`
- Create: `src/utils/__tests__/syncVersion.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/syncVersion.test.ts
import { describe, expect, it } from 'vitest';
import {
  applyVersionToCargoToml,
  applyVersionToTauriConf,
  isValidAppVersion,
} from '../../../scripts/sync-version.mjs';

describe('isValidAppVersion', () => {
  it('接受三段 semver', () => {
    expect(isValidAppVersion('0.2.0')).toBe(true);
  });
  it('拒绝 prerelease', () => {
    expect(isValidAppVersion('0.2.0-beta')).toBe(false);
  });
});

describe('applyVersionToCargoToml', () => {
  it('仅替换 [package] 段 version', () => {
    const input = `[package]
name = "notez"
version = "0.1.0"

[dependencies]
serde = { version = "1", features = ["derive"] }
`;
    const out = applyVersionToCargoToml(input, '0.2.0');
    expect(out).toContain('version = "0.2.0"');
    expect(out).toContain('serde = { version = "1"');
  });
});

describe('applyVersionToTauriConf', () => {
  it('替换顶层 version 字段', () => {
    const conf = { version: '0.1.0', productName: 'notez' };
    expect(applyVersionToTauriConf(conf, '0.2.0').version).toBe('0.2.0');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/utils/__tests__/syncVersion.test.ts`

Expected: FAIL — `Cannot find module '../../../scripts/sync-version.mjs'`

- [ ] **Step 3: 实现 `scripts/sync-version.mjs`**

```javascript
// scripts/sync-version.mjs
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

export function isValidAppVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

export function applyVersionToCargoToml(content, version) {
  const lines = content.split('\n');
  let inPackage = false;
  return lines
    .map((line) => {
      if (line.trim() === '[package]') inPackage = true;
      else if (line.startsWith('[') && line.trim() !== '[package]') inPackage = false;
      if (inPackage && /^version\s*=/.test(line)) {
        return `version = "${version}"`;
      }
      return line;
    })
    .join('\n');
}

export function applyVersionToTauriConf(conf, version) {
  return { ...conf, version };
}

function readTargetVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!isValidAppVersion(version)) {
    console.error(`Invalid version in package.json: ${version}`);
    process.exit(1);
  }
  return version;
}

function syncFiles(version) {
  const cargoPath = join(root, 'src-tauri/Cargo.toml');
  const tauriConfPath = join(root, 'src-tauri/tauri.conf.json');

  const cargoRaw = readFileSync(cargoPath, 'utf8');
  const cargoNew = applyVersionToCargoToml(cargoRaw, version);
  if (cargoNew !== cargoRaw) writeFileSync(cargoPath, cargoNew);

  const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  const tauriNew = applyVersionToTauriConf(tauriConf, version);
  const tauriJson = JSON.stringify(tauriNew, null, 2) + '\n';
  const tauriRaw = readFileSync(tauriConfPath, 'utf8');
  if (tauriJson !== tauriRaw) writeFileSync(tauriConfPath, tauriJson);

  execSync('cargo check -q', { cwd: join(root, 'src-tauri'), stdio: 'inherit' });
}

function main() {
  const version = readTargetVersion();
  syncFiles(version);
  console.log(`Synced version to ${version}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/').replace(/^\//, '') ||
  process.argv[1]?.endsWith('sync-version.mjs');
if (isDirectRun || import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  // Node on Windows: compare basename
}
if (process.argv[1]?.includes('sync-version.mjs')) {
  main();
}
```

> **实现提示：** 直接运行检测可简化为文件末尾：
> ```javascript
> import { pathToFileURL } from 'url';
> if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
> ```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/utils/__tests__/syncVersion.test.ts`

Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-version.mjs src/utils/__tests__/syncVersion.test.ts
git commit -m "chore: add version sync script with unit tests"
```

---

## Task 2: npm scripts + 首次同步至 0.2.0

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`（脚本写入）
- Modify: `src-tauri/tauri.conf.json`（脚本写入 version）
- Modify: `src-tauri/Cargo.lock`（cargo check 刷新）

- [ ] **Step 1: 在 package.json 增加 scripts**

在 `"scripts"` 对象中加入（保留现有 scripts）：

```json
"version:sync": "node scripts/sync-version.mjs",
"prebuild": "npm run version:sync",
"changelog": "node scripts/generate-changelog.mjs"
```

- [ ] **Step 2: 执行首次同步**

Run: `npm run version:sync`

Expected:
- stdout: `Synced version to 0.2.0`
- `src-tauri/Cargo.toml` 第 3 行: `version = "0.2.0"`
- `src-tauri/tauri.conf.json` `"version": "0.2.0"`

- [ ] **Step 3: 验证 Cargo.lock**

Run: `grep -A1 'name = "notez"' src-tauri/Cargo.lock`（PowerShell: `Select-String -Path src-tauri/Cargo.lock -Pattern 'name = "notez"' -Context 0,1`）

Expected: `version = "0.2.0"`

- [ ] **Step 4: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
git commit -m "chore: sync app version to 0.2.0 across Rust/Tauri manifests"
```

---

## Task 3: `useAppVersion` hook

**Files:**
- Create: `src/hooks/useAppVersion.ts`
- Create: `src/hooks/__tests__/useAppVersion.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/hooks/__tests__/useAppVersion.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../components/FileOperations', () => ({
  isTauri: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

import { isTauri } from '../../components/FileOperations';
import { getVersion } from '@tauri-apps/api/app';
import { useAppVersion } from '../useAppVersion';
import pkg from '../../../package.json';

describe('useAppVersion', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(getVersion).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('非 Tauri 环境返回 package.json 版本', async () => {
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe(pkg.version);
    expect(result.current.error).toBeNull();
  });

  it('Tauri 环境调用 getVersion', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVersion).mockResolvedValue('0.2.0');
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe('0.2.0');
    expect(getVersion).toHaveBeenCalled();
  });

  it('getVersion 失败时回退 package.json', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVersion).mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe(pkg.version);
    expect(result.current.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/hooks/__tests__/useAppVersion.test.ts`

Expected: FAIL — `Cannot find module '../useAppVersion'`

- [ ] **Step 3: 实现 hook**

```typescript
// src/hooks/useAppVersion.ts
import { useEffect, useState } from 'react';
import { isTauri } from '../components/FileOperations';
import pkg from '../../package.json';

const FALLBACK_VERSION = pkg.version;

export function useAppVersion(): {
  version: string;
  loading: boolean;
  error: string | null;
} {
  const [version, setVersion] = useState(FALLBACK_VERSION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isTauri()) {
        if (!cancelled) {
          setVersion(FALLBACK_VERSION);
          setError(null);
          setLoading(false);
        }
        return;
      }
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const v = await getVersion();
        if (!cancelled) {
          setVersion(v);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setVersion(FALLBACK_VERSION);
          setError('无法读取 Tauri 版本，已回退 package.json');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { version, loading, error };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/hooks/__tests__/useAppVersion.test.ts`

Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAppVersion.ts src/hooks/__tests__/useAppVersion.test.ts
git commit -m "feat: add useAppVersion hook with Tauri getVersion fallback"
```

---

## Task 4: 设置页「关于」入口 wiring

**Files:**
- Create: `src/components/settings/settingsLabels.ts`
- Modify: `src/components/settings/settingsTypes.ts`
- Modify: `src/components/settings/SettingsSidebar.tsx`
- Modify: `src/components/settings/SettingsDialog.tsx`

- [ ] **Step 1: 扩展类型与标签**

```typescript
// src/components/settings/settingsTypes.ts
export type SettingsCategory = 'appearance' | 'ai' | 'plantuml' | 'about';
// ... FontConfig 等保持不变
```

```typescript
// src/components/settings/settingsLabels.ts
import type { SettingsCategory } from './settingsTypes';

export const CATEGORY_LABELS: Record<SettingsCategory, string> = {
  appearance: '外观',
  ai: 'AI 服务',
  plantuml: 'PlantUML',
  about: '关于',
};
```

- [ ] **Step 2: 更新 SettingsSidebar**

在 `SettingsSidebar.tsx`：
- import `Info` from `lucide-react`
- import `CATEGORY_LABELS` 不需要（sidebar 用自己的 label）
- 在 `CATEGORIES` 数组末尾追加：

```typescript
{ id: 'about', label: '关于', icon: <Info size={16} /> },
```

- [ ] **Step 3: 更新 SettingsDialog**

```typescript
// SettingsDialog.tsx 变更要点
import { CATEGORY_LABELS } from './settingsLabels';
import { AboutSettings } from './AboutSettings';

// 标题行替换为：
<h2 className="text-sm font-semibold text-gray-800">
  {CATEGORY_LABELS[category]}
</h2>

// 内容区追加：
{category === 'about' && <AboutSettings />}
```

- [ ] **Step 4: 创建 AboutSettings 占位（供 Dialog 编译）**

```typescript
// src/components/settings/AboutSettings.tsx（占位，Task 5 完善）
export function AboutSettings() {
  return <div data-testid="about-settings">About</div>;
}
```

- [ ] **Step 5: 手动验证**

Run: `npm run dev`，打开设置 → 侧边栏应出现「关于」，点击后标题为「关于」。

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/settingsTypes.ts src/components/settings/settingsLabels.ts src/components/settings/SettingsSidebar.tsx src/components/settings/SettingsDialog.tsx src/components/settings/AboutSettings.tsx
git commit -m "feat(settings): add About category to settings dialog"
```

---

## Task 5: AboutSettings 完整 UI + 单测

**Files:**
- Modify: `src/components/settings/AboutSettings.tsx`
- Create: `src/components/settings/__tests__/AboutSettings.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// src/components/settings/__tests__/AboutSettings.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutSettings } from '../AboutSettings';

vi.mock('../../../hooks/useAppVersion', () => ({
  useAppVersion: () => ({ version: '0.2.0', loading: false, error: null }),
}));

vi.mock('../../../components/FileOperations', () => ({
  isTauri: vi.fn(() => false),
}));

describe('AboutSettings', () => {
  it('显示应用名、版本与许可证', () => {
    render(<AboutSettings />);
    expect(screen.getByText('NoteZ')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText(/Apache-2\.0/)).toBeTruthy();
    expect(screen.getByText(/NoteZ Contributors/)).toBeTruthy();
  });

  it('浏览器 dev 下打开按钮 disabled', () => {
    render(<AboutSettings />);
    expect((screen.getByRole('button', { name: '查看许可证' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/settings/__tests__/AboutSettings.test.tsx`

Expected: FAIL — 找不到 `NoteZ` / disabled 断言失败

- [ ] **Step 3: 实现 AboutSettings**

```typescript
// src/components/settings/AboutSettings.tsx
import { useState } from 'react';
import { isTauri } from '../FileOperations';
import { useAppVersion } from '../../hooks/useAppVersion';

async function openBundledDoc(relativePath: '../LICENSE' | '../THIRD_PARTY_NOTICES.md') {
  const { resolveResource } = await import('@tauri-apps/api/path');
  const { openPath } = await import('@tauri-apps/plugin-opener');
  const path = await resolveResource(relativePath);
  await openPath(path);
}

export function AboutSettings() {
  const { version, loading, error } = useAppVersion();
  const [openError, setOpenError] = useState<string | null>(null);
  const inTauri = isTauri();

  const handleOpen = async (doc: '../LICENSE' | '../THIRD_PARTY_NOTICES.md') => {
    setOpenError(null);
    try {
      await openBundledDoc(doc);
    } catch {
      setOpenError('无法打开文件，请查看仓库根目录对应文件');
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-1">NoteZ</h3>
      <p className="text-xs text-gray-500 mb-4">
        版本 {loading ? '…' : `v${version}`}
        {error && <span className="block text-[10px] text-amber-600 mt-1">{error}</span>}
      </p>

      <div className="mb-4">
        <p className="text-xs text-gray-600 mb-2">许可证：Apache-2.0</p>
        <button
          type="button"
          disabled={!inTauri}
          title={inTauri ? undefined : '仅在 Tauri 桌面应用中可用'}
          onClick={() => handleOpen('../LICENSE')}
          className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          查看许可证
        </button>
      </div>

      <div className="mb-4">
        <p className="text-xs text-gray-600 mb-2">
          第三方组件：PlantUML（JRE + JAR）、Graphviz、Mermaid、Milkdown 等
        </p>
        <button
          type="button"
          disabled={!inTauri}
          title={inTauri ? undefined : '仅在 Tauri 桌面应用中可用'}
          onClick={() => handleOpen('../THIRD_PARTY_NOTICES.md')}
          className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          查看第三方声明
        </button>
      </div>

      {openError && <p className="text-[10px] text-red-500 mb-2">{openError}</p>}

      {!inTauri && (
        <p className="text-[10px] text-gray-400 leading-snug">
          完整许可证与第三方声明见仓库根目录 LICENSE、THIRD_PARTY_NOTICES.md
        </p>
      )}

      <p className="text-[10px] text-gray-400 mt-6 border-t border-gray-200 pt-4">
        © 2026 NoteZ Contributors
      </p>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/settings/__tests__/AboutSettings.test.tsx`

Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AboutSettings.tsx src/components/settings/__tests__/AboutSettings.test.tsx
git commit -m "feat(settings): implement About page with version and license links"
```

---

## Task 6: Tauri bundle resources + opener capabilities

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: 更新 bundle.resources**

在 `src-tauri/tauri.conf.json` 的 `bundle.resources` 改为：

```json
"resources": [
  "resources/plantuml-runtime/",
  "../LICENSE",
  "../THIRD_PARTY_NOTICES.md"
]
```

（`version` 字段应已是 `0.2.0`，若否则再跑 `npm run version:sync`）

- [ ] **Step 2: 更新 capabilities**

在 `src-tauri/capabilities/default.json` 的 `permissions` 数组末尾追加：

```json
{
  "identifier": "opener:allow-open-path",
  "allow": [{ "path": "$RESOURCE/**/*" }]
}
```

- [ ] **Step 3: 验证 Tauri dev 编译**

Run: `npm run tauri dev`（可启动后关闭）

Expected: 无 capabilities schema 错误；关于页在桌面窗口中按钮可点击

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "chore(tauri): bundle LICENSE files and allow opener on resources"
```

---

## Task 7: CHANGELOG 生成脚本 + 首版 CHANGELOG

**Files:**
- Create: `scripts/generate-changelog.mjs`
- Create: `CHANGELOG.md`（脚本输出）

- [ ] **Step 1: 实现 generate-changelog.mjs**

```javascript
// scripts/generate-changelog.mjs
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseArgs(argv) {
  const args = { from: null, to: 'HEAD', version: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--to') args.to = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
  }
  return args;
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

function gitLogRange(from, to) {
  const range = from ? `${from}..${to}` : to;
  const out = execSync(
    `git log ${range} --pretty=format:%s|%h|%ad --date=short`,
    { cwd: root, encoding: 'utf8' },
  ).trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [subject, hash, date] = line.split('|');
    return { subject, hash, date };
  });
}

function groupSubject(subject) {
  const m = subject.match(/^(feat|fix|docs|test|refactor|chore|style)(\([^)]*\))?!?:\s*/);
  if (!m) return 'Other';
  const map = {
    feat: 'Features',
    fix: 'Bug Fixes',
    docs: 'Documentation',
    test: 'Tests',
    refactor: 'Other',
    chore: 'Other',
    style: 'Other',
  };
  return map[m[1]] ?? 'Other';
}

function buildSection(commits) {
  const groups = {};
  for (const c of commits) {
    if (c.subject.startsWith('Merge')) continue;
    const g = groupSubject(c.subject);
    (groups[g] ||= []).push(c);
  }
  const order = ['Features', 'Bug Fixes', 'Documentation', 'Tests', 'Other'];
  let md = '';
  for (const g of order) {
    if (!groups[g]?.length) continue;
    md += `### ${g}\n\n`;
    for (const c of groups[g]) {
      md += `- ${c.subject} (${c.hash})\n`;
    }
    md += '\n';
  }
  return md;
}

function main() {
  const args = parseArgs(process.argv);
  const version = args.version ?? readPackageVersion();
  const commits = gitLogRange(args.from, args.to);
  if (!commits.length) {
    console.error('No commits in range');
    process.exit(1);
  }
  const date = commits[0].date; // 最新 commit 日期
  const entry = `## [${version}] - ${date}\n\n${buildSection(commits)}`;
  const changelogPath = join(root, 'CHANGELOG.md');
  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  const header = existing.startsWith('# Changelog')
    ? ''
    : '# Changelog\n\nAll notable changes to NoteZ are documented here.\n\n';
  const body = existing.startsWith('# Changelog')
    ? existing.replace(/^# Changelog\n\n/, `# Changelog\n\n${entry}`)
    : `${header}${entry}`;
  writeFileSync(changelogPath, body);
  console.log(`Wrote CHANGELOG.md section [${version}]`);
}

main();
```

- [ ] **Step 2: 生成 CHANGELOG**

Run: `npm run changelog`

Expected: 创建 `CHANGELOG.md`，顶部含 `## [0.2.0] - YYYY-MM-DD`

- [ ] **Step 3: 人工扫一眼**

删除明显 meta 条目（如 `docs: add spec for NoteZ 0.2.0...`）若不需要出现在用户 facing changelog。

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-changelog.mjs CHANGELOG.md package.json
git commit -m "docs: add changelog generator and 0.2.0 release notes"
```

---

## Task 8: 全量验证 + 修订 spec 状态 + git tag

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-app-version-0.2.0-design.md`（状态 → 已实现）

- [ ] **Step 1: 运行全量测试**

Run: `npm run test`

Expected: 全部 PASS（含 syncVersion、useAppVersion、AboutSettings 及既有测试）

- [ ] **Step 2: 生产构建验证**

Run: `npm run tauri build`

Expected: 构建成功；安装包属性/version 为 0.2.0

- [ ] **Step 3: 更新 spec 状态**

将 spec  frontmatter 中 `**状态**: 待实现` 改为 `**状态**: 已实现`

- [ ] **Step 4: Commit 文档**

```bash
git add docs/superpowers/specs/2026-07-05-app-version-0.2.0-design.md
git commit -m "docs: mark app version 0.2.0 spec as implemented"
```

- [ ] **Step 5: 打 tag**

Run: `git tag -a v0.2.0 -m "NoteZ 0.2.0"`

Expected: `git tag -l` 列出 `v0.2.0`

> **不自动 push tag**；用户自行 `git push origin v0.2.0`

---

## Spec 覆盖自检

| Spec 章节 | 对应 Task |
|-----------|-----------|
| §2 版本同步 | Task 1, 2 |
| §3 useAppVersion | Task 3 |
| §4 关于页 UI | Task 4, 5 |
| §4.3 resources + capabilities | Task 6 |
| §5 CHANGELOG | Task 7 |
| §6 git tag | Task 8 Step 5 |
| §7 测试 | Task 1, 3, 5 |
| §8 checklist | Task 8 |

无遗漏。

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-07-05-app-version-0.2.0.md`.**

**1. Subagent-Driven（推荐）** — 每个 Task 派发独立 subagent，Task 间 review，迭代快

**2. Inline Execution** — 本会话按 Task 顺序逐步执行，checkpoint 处暂停 review

**Which approach?**
