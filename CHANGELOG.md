# Changelog

All notable changes to NoteZ are documented here.

## [0.2.0] - 2026-07-05

### Features

- feat(settings): implement About page with version and license links (57ee781)
- feat(settings): add About category to settings dialog (0b2daa4)
- feat: add useAppVersion hook with Tauri getVersion fallback (973ed33)
- feat(workspace): render ephemeral workspace roots in file explorer (9201e4d)
- feat(workspace): add ephemeral root on file association open (af210d3)
- feat(workspace): add ephemeral workspace dirs to app store (f53795f)
- feat(workspace): add workspacePath utils for ephemeral roots (c2dba8f)
- feat(plantuml): WYSIWYG error view via createRoot and skip zoom wrapper (9008d97)
- feat(plantuml): render error code view via portal in split preview (9e97136)
- feat(plantuml): add PlantUMLErrorCodeView component (8ae291e)
- feat(ai): refactor aiService to use Tauri backend with proxy support (69e0ede)
- feat(ai): add Rust AI service backend with proxy support and streaming (b7ed48d)
- feat(ai): add proxy settings and model fetch UI to provider editor (d5dd8ba)
- feat(ai): update provider types (replace ollama with anthropic, add proxy fields) (343a39f)
- feat(settings): add Rust list_system_fonts command using font-kit (71e247a)
- feat(settings): inject font CSS variables into Milkdown WYSIWYG editor (fb444d4)
- feat(settings): add CodeMirror font compartment for live font updates (3a0b70f)
- feat(settings): wire font pickers into AppearanceSettings (af96d2d)
- feat(settings): create FontPicker and FontSizeStepper components (74c58fd)
- feat(settings): inject font CSS variables from store to :root (35b9f8c)
- feat(settings): extend store with font config fields and actions (3301fd4)
- feat(settings): replace tab-based SettingsPanel with modal SettingsDialog (c45def9)
- feat(settings): extract appearance, AI, and PlantUML sub-components (03148d4)
- feat(settings): create SettingsDialog and SettingsSidebar components (b470fa2)
- feat(settings): add settingsDialogOpen state to useAppStore (2a3a295)
- feat(settings): add type definitions and font default constants (b45bfb0)
- feat: add unified formatting toolbar across all editor modes (56b1906)

### Documentation

- docs: revise 0.2.0 version spec after audit and add implementation plan (f2c8271)
- docs: mark ephemeral workspace spec as implemented (c49e830)
- docs: add implementation plan for ephemeral workspace from file association (64ad92b)
- docs: second audit revisions for ephemeral workspace spec (69b695a)
- docs: revise ephemeral workspace spec after feasibility audit (81b781e)
- docs: add spec for ephemeral workspace from file association (0ef883b)
- docs: PlantUML inline error code view implementation plan (2f88d93)
- docs: PlantUML inline code view spec v3 (API-audited) (0ec08b7)
- docs: map existing codebase (8bb1cee)

### Tests

- test(plantuml): update E2E mocks for RenderResult (2921f37)

### Other

- chore(tauri): bundle LICENSE files and allow opener on resources (84f6d01)
- chore: sync app version to 0.2.0 across Rust/Tauri manifests (2d35f51)
- chore: add version sync script with unit tests (538ffbb)
- style(plantuml): add inline error code view styles (d1dd85c)
- refactor(plantuml): return RenderResult from renderPlantUMLOffline (8ec72ce)
- refactor: reduce Milkdown patch from 374 to 31 lines (23ed225)
- add copy image (3d579df)
- chore: remove unused plantuml-encoder and pako dependencies (ffbef8c)
- chore: remove unused PlantUML browser WASM artifacts (75352ac)
- init commit (afee1c7)

