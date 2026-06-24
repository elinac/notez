/**
 * NoteZ Settings Store
 * Persists AI provider configuration to:
 *   - Tauri mode: <appLocalDataDir>/NoteZ/settings.json
 *   - Browser mode: localStorage (fallback)
 */
import { create } from 'zustand';

import { effectivePlantUmlBackend } from '../constants/buildFlags';
import {
  DEFAULT_EDITOR_COLOR_MODE,
  DEFAULT_EDITOR_THEME_ID,
  normalizeEditorColorMode,
  normalizeEditorThemeId,
  type EditorColorMode,
  type EditorThemeId,
} from '../constants/editorThemes';
import {
  DEFAULT_CODE_BLOCK_THEME_ID,
  normalizeCodeBlockThemeId,
} from '../constants/codeBlockThemes';
import { DEFAULT_PLANTUML_THEME } from '../constants/plantumlThemes';

export type AiProvider = 'openai' | 'ollama' | 'custom';

/** PlantUML 渲染后端：JAR（默认）或实验性 Rust 引擎 */
export type PlantUmlBackend = 'jar' | 'rust';

export const DEFAULT_PLANTUML_BACKEND: PlantUmlBackend = 'jar';

export interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
}

const DEFAULT_CONFIGS: AiProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    provider: 'openai',
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model: 'llama3.2',
    provider: 'ollama',
  },
];

// ── Tauri-aware persistence helpers ────────────────────────────────────────────────────

const LS_KEY = 'notez-settings';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function getSettingsPath(): Promise<string> {
  const { appLocalDataDir } = await import('@tauri-apps/api/path');
  const { join } = await import('@tauri-apps/api/path');
  const base = await appLocalDataDir();
  return join(base, 'settings.json');
}

export interface PersistedSettings {
  aiConfigs: AiProviderConfig[];
  activeAiConfigId: string | null;
  /** PlantUML 内置 theme 名，默认 bluegray */
  plantUmlTheme?: string;
  /** PlantUML 渲染后端，缺省为 jar */
  plantUmlBackend?: PlantUmlBackend;
  editorColorMode?: EditorColorMode;
  editorThemeId?: EditorThemeId;
  codeBlockThemeId?: string;
}

export async function loadSettings(): Promise<PersistedSettings | null> {
  if (isTauri()) {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await getSettingsPath();
      const text = await readTextFile(path);
      return JSON.parse(text) as PersistedSettings;
    } catch {
      return null;
    }
  } else {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as PersistedSettings) : null;
    } catch {
      return null;
    }
  }
}

export async function saveSettings(data: PersistedSettings): Promise<void> {
  if (isTauri()) {
    try {
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
      const base = await appLocalDataDir();
      // Ensure directory exists
      await mkdir(base, { recursive: true });
      const path = await join(base, 'settings.json');
      await writeTextFile(path, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  } else {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────────────
interface SettingsState {
  aiConfigs: AiProviderConfig[];
  activeAiConfigId: string | null;
  plantUmlTheme: string;
  plantUmlBackend: PlantUmlBackend;
  editorColorMode: EditorColorMode;
  editorThemeId: EditorThemeId;
  codeBlockThemeId: string;
  /** Whether initial settings have been loaded from disk */
  loaded: boolean;

  setAiConfigs: (configs: AiProviderConfig[]) => void;
  upsertAiConfig: (config: AiProviderConfig) => void;
  deleteAiConfig: (id: string) => void;
  setActiveAiConfigId: (id: string | null) => void;
  setPlantUmlTheme: (theme: string) => void;
  setPlantUmlBackend: (backend: PlantUmlBackend) => void;
  setEditorColorMode: (mode: EditorColorMode) => void;
  setEditorThemeId: (id: EditorThemeId) => void;
  setCodeBlockThemeId: (id: string) => void;
  getActiveConfig: () => AiProviderConfig | null;
  /** Load settings from disk (call once on app init) */
  initSettings: () => Promise<void>;
}

function persist(state: SettingsState) {
  saveSettings({
    aiConfigs: state.aiConfigs,
    activeAiConfigId: state.activeAiConfigId,
    plantUmlTheme: state.plantUmlTheme,
    plantUmlBackend: effectivePlantUmlBackend(state.plantUmlBackend),
    editorColorMode: state.editorColorMode,
    editorThemeId: state.editorThemeId,
    codeBlockThemeId: state.codeBlockThemeId,
  });
}

/** 与 `initSettings` / 持久化一致；仅 `'rust'` 精确匹配为 Rust，其余均回落为 JAR。 */
export function normalizePlantUmlBackend(raw: unknown): PlantUmlBackend {
  return raw === 'rust' ? 'rust' : DEFAULT_PLANTUML_BACKEND;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  aiConfigs: DEFAULT_CONFIGS,
  activeAiConfigId: null,
  plantUmlTheme: DEFAULT_PLANTUML_THEME,
  plantUmlBackend: DEFAULT_PLANTUML_BACKEND,
  editorColorMode: DEFAULT_EDITOR_COLOR_MODE,
  editorThemeId: DEFAULT_EDITOR_THEME_ID,
  codeBlockThemeId: DEFAULT_CODE_BLOCK_THEME_ID,
  loaded: false,

  setAiConfigs: (configs) => {
    set({ aiConfigs: configs });
    persist(get());
  },

  upsertAiConfig: (config) => {
    set((state) => {
      const exists = state.aiConfigs.find((c) => c.id === config.id);
      return {
        aiConfigs: exists
          ? state.aiConfigs.map((c) => (c.id === config.id ? config : c))
          : [...state.aiConfigs, config],
      };
    });
    persist(get());
  },

  deleteAiConfig: (id) => {
    set((state) => ({
      aiConfigs: state.aiConfigs.filter((c) => c.id !== id),
      activeAiConfigId: state.activeAiConfigId === id ? null : state.activeAiConfigId,
    }));
    persist(get());
  },

  setActiveAiConfigId: (id) => {
    set({ activeAiConfigId: id });
    persist(get());
  },

  setPlantUmlTheme: (theme) => {
    set({ plantUmlTheme: theme });
    persist(get());
  },

  setPlantUmlBackend: (backend) => {
    const effective = effectivePlantUmlBackend(backend);
    if (effective === get().plantUmlBackend) return;
    set({ plantUmlBackend: effective });
    persist(get());
  },

  setEditorColorMode: (mode) => {
    set({ editorColorMode: normalizeEditorColorMode(mode) });
    persist(get());
  },

  setEditorThemeId: (id) => {
    set({ editorThemeId: normalizeEditorThemeId(id) });
    persist(get());
  },

  setCodeBlockThemeId: (id) => {
    set({ codeBlockThemeId: normalizeCodeBlockThemeId(id) });
    persist(get());
  },

  getActiveConfig: () => {
    const { aiConfigs, activeAiConfigId } = get();
    if (!activeAiConfigId) return aiConfigs[0] ?? null;
    return aiConfigs.find((c) => c.id === activeAiConfigId) ?? null;
  },

  initSettings: async () => {
    if (get().loaded) return;
    const saved = await loadSettings();
    if (saved) {
      set({
        aiConfigs: saved.aiConfigs ?? DEFAULT_CONFIGS,
        activeAiConfigId: saved.activeAiConfigId ?? null,
        plantUmlTheme: saved.plantUmlTheme ?? DEFAULT_PLANTUML_THEME,
        plantUmlBackend: effectivePlantUmlBackend(
          normalizePlantUmlBackend(saved.plantUmlBackend)
        ),
        editorColorMode: normalizeEditorColorMode(saved.editorColorMode),
        editorThemeId: normalizeEditorThemeId(saved.editorThemeId),
        codeBlockThemeId: normalizeCodeBlockThemeId(saved.codeBlockThemeId),
        loaded: true,
      });
    } else {
      set({ loaded: true });
    }
  },
}));
