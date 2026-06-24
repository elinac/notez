---
last_mapped_commit: ffbef8cf2cbc9018fd95ada62430d2e2eb17ab05
---

# Codebase Structure

**Analysis Date:** 2026-06-24

## Directory Layout

```
NoteZ/
├── src/                          # React 19 + TypeScript frontend
│   ├── main.tsx                  # Vite entry: React mount + global init
│   ├── App.tsx                   # Root layout, shortcuts, auto-save
│   ├── App.css                   # App shell / panel styles
│   ├── components/               # UI components + co-located domain helpers
│   │   ├── __tests__/            # Component/integration tests (Vitest)
│   │   └── plantuml-offline/     # PlantUML invoke client + SVG helpers
│   ├── store/                    # Zustand stores
│   │   └── __tests__/
│   ├── constants/                # Theme catalogs, build flags, defaults
│   │   └── __tests__/
│   ├── hooks/                    # React hooks (editor theme, color mode)
│   ├── utils/                    # Shared helpers (dialogs, themes, ratios)
│   │   └── __tests__/
│   └── assets/                   # Static assets (e.g. react.svg)
├── src-tauri/                    # Tauri 2 Rust backend
│   ├── src/
│   │   ├── main.rs               # Binary entry → notez_lib::run()
│   │   ├── lib.rs                # Tauri builder, plugins, invoke handlers
│   │   ├── plantuml_runtime.rs   # JAR/PicoWeb rendering + Tauri commands
│   │   └── plantuml_native/      # Rust PlantUML engine (parse/layout/svg)
│   ├── tests/fixtures/           # Contract .puml fixtures (integration tests)
│   ├── resources/plantuml-runtime/  # Bundled JRE, plantuml.jar, graphviz
│   ├── capabilities/             # Tauri permission capabilities
│   ├── icons/                    # App icons for bundler
│   ├── Cargo.toml
│   └── tauri.conf.json           # Tauri app/build/bundle config
├── scripts/                      # Node build helpers (icons)
├── patches/                      # patch-package overrides for Milkdown
├── .planning/codebase/           # GSD codebase map documents (this folder)
├── public/                       # Vite static assets (favicon, etc.)
├── dist/                         # Vite production build output (generated)
├── index.html                    # HTML shell for Vite
├── package.json                  # Frontend deps + npm scripts
├── vite.config.ts                # Vite dev server (port 3000)
├── vitest.config.ts              # Frontend test runner config
├── tsconfig.json                 # TypeScript project config
├── AGENTS.md                     # Agent/developer project guide
└── README.md                     # User-facing setup docs
```

## Directory Purposes

**`src/`:**
- Purpose: Entire frontend SPA
- Contains: `.tsx` components, `.ts` stores/utils/constants, co-located `__tests__/`
- Key files: `main.tsx`, `App.tsx`, `store/useAppStore.ts`, `store/useSettingsStore.ts`
- Subdirectories: `components/`, `store/`, `constants/`, `hooks/`, `utils/`, `assets/`

**`src/components/`:**
- Purpose: UI and frontend domain logic
- Contains: React components (PascalCase `.tsx`), plain TS modules for services (`FileOperations.ts`, `aiService.ts`, `diagramRenderers.ts`)
- Key files: `MarkdownEditor.tsx`, `WysiwygEditor.tsx`, `PlantUMLRenderer.tsx`, `FileExplorer.tsx`, `SettingsPanel.tsx`, `AiPanel.tsx`
- Subdirectories: `plantuml-offline/`, `__tests__/`

**`src/components/plantuml-offline/`:**
- Purpose: PlantUML client-side orchestration before/after Tauri invoke
- Contains: Renderer, parser helpers, SVG ID scoping
- Key files: `PlantUMLOfflineRenderer.ts`, `PlantUMLParser.ts`, `scopeSvgIdsForHtmlDocument.ts`

**`src/store/`:**
- Purpose: Zustand global state
- Contains: `useAppStore.ts` (session), `useSettingsStore.ts` (AI + themes + PlantUML backend)
- Key files: Both store files; tests in `__tests__/`

**`src/constants/`:**
- Purpose: Static configuration catalogs and build flags
- Contains: Editor/code-block/PlantUML theme definitions, normalization helpers
- Key files: `editorThemes.ts`, `codeBlockThemes.ts`, `plantumlThemes.ts`, `buildFlags.ts`

**`src/hooks/`:**
- Purpose: Reusable React hooks
- Contains: Theme and color-mode hooks
- Key files: `useEffectiveEditorColorMode.ts`, `useCrepeThemeStylesheet.ts`

**`src/utils/`:**
- Purpose: Cross-cutting frontend utilities
- Contains: Native dialog wrappers, editor theme runtime, split pane math
- Key files: `nativeDialog.ts`, `nativeChrome.ts`, `editorThemeRuntime.ts`, `splitPaneRatio.ts`, `normalizeOptionId.ts`

**`src-tauri/src/`:**
- Purpose: Rust library + Tauri integration
- Contains: `lib.rs`, `plantuml_runtime.rs`, `plantuml_native/` module tree
- Key files: `lib.rs`, `main.rs`, `plantuml_runtime.rs`, `plantuml_native/mod.rs`

**`src-tauri/src/plantuml_native/`:**
- Purpose: Native PlantUML rendering pipeline
- Contains: `parse/` (sequence, component, color), `layout/`, `svg/`, `ir.rs`, `limits.rs`, `diagnostics.rs`
- Key files: `mod.rs` (entry `try_render_rust`), `parse/sequence.rs`, `parse/component.rs`

**`src-tauri/tests/fixtures/`:**
- Purpose: Contract tests for Rust PlantUML engine
- Contains: `.puml` sample diagrams grouped by kind
- Subdirectories: `plantuml_sequence/`, `plantuml_component/`

**`src-tauri/resources/plantuml-runtime/`:**
- Purpose: Offline PlantUML distribution bundled into app
- Contains: `jre/`, `plantuml.jar`, `graphviz/` (see `README.md`)
- Committed: Yes (large binary tree; required for JAR backend)

**`scripts/`:**
- Purpose: Icon generation and post-processing for Tauri bundle
- Contains: `generate-icon-svg.mjs`, `prune-non-windows-icons.mjs`

**`patches/`:**
- Purpose: `patch-package` fixes for `@milkdown/crepe` and `@milkdown/components`
- Applied: Automatically via `npm run postinstall`

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis artifacts consumed by planning commands
- Contains: `STACK.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `TESTING.md`, `CONCERNS.md`, `ARCHITECTURE.md`, `STRUCTURE.md`

## Key File Locations

**Entry Points:**
- `index.html` — Vite HTML shell, loads `/src/main.tsx`
- `src/main.tsx` — React bootstrap, global diagram/native init
- `src/App.tsx` — Application root component
- `src-tauri/src/main.rs` — Native binary entry
- `src-tauri/src/lib.rs` — Tauri `run()` and plugin/command registration

**Configuration:**
- `package.json` — npm scripts, frontend dependencies, `postinstall` patch hook
- `vite.config.ts` — Dev server port 3000, Tauri HMR settings
- `vitest.config.ts` — Frontend unit test configuration
- `tsconfig.json` / `tsconfig.node.json` — TypeScript compiler options
- `src-tauri/tauri.conf.json` — Window, bundle, CLI args, resource paths
- `src-tauri/Cargo.toml` — Rust crate deps and edition
- `src-tauri/capabilities/default.json` — Tauri v2 permission allowlist

**Core Logic:**
- `src/store/useAppStore.ts` — Tabs, workspace, editor mode, tasks
- `src/store/useSettingsStore.ts` — Settings persistence (AI, themes, PlantUML)
- `src/components/FileOperations.ts` — File open/save/create abstraction
- `src/components/MarkdownEditor.tsx` — CodeMirror source + split preview
- `src/components/WysiwygEditor.tsx` — Milkdown Crepe WYSIWYG
- `src/components/diagramRenderers.ts` — Diagram renderer registry
- `src/components/plantuml-offline/PlantUMLOfflineRenderer.ts` — Tauri invoke + cache
- `src/components/aiService.ts` — AI streaming HTTP client
- `src-tauri/src/plantuml_runtime.rs` — JAR PicoWeb + `render_plantuml_local` command
- `src-tauri/src/plantuml_native/mod.rs` — Rust engine entry `try_render_rust`

**Testing:**
- `src/**/__tests__/*.test.ts(x)` — Frontend Vitest tests co-located with source
- `src-tauri/src/plantuml_native/plan_fixture_tests.rs` — Fixture-driven Rust tests
- `src-tauri/tests/fixtures/**/*.puml` — PlantUML contract fixtures

**Documentation:**
- `README.md` — Install, dev, build instructions
- `AGENTS.md` — Agent constraints (PlantUML backends, fs scope, gotchas)
- `src-tauri/resources/plantuml-runtime/README.md` — Bundled runtime layout

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` — e.g. `MarkdownEditor.tsx`, `SettingsPanel.tsx`
- Non-component modules: `camelCase.ts` — e.g. `fileOperations.ts` pattern uses `FileOperations.ts` (PascalCase for primary export file matching component domain)
- Co-located tests: `__tests__/<name>.test.ts` or `.test.tsx` — e.g. `editorThemeRuntime.test.ts`
- Constants modules: `camelCase.ts` in `src/constants/` — e.g. `editorThemes.ts`, `buildFlags.ts`
- Rust modules: `snake_case.rs` — e.g. `plantuml_runtime.rs`, `parse/sequence.rs`
- Fixtures: descriptive snake_case — e.g. `v1_legend_ok.puml`

**Directories:**
- Frontend feature folders: `camelCase` or descriptive — e.g. `plantuml-offline/`
- Rust subsystems: `snake_case` — e.g. `plantuml_native/parse/`
- Test directories: `__tests__/` co-located under the module being tested
- Fixture groups: `plantuml_<kind>/` under `src-tauri/tests/fixtures/`

**Special Patterns:**
- Settings pseudo-tab ID: `SETTINGS_TAB_ID = '__notez-settings__'` in `useAppStore.ts`
- localStorage keys: `notez-settings` (settings), Zustand persist key embedded in store config
- Tauri commands: `snake_case` in Rust, invoked as same name from TS — e.g. `render_plantuml_local`
- Serde payloads: `rename_all = "camelCase"` on Rust structs consumed by TS

## Where to Add New Code

**New UI panel or editor feature:**
- Primary code: `src/components/<ComponentName>.tsx`
- Wire into shell: `src/App.tsx` or parent component (`Sidebar.tsx`, `MarkdownEditor.tsx`)
- State: extend `src/store/useAppStore.ts` or `useSettingsStore.ts` if persisted
- Tests: `src/components/__tests__/<ComponentName>.test.tsx`

**New diagram language (WYSIWYG + optional split preview):**
- Renderer: register in `src/components/diagramRenderers.ts` via `registerDiagramRenderer`
- Split-preview: extend `PlantUMLRenderer.tsx` fence regex pattern or add parallel renderer component
- Tests: `src/components/__tests__/diagramRenderers.test.ts`

**New PlantUML Rust diagram kind:**
- IR: add variant to `src-tauri/src/plantuml_native/ir.rs` `DiagramKind`
- Parse: `src-tauri/src/plantuml_native/parse/<kind>.rs`, export from `parse/mod.rs`
- Layout: `src-tauri/src/plantuml_native/layout/<kind>.rs`
- SVG: `src-tauri/src/plantuml_native/svg/<kind>.rs`
- Dispatch: extend `match kind` in `plantuml_native/mod.rs`
- Fixtures: `src-tauri/tests/fixtures/plantuml_<kind>/`

**New Tauri command:**
- Handler: new `#[tauri::command]` fn in appropriate `src-tauri/src/*.rs` module
- Register: add to `invoke_handler!` in `src-tauri/src/lib.rs`
- Permissions: update `src-tauri/capabilities/default.json` if new plugin APIs needed
- Frontend: dynamic `invoke` from relevant `src/components/` or `src/utils/` module

**New persisted setting:**
- Types/defaults: `src/store/useSettingsStore.ts` (`PersistedSettings`, normalization on load)
- UI control: `src/components/SettingsPanel.tsx`
- Tests: `src/store/__tests__/` for persistence behavior

**New editor theme or code-block theme:**
- Catalog: `src/constants/editorThemes.ts` or `codeBlockThemes.ts`
- Runtime application: `src/utils/editorThemeRuntime.ts` or CodeMirror extension in constants
- Tests: matching file in `src/constants/__tests__/`

**Shared frontend utility:**
- Implementation: `src/utils/<name>.ts`
- Tests: `src/utils/__tests__/<name>.test.ts`

**Build / packaging script:**
- Add to `scripts/<name>.mjs`; wire npm script in `package.json` if user-facing

## Special Directories

**`dist/`:**
- Purpose: Vite production build consumed by Tauri `frontendDist`
- Source: `npm run build`
- Committed: No (build artifact)

**`src-tauri/target/`:**
- Purpose: Cargo build output, debug/release binaries
- Source: `cargo build` / `tauri build`
- Committed: No

**`node_modules/`:**
- Purpose: npm dependencies
- Source: `npm install`
- Committed: No

**`src-tauri/resources/plantuml-runtime/`:**
- Purpose: Bundled JRE + PlantUML JAR + Graphviz for offline JAR backend
- Source: Manual/vendor layout documented in README
- Committed: Yes (required for desktop PlantUML)

**`patches/`:**
- Purpose: Committed npm package patches applied on install
- Source: Maintained manually; applied by `patch-package` postinstall
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning and codebase map artifacts
- Committed: Typically yes for team planning continuity

**`tasks/`:**
- Purpose: Ad-hoc task/report markdown (e.g. smell reports)
- Committed: Varies; not part of runtime

---

*Structure analysis: 2026-06-24*
*Update when directory structure changes*
