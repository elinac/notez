/**
 * NoteZ Global State - Zustand Store
 * Manages: tabs, current file, tasks, view navigation, editor mode
 * Persists: tabs, activeTabId, tasks, editor mode, workspaceDirs → localStorage
 *
 * Supports multiple workspace roots; each is shown as a top-level collapsible
 * node in the file explorer panel (Multi-root workspace, similar to VS Code).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NoteFile, createNewFile } from '../components/FileOperations';
import { Task } from '../components/TaskBoard';
import {
  clampPanelWidth,
  DEFAULT_AI_PANEL_WIDTH_PX,
  DEFAULT_FILE_PANEL_WIDTH_PX,
} from '../utils/panelWidth';
import { clampSplitRatio, removeTabSplitRatio } from '../utils/splitPaneRatio';

// ── View types ────────────────────────────────────────────────────────────────
export type AppView = 'editor' | 'board';
export type EditorMode = 'split' | 'edit' | 'wysiwyg';
export type SidebarPanel = 'files' | null;
/** Right-side panel (AI assistant only; settings opens as a main-area tab) */
export type RightPanel = 'ai' | null;

export type PlantUmlFixRequest = {
  source: string;
  errorMessage: string;
  errorLine?: number;
};

export const SETTINGS_TAB_ID = '__notez-settings__' as const;

// ── Tab types ─────────────────────────────────────────────────────────────────
export type FileEditorTab = {
  kind: 'file';
  id: string;
  file: NoteFile;
  content: string;
};

export type SettingsEditorTab = {
  kind: 'settings';
  id: typeof SETTINGS_TAB_ID;
  title: string;
};

export type EditorTab = FileEditorTab | SettingsEditorTab;

export function isFileTab(t: EditorTab): t is FileEditorTab {
  return t.kind === 'file';
}

/** Normalize tabs rehydrated from older persisted state (no `kind` field). */
function normalizeTab(raw: unknown): EditorTab {
  const t = raw as Record<string, unknown>;
  if (t && t.kind === 'settings' && t.id === SETTINGS_TAB_ID) {
    return {
      kind: 'settings',
      id: SETTINGS_TAB_ID,
      title: typeof t.title === 'string' ? t.title : '设置',
    };
  }
  const file = t?.file as NoteFile;
  const id = typeof t?.id === 'string' ? t.id : `tab-${Date.now()}`;
  const content = typeof t?.content === 'string' ? t.content : '';
  return { kind: 'file', id, file, content };
}

// ── Store shape ───────────────────────────────────────────────────────────────
interface AppState {
  // Multi-tab state
  tabs: EditorTab[];
  activeTabId: string;

  // Active tab mirrors (kept in sync so Zustand subscriptions work correctly)
  currentFile: NoteFile;
  content: string;

  // Task board state
  tasks: Task[];

  // Navigation
  activeView: AppView;

  // Editor display mode
  editorMode: EditorMode;

  // Sidebar
  sidebarPanel: SidebarPanel;
  /** Right-side panel (AI assistant) */
  rightPanel: RightPanel;
  /** 文件树面板宽度（px，persist） */
  filePanelWidth: number;
  /** AI 面板宽度（px，persist） */
  aiPanelWidth: number;
  /** Ordered list of workspace root directories */
  workspaceDirs: string[];
  /** Increment to signal FileExplorer to refresh the tree */
  fileTreeVersion: number;
  /** True once Zustand persist has rehydrated state from localStorage */
  _hasHydrated: boolean;

  /** Pending PlantUML AI fix request (opens AI panel when set) */
  plantUmlFixRequest: PlantUmlFixRequest | null;
  /** Monotonic id so AiPanel dedupes Strict Mode / effect re-runs */
  plantUmlFixRequestSeq: number;

  /** 分屏左侧占比（仅内存，不 persist） */
  splitPaneRatioByTabId: Record<string, number>;

  // ── Actions ─────────────────────────────────────────────────────────────────

  // Tab actions
  openTab: (file: NoteFile) => void;
  openSettingsTab: () => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  updateTabFile: (tabId: string, file: NoteFile) => void;

  // Legacy compat actions (delegates to tab actions)
  setContent: (content: string) => void;
  setCurrentFile: (file: NoteFile) => void;
  loadFile: (file: NoteFile) => void;

  // Task actions
  setTasks: (tasks: Task[]) => void;

  // Navigation actions
  setActiveView: (view: AppView) => void;

  // Editor mode actions
  setEditorMode: (mode: EditorMode) => void;
  setSplitPaneRatio: (tabId: string, ratio: number) => void;

  // Sidebar / panel actions
  setSidebarPanel: (panel: SidebarPanel) => void;
  setRightPanel: (panel: RightPanel) => void;
  setFilePanelWidth: (width: number) => void;
  setAiPanelWidth: (width: number) => void;
  requestPlantUmlAiFix: (req: PlantUmlFixRequest) => void;
  clearPlantUmlFixRequest: () => void;
  /** Add a workspace root (no-op if already present) */
  addWorkspaceDir: (dir: string) => void;
  /** Remove a workspace root by path */
  removeWorkspaceDir: (dir: string) => void;
  /** Trigger a file tree refresh */
  refreshFileTree: () => void;
  setHasHydrated: (v: boolean) => void;
}

/** Shape written to localStorage by `partialize` (persist middleware). */
type PersistedAppSlice = Pick<
  AppState,
  | 'tabs'
  | 'activeTabId'
  | 'tasks'
  | 'editorMode'
  | 'workspaceDirs'
  | 'sidebarPanel'
  | 'filePanelWidth'
  | 'aiPanelWidth'
>;

// ── Helpers ───────────────────────────────────────────────────────────────────
const getActiveTab = (tabs: EditorTab[], activeTabId: string): EditorTab | undefined =>
  tabs.find((t) => t.id === activeTabId);

/** Sync currentFile / content from active file tab into flat state fields */
const syncActive = (tabs: EditorTab[], activeTabId: string, fallback: NoteFile) => {
  const tab = getActiveTab(tabs, activeTabId);
  if (!tab || !isFileTab(tab)) {
    return { currentFile: fallback, content: '' };
  }
  return {
    currentFile: tab.file,
    content: tab.content,
  };
};

// ── Store implementation ──────────────────────────────────────────────────────
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      const initialFile = createNewFile();
      const initialTab: FileEditorTab = {
        kind: 'file',
        id: initialFile.path ?? `tab-${Date.now()}`,
        file: initialFile,
        content: initialFile.content,
      };

      return {
        // Initial state
        tabs: [initialTab],
        activeTabId: initialTab.id,
        currentFile: initialFile,
        content: initialFile.content,

        tasks: [],
        activeView: 'editor',
        editorMode: 'split',
        sidebarPanel: 'files',
        workspaceDirs: [],
        rightPanel: null,
        filePanelWidth: DEFAULT_FILE_PANEL_WIDTH_PX,
        aiPanelWidth: DEFAULT_AI_PANEL_WIDTH_PX,
        plantUmlFixRequest: null,
        plantUmlFixRequestSeq: 0,
        fileTreeVersion: 0,
        _hasHydrated: false,
        splitPaneRatioByTabId: {},

        // ── Tab actions ───────────────────────────────────────────────────────
        openTab: (file) =>
          set((state) => {
            const existingTab = file.path
              ? state.tabs.find(
                  (t): t is FileEditorTab => isFileTab(t) && t.file.path === file.path
                )
              : undefined;
            if (existingTab) {
              return {
                activeTabId: existingTab.id,
                ...syncActive(state.tabs, existingTab.id, file),
              };
            }
            const newTab: FileEditorTab = {
              kind: 'file',
              id: file.path ?? `tab-${Date.now()}`,
              file,
              content: file.content,
            };
            const newTabs = [...state.tabs, newTab];
            return {
              tabs: newTabs,
              activeTabId: newTab.id,
              ...syncActive(newTabs, newTab.id, file),
            };
          }),

        openSettingsTab: () =>
          set((state) => {
            const existing = state.tabs.find((t) => t.kind === 'settings');
            if (existing) {
              return {
                activeTabId: existing.id,
                activeView: 'editor',
              };
            }
            const settingsTab: SettingsEditorTab = {
              kind: 'settings',
              id: SETTINGS_TAB_ID,
              title: '设置',
            };
            const newTabs = [...state.tabs, settingsTab];
            return {
              tabs: newTabs,
              activeTabId: settingsTab.id,
              activeView: 'editor',
            };
          }),

        closeTab: (tabId) =>
          set((state) => {
            if (state.tabs.length <= 1) return {};
            const idx = state.tabs.findIndex((t) => t.id === tabId);
            const newTabs = state.tabs.filter((t) => t.id !== tabId);
            let newActiveTabId = state.activeTabId;
            if (state.activeTabId === tabId) {
              const nextTab = newTabs[Math.min(idx, newTabs.length - 1)];
              newActiveTabId = nextTab.id;
            }
            const nextActive = newTabs.find((t) => t.id === newActiveTabId);
            const extra =
              nextActive && isFileTab(nextActive)
                ? syncActive(newTabs, newActiveTabId, initialFile)
                : {};
            const splitPaneRatioByTabId = removeTabSplitRatio(
              state.splitPaneRatioByTabId,
              tabId
            );
            return {
              tabs: newTabs,
              activeTabId: newActiveTabId,
              splitPaneRatioByTabId,
              ...extra,
            };
          }),

        switchTab: (tabId) =>
          set((state) => {
            const target = state.tabs.find((t) => t.id === tabId);
            if (!target) return {};
            if (target.kind === 'settings') {
              return { activeTabId: tabId };
            }
            return {
              activeTabId: tabId,
              ...syncActive(state.tabs, tabId, initialFile),
            };
          }),

        updateTabContent: (tabId, content) =>
          set((state) => {
            const tab = state.tabs.find((t) => t.id === tabId);
            if (!tab || !isFileTab(tab)) return {};
            const newTabs = state.tabs.map((t) => {
              if (t.id !== tabId || !isFileTab(t)) return t;
              return {
                ...t,
                content,
                file:
                  content !== t.content ? { ...t.file, isDirty: true } : t.file,
              };
            });
            const extra =
              tabId === state.activeTabId
                ? syncActive(newTabs, tabId, initialFile)
                : {};
            return { tabs: newTabs, ...extra };
          }),

        updateTabFile: (tabId, file) =>
          set((state) => {
            const tab = state.tabs.find((t) => t.id === tabId);
            if (!tab || !isFileTab(tab)) return {};
            const newTabs = state.tabs.map((t) =>
              t.id === tabId && isFileTab(t) ? { ...t, file } : t
            );
            const extra =
              tabId === state.activeTabId ? { currentFile: file } : {};
            return { tabs: newTabs, ...extra };
          }),

        // ── Legacy compat ─────────────────────────────────────────────────────
        setContent: (content) => {
          const { activeTabId, updateTabContent, tabs } = get();
          const cur = tabs.find((t) => t.id === activeTabId);
          if (!cur || !isFileTab(cur)) return;
          updateTabContent(activeTabId, content);
        },

        setCurrentFile: (file) => {
          const { activeTabId, updateTabFile, tabs } = get();
          const cur = tabs.find((t) => t.id === activeTabId);
          if (!cur || !isFileTab(cur)) return;
          updateTabFile(activeTabId, file);
        },

        loadFile: (file) => {
          get().openTab(file);
        },

        // Task actions
        setTasks: (tasks) => set({ tasks }),

        // Navigation actions
        setActiveView: (view) => set({ activeView: view }),

        // Sidebar / panel actions
        setSidebarPanel: (panel) => set({ sidebarPanel: panel }),
        setRightPanel: (panel) => set({ rightPanel: panel }),
        setFilePanelWidth: (width) => set({ filePanelWidth: clampPanelWidth(width) }),
        setAiPanelWidth: (width) => set({ aiPanelWidth: clampPanelWidth(width) }),
        requestPlantUmlAiFix: (req) =>
          set((s) => ({
            plantUmlFixRequest: req,
            plantUmlFixRequestSeq: s.plantUmlFixRequestSeq + 1,
            rightPanel: 'ai',
          })),
        clearPlantUmlFixRequest: () => set({ plantUmlFixRequest: null }),
        addWorkspaceDir: (dir) =>
          set((s) => ({
            workspaceDirs: s.workspaceDirs.includes(dir)
              ? s.workspaceDirs
              : [...s.workspaceDirs, dir],
          })),
        removeWorkspaceDir: (dir) =>
          set((s) => ({ workspaceDirs: s.workspaceDirs.filter((d) => d !== dir) })),
        refreshFileTree: () => set((s) => ({ fileTreeVersion: s.fileTreeVersion + 1 })),
        setHasHydrated: (v) => set({ _hasHydrated: v }),

        // Editor mode actions
        setEditorMode: (mode) => set({ editorMode: mode }),
        setSplitPaneRatio: (tabId, ratio) =>
          set((s) => ({
            splitPaneRatioByTabId: {
              ...s.splitPaneRatioByTabId,
              [tabId]: clampSplitRatio(ratio),
            },
          })),
      };
    },
    {
      name: 'notez-app-state',
      version: 1,
      migrate: (persisted) => {
        const p = persisted as Partial<PersistedAppSlice> & { tabs?: unknown[] };
        // Persist layer types persisted tabs as file-only; strip any non-file tabs from legacy data.
        const normalizedTabs: FileEditorTab[] = Array.isArray(p.tabs)
          ? p.tabs.map(normalizeTab).filter(isFileTab)
          : [];
        return {
          tabs: normalizedTabs,
          activeTabId: p.activeTabId ?? '',
          tasks: p.tasks ?? [],
          editorMode: p.editorMode ?? 'split',
          workspaceDirs: p.workspaceDirs ?? [],
          sidebarPanel: p.sidebarPanel ?? 'files',
          filePanelWidth:
            typeof p.filePanelWidth === 'number'
              ? clampPanelWidth(p.filePanelWidth)
              : DEFAULT_FILE_PANEL_WIDTH_PX,
          aiPanelWidth:
            typeof p.aiPanelWidth === 'number'
              ? clampPanelWidth(p.aiPanelWidth)
              : DEFAULT_AI_PANEL_WIDTH_PX,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.tabs) {
          state.tabs = state.tabs.map(normalizeTab);
        }
        const legacyRp = state.rightPanel as string | null | undefined;
        if (legacyRp === 'settings') {
          state.rightPanel = null;
        }
        const fileTabs = (state.tabs ?? []).filter(isFileTab);
        const active = state.tabs?.find((t) => t.id === state.activeTabId);
        if (!active && fileTabs[0]) {
          state.activeTabId = fileTabs[0].id;
        }
        state.setHasHydrated(true);
      },
      partialize: (state) => {
        const fileTabs = state.tabs.filter(isFileTab);
        let activeTabId = state.activeTabId;
        const active = state.tabs.find((t) => t.id === activeTabId);
        if (active && !isFileTab(active)) {
          activeTabId = fileTabs[0]?.id ?? activeTabId;
        }
        return {
          tabs: fileTabs,
          activeTabId,
          tasks: state.tasks,
          editorMode: state.editorMode,
          workspaceDirs: state.workspaceDirs,
          sidebarPanel: state.sidebarPanel,
          filePanelWidth: state.filePanelWidth,
          aiPanelWidth: state.aiPanelWidth,
        };
      },
    }
  )
);
