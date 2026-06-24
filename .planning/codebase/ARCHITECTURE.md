---
last_mapped_commit: ffbef8cf2cbc9018fd95ada62430d2e2eb17ab05
---

<!-- refreshed: 2026-06-24 -->
# Architecture

**Analysis Date:** 2026-06-24

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                     React UI (WebView / Browser)                          │
│  `src/App.tsx` · `src/components/*` · `src/store/*` · `src/hooks/*`       │
├──────────────┬─────────────────────┬──────────────────┬──────────────────┤
│ File I/O     │ Markdown Editors    │ Diagram Preview  │ AI Assistant     │
│ FileExplorer │ MarkdownEditor      │ PlantUMLRenderer │ AiPanel          │
│ FileOps      │ WysiwygEditor       │ diagramRenderers │ aiService        │
│ nativeDialog │ CodeMirror / Crepe  │ mermaidSingleton │ (fetch stream)   │
└──────┬───────┴──────────┬──────────┴────────┬─────────┴────────┬─────────┘
       │ Tauri invoke     │ in-process       │ Tauri invoke     │ HTTPS
       │ plugin-fs/dialog │                  │                  │
       ▼                  ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     Tauri 2 Shell (`src-tauri/src/lib.rs`)                │
│  Plugins: fs · dialog · cli · opener · window-state · single-instance     │
│  Commands: `render_plantuml_local` · `plantuml_runtime_available`         │
├──────────────────────────────┬───────────────────────────────────────────┤
│ JAR Backend (default)        │ Rust Native Backend (experimental)         │
│ `plantuml_runtime.rs`        │ `plantuml_native/`                         │
│ PicoWeb JVM + Graphviz       │ parse → IR → layout → SVG                  │
│ `resources/plantuml-runtime/│ sequence + component diagrams              │
└──────────────────────────────┴───────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Persistence: localStorage (Zustand persist) · `<appData>/settings.json`  │
│  User files: workspace dirs via Tauri fs scope (dialog-selected paths)    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App shell | Layout, keyboard shortcuts, auto-save, file-association bootstrap | `src/App.tsx` |
| App state | Tabs, workspace roots, editor mode, task board, panel visibility | `src/store/useAppStore.ts` |
| Settings state | AI providers, PlantUML theme/backend, editor themes | `src/store/useSettingsStore.ts` |
| File operations | Open/save/create; Tauri vs browser fallback | `src/components/FileOperations.ts` |
| File explorer | Multi-root workspace tree, context menu CRUD | `src/components/FileExplorer.tsx` |
| Source editor | CodeMirror markdown + split preview | `src/components/MarkdownEditor.tsx` |
| WYSIWYG editor | Milkdown Crepe inline editing | `src/components/WysiwygEditor.tsx` |
| Diagram registry | Extensible plantuml/mermaid renderers for WYSIWYG | `src/components/diagramRenderers.ts` |
| PlantUML preview | Markdown fence extraction + offline invoke | `src/components/PlantUMLRenderer.tsx`, `src/components/plantuml-offline/PlantUMLOfflineRenderer.ts` |
| Mermaid preview | Singleton renderer with error HTML | `src/components/mermaidSingleton.ts` |
| AI chat | Streaming OpenAI-compatible client | `src/components/aiService.ts`, `src/components/AiPanel.tsx` |
| Tauri runtime | Plugin wiring, fs scope, invoke handlers | `src-tauri/src/lib.rs` |
| PlantUML JAR runtime | JVM PicoWeb, deflate URL encoding, `-pipe` fallback | `src-tauri/src/plantuml_runtime.rs` |
| PlantUML Rust engine | Subset parser, layout, SVG for sequence/component | `src-tauri/src/plantuml_native/mod.rs` |

## Pattern Overview

**Overall:** Tauri 2 desktop shell + React SPA with dual-runtime diagram rendering

**Key Characteristics:**
- Single-page React app mounted once; navigation is in-app state (tabs/views), not routes
- Dual persistence: Zustand `persist` for session UI state; separate settings file for AI/theme config
- Platform-adaptive I/O: same components call Tauri plugins when `__TAURI_INTERNALS__` is present, else browser APIs
- Diagram rendering split: Mermaid runs fully in WebView; PlantUML delegates to Rust (JAR or native)
- Extensible diagram registry pattern for WYSIWYG code blocks (`registerDiagramRenderer`)

## Layers

**Presentation (React components):**
- Purpose: User-facing panels, editors, previews, dialogs
- Location: `src/components/`, `src/App.tsx`, `src/App.css`
- Contains: Functional React components, co-located helpers (e.g. `outlineNavigation.ts`, `TaskBoard.ts`)
- Depends on: Zustand stores, utils, constants, Tauri plugin imports (dynamic)
- Used by: `src/main.tsx` → `App`

**State (Zustand):**
- Purpose: Cross-component session and configuration state
- Location: `src/store/useAppStore.ts`, `src/store/useSettingsStore.ts`
- Contains: Tab model, workspace dirs, editor mode, AI configs, theme IDs
- Depends on: `FileOperations` types, constants for defaults/normalization
- Used by: All major UI components

**Domain / Services (frontend modules):**
- Purpose: File I/O abstraction, AI HTTP client, diagram orchestration
- Location: `src/components/FileOperations.ts`, `src/components/aiService.ts`, `src/components/plantuml-offline/`, `src/components/diagramRenderers.ts`
- Contains: Pure/async functions, renderer registry, SVG post-processing
- Depends on: Tauri APIs (conditional), settings store, build flags
- Used by: Editors, preview panes, AI panel

**Configuration & theming:**
- Purpose: Static option catalogs and runtime theme application
- Location: `src/constants/`, `src/utils/editorThemeRuntime.ts`, `src/hooks/useCrepeThemeStylesheet.ts`
- Contains: Theme IDs, PlantUML themes, build-time flags, CodeMirror/Crepe styling
- Depends on: Third-party theme packages
- Used by: Settings panel, editors

**Tauri command boundary:**
- Purpose: Bridge WebView to native capabilities
- Location: `src-tauri/src/lib.rs`, invoked from `PlantUMLOfflineRenderer.ts`
- Contains: `#[tauri::command]` handlers, plugin registration, fs scope setup
- Depends on: `plantuml_runtime`, Tauri plugins
- Used by: Frontend via `@tauri-apps/api/core` `invoke`

**PlantUML JAR runtime:**
- Purpose: Production-grade PlantUML via bundled JRE + plantuml.jar
- Location: `src-tauri/src/plantuml_runtime.rs`, resources in `src-tauri/resources/plantuml-runtime/`
- Contains: PicoWeb singleton (`PICO_WEB` mutex), HTTP client to localhost, logging to `notez-plantuml.log`
- Depends on: Bundled JRE/JAR/Graphviz, `flate2` for URL encoding
- Used by: `render_plantuml_local` when backend is `jar` (default)

**PlantUML Rust native pipeline:**
- Purpose: Experimental in-process SVG rendering without JVM
- Location: `src-tauri/src/plantuml_native/` (`parse/`, `layout/`, `svg/`, `ir.rs`, `limits.rs`)
- Contains: Parse → IR → layout → SVG for `DiagramKind::Sequence` and `DiagramKind::Component`
- Depends on: Internal modules only; `rust-sugiyama` for component layout
- Used by: `render_plantuml_local` when backend is `rust`; production builds force JAR via `buildFlags.ts`

## Data Flow

### Application startup

1. `index.html` loads `src/main.tsx` (`index.html:13`)
2. `main.tsx` installs global bridges (`diagramZoom`, `nativeChrome`) then mounts `App` (`src/main.tsx:7-13`)
3. `App` calls `useSettingsStore.initSettings()` to load `<appData>/settings.json` or localStorage (`src/App.tsx:37`, `src/store/useSettingsStore.ts:86-104`)
4. Zustand `persist` rehydrates tabs/workspace from localStorage; `_hasHydrated` gates CLI file open (`src/store/useAppStore.ts:87-88`, `src/App.tsx:78-83`)
5. Tauri: listen for `open-markdown-path` event and CLI `path` arg; load file into tab (`src/App.tsx:40-90`, `src-tauri/src/lib.rs:21-36`)

### Edit → auto-save (Tauri)

1. User types in `MarkdownEditor` or `WysiwygEditor`; `onChange` → `useAppStore.setContent` marks tab dirty
2. `App` debounces 1s on dirty active file tab (`src/App.tsx:101-135`)
3. `saveMarkdownFileTauri` writes via `@tauri-apps/plugin-fs` (`src/components/FileOperations.ts`)
4. `updateTabFile` clears dirty flag; `refreshFileTree` bumps `fileTreeVersion` for explorer reload

### PlantUML render (split preview / WYSIWYG)

1. Markdown contains ` ```plantuml ` fence; `PlantUMLRenderer` or `diagramRenderers` extracts source
2. `renderPlantUMLOffline` wraps with `@startuml`, applies `!theme`, picks backend via `effectivePlantUmlBackend` (`src/components/plantuml-offline/PlantUMLOfflineRenderer.ts:159-176`, `src/constants/buildFlags.ts:15-17`)
3. Cache lookup by `(backend, theme, source)`; miss → serial queue → `invoke('render_plantuml_local', { source, format: 'svg', backend })` (`PlantUMLOfflineRenderer.ts:217-228`)
4. Rust `spawn_blocking` dispatches to JAR or native path (`src-tauri/src/plantuml_runtime.rs:664-676`)
5. **JAR path:** resolve bundled runtime → ensure PicoWeb JVM → HTTP GET with deflate-encoded URL (or `-pipe` fallback)
6. **Rust path:** `try_render_rust_with_report` → detect kind → parse → layout → SVG (`src-tauri/src/plantuml_native/mod.rs:172-205`)
7. Frontend decodes `svgBytes`, styles root SVG, optionally scopes IDs for multi-diagram pages (`scopeSvgIdsForHtmlDocument.ts`)

### AI assistant request

1. `AiPanel` reads active note content from `useAppStore` and AI config from `useSettingsStore`
2. `streamChat` POSTs to `{baseUrl}/chat/completions` with SSE parsing (`src/components/aiService.ts:22-80`)
3. Tokens append to panel message state; quick actions can inject generated markdown back via `setContent`
4. No Rust involvement; outbound HTTPS only

### Mermaid render

1. Fence or WYSIWYG code block triggers `mermaidSingleton.renderMermaidSvg`
2. Entirely client-side in WebView; errors formatted as HTML via `formatMermaidErrorHtml`
3. Registered in `diagramRenderers.ts` alongside PlantUML

**State Management:**
- **Session UI:** Zustand `useAppStore` with `persist` → localStorage (tabs, workspace dirs, tasks, editor mode)
- **Settings:** Async load/save to Tauri app data dir or localStorage key `notez-settings` (`useSettingsStore.ts:61-120`)
- **Ephemeral:** Split pane ratios (`splitPaneRatioByTabId`), PlantUML SVG cache, in-flight invoke map (not persisted)
- **Backend global:** `PICO_WEB` mutex in Rust for singleton JVM (`plantuml_runtime.rs:687-695`)

## Key Abstractions

**EditorTab (file | settings):**
- Purpose: Unified tab model for open documents and settings pseudo-tab
- Examples: `src/store/useAppStore.ts:25-42`, `SETTINGS_TAB_ID`
- Pattern: Discriminated union with `isFileTab` type guard

**NoteFile:**
- Purpose: In-memory document with dirty/path metadata
- Examples: `src/components/FileOperations.ts:11-18`
- Pattern: Plain interface; factory `createNewFile()`

**DiagramRenderer registry:**
- Purpose: Map language id → async SVG/HTML renderer for WYSIWYG
- Examples: `src/components/diagramRenderers.ts:25-35`, built-in registrations at lines 63-78
- Pattern: Module-level `Map`; extend via `registerDiagramRenderer`

**PlantumlLocalRenderResult:**
- Purpose: Tauri command payload (SVG bytes + optional warnings)
- Examples: Rust `src-tauri/src/plantuml_runtime.rs:26-32`; TS `PlantUMLOfflineRenderer.ts:179-183`
- Pattern: Serde `camelCase` ↔ TypeScript camelCase

**DiagramKind IR pipeline:**
- Purpose: Native engine stages for sequence/component diagrams
- Examples: `src-tauri/src/plantuml_native/ir.rs:8-12`, `parse/sequence.rs`, `layout/sequence.rs`, `svg/sequence.rs`
- Pattern: Parse → IR struct → layout geometry → SVG string; fixture-driven tests in `src-tauri/tests/fixtures/`

**Platform gate (`isTauri()`):**
- Purpose: Branch native vs browser behavior
- Examples: `src/components/FileOperations.ts:8-9`, duplicated in `useSettingsStore.ts:63-65`
- Pattern: Runtime check on `window.__TAURI_INTERNALS__`

## Entry Points

**Frontend bootstrap:**
- Location: `src/main.tsx`
- Triggers: HTML script load
- Responsibilities: Global init hooks, React root render

**Application root:**
- Location: `src/App.tsx`
- Triggers: React mount
- Responsibilities: Shell layout, settings init, file association, auto-save, shortcuts

**Rust binary:**
- Location: `src-tauri/src/main.rs` → `notez_lib::run()`
- Triggers: OS launches desktop app
- Responsibilities: Delegate to library entry

**Tauri library entry:**
- Location: `src-tauri/src/lib.rs` `run()`
- Triggers: `main.rs` or mobile entry
- Responsibilities: Register plugins, fs scope, invoke handlers, PicoWeb shutdown on exit

**Tauri commands (IPC):**
- Location: `src-tauri/src/plantuml_runtime.rs` (`render_plantuml_local`, `plantuml_runtime_available`)
- Triggers: Frontend `invoke` from `PlantUMLOfflineRenderer.ts`
- Responsibilities: Off-thread PlantUML rendering, runtime availability probe

**Vite dev server:**
- Location: `vite.config.ts` (port 3000)
- Triggers: `npm run dev` / Tauri `beforeDevCommand`
- Responsibilities: HMR, serves `src/` to WebView

## Architectural Constraints

- **Threading:** PlantUML invoke runs on `spawn_blocking` thread pool; UI stays on main WebView thread
- **Global state:** `PICO_WEB: Mutex<Option<PicoWebState>>` singleton for JVM; must call `shutdown_plantuml_picoweb()` on app exit (`lib.rs:75-77`)
- **FS scope:** Tauri fs plugin scoped in `setup` to `/` and all Windows drive letters (`lib.rs:46-55`); required for user-selected workspace paths
- **Windows paths:** Tauri may return `\\?\` verbatim paths; Rust runtime strips via `strip_windows_verbatim_prefix` in `plantuml_runtime.rs`
- **Production PlantUML backend:** `effectivePlantUmlBackend` forces `jar` in prod builds (`src/constants/buildFlags.ts:15-17`)
- **Rust engine limits:** Source ≤1 MiB, line ≤16 KiB, render budget 2000 ms (`src-tauri/src/plantuml_native/limits.rs`)
- **Zustand hydration:** Must wait `onFinishHydration` before CLI-open to avoid race with persisted tabs (`App.tsx:78-83`)
- **Vite port:** Tauri `devUrl` hardcodes `http://localhost:3000` (`src-tauri/tauri.conf.json:8`); port conflict breaks dev

## Anti-Patterns

### Duplicated `isTauri()` checks

**What happens:** `isTauri()` is defined separately in `FileOperations.ts` and `useSettingsStore.ts`
**Why it's wrong:** Drift risk if detection logic changes
**Do this instead:** Import a single helper from `src/utils/` (or `FileOperations.ts` export) when adding new platform branches

### Large monolithic parser files

**What happens:** `src-tauri/src/plantuml_native/parse/sequence.rs` is 4000+ lines
**Why it's wrong:** Hard to navigate and test in isolation
**Do this instead:** Add new sequence syntax in focused submodules under `parse/sequence/` when extending (match component split pattern)

### Browser mode silent auto-save

**What happens:** Browser auto-save only clears dirty flag without persisting (`App.tsx:126-129`)
**Why it's wrong:** Users may expect persistence in web dev mode
**Do this instead:** Document as intentional; use Ctrl+S download save in browser

## Error Handling

**Strategy:** Errors surface at UI boundary as console logs + inline HTML error panels; Rust commands return `Result<_, String>`

**Patterns:**
- Tauri invoke failures → `formatPlantUmlErrorHtml` in preview containers (`PlantUMLOfflineRenderer.ts:54-65`)
- Mermaid failures → `formatMermaidErrorHtml` (`mermaidSingleton.ts`)
- Rust native engine → `NativeError` enum with Display messages mapped to String at Tauri boundary (`plantuml_native/mod.rs:19-68`)
- Auto-save / settings save → `try/catch` with `console.error`, no crash (`App.tsx:123-124`, `useSettingsStore.ts:116-117`)
- AI streaming → `onError` callback with user-visible message (`aiService.ts:49-57`)

## Cross-Cutting Concerns

**Logging:**
- Frontend: `console.warn` / `console.error` for non-fatal issues
- PlantUML JAR: append to `{exe_dir}/notez-plantuml.log` via `plantuml_append_log_line` in `plantuml_runtime.rs`
- Rust native warnings: `eprintln!` in `try_render_rust` (`plantuml_native/mod.rs:166-168`)

**Validation:**
- Settings normalization on load (`normalizeEditorThemeId`, `normalizeCodeBlockThemeId` in constants)
- PlantUML input limits and forbidden directive prescan in Rust (`limits.rs`, `prescan_source`)
- Filename sanitization in `FileOperations.ts:45-47`

**Authentication:**
- No app-level auth; AI API keys stored locally in settings JSON / localStorage
- Outbound Bearer token only for non-Ollama providers (`aiService.ts:34-36`)

**Theming:**
- Editor chrome: `editorThemeRuntime.ts` + `useEffectiveEditorColorMode.ts` (respects system + user override)
- Code blocks: `codeBlockThemes.ts` CodeMirror extensions
- Crepe WYSIWYG: `useCrepeThemeStylesheet.ts` injects CSS variables

---

*Architecture analysis: 2026-06-24*
*Update when major patterns change*
