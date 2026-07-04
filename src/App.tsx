import { useEffect, useRef, useCallback } from "react";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { TaskBoardUI } from "./components/TaskBoardUI";
import { Sidebar } from "./components/Sidebar";
import { FileExplorer } from "./components/FileExplorer";
import { AiPanel } from "./components/AiPanel";
import { TabBar } from "./components/TabBar";
import { SettingsDialog } from './components/settings/SettingsDialog';
import { PanelResizeHandle } from "./components/PanelResizeHandle";
import { useAppStore, isFileTab } from "./store/useAppStore";
import { useSettingsStore } from "./store/useSettingsStore";
import {
  saveMarkdownFileTauri,
  isTauri,
  saveMarkdownFile,
  createNewFile,
  openMarkdownFileTauri,
  openMarkdownFile,
  openMarkdownFileFromPath,
} from "./components/FileOperations";
import {
  clampPanelWidthInLayout,
  PANEL_RESIZE_GUTTER_PX,
} from "./utils/panelWidth";
import "./App.css";
import { consumePlantUmlFixPayload } from "./components/plantuml-offline/plantumlErrorUi";

function App() {
  const {
    currentFile, content,
    activeTabId,
    tabs,
    tasks, setTasks,
    activeView,
    sidebarPanel,
    rightPanel,
    filePanelWidth,
    aiPanelWidth,
    setFilePanelWidth,
    setAiPanelWidth,
    loadFile, updateTabFile, refreshFileTree,
    settingsDialogOpen,
    closeSettingsDialog,
  } = useAppStore();

  const panelsLayoutRef = useRef<HTMLDivElement>(null);
  const showFilePanel = sidebarPanel === 'files';
  const showAiPanel = rightPanel === 'ai';

  const getLayoutWidth = useCallback(() => {
    return panelsLayoutRef.current?.getBoundingClientRect().width ?? 0;
  }, []);

  const handleFilePanelResize = useCallback(
    (clientX: number) => {
      const layout = panelsLayoutRef.current;
      if (!layout) return;
      const left = layout.getBoundingClientRect().left;
      const otherPanels =
        (showAiPanel ? aiPanelWidth + PANEL_RESIZE_GUTTER_PX : 0) +
        (showFilePanel ? PANEL_RESIZE_GUTTER_PX : 0);
      const width = clampPanelWidthInLayout(
        clientX - left,
        getLayoutWidth(),
        otherPanels
      );
      setFilePanelWidth(width);
    },
    [aiPanelWidth, getLayoutWidth, setFilePanelWidth, showAiPanel, showFilePanel]
  );

  const handleAiPanelResize = useCallback(
    (clientX: number) => {
      const layout = panelsLayoutRef.current;
      if (!layout) return;
      const right = layout.getBoundingClientRect().right;
      const otherPanels =
        (showFilePanel ? filePanelWidth + PANEL_RESIZE_GUTTER_PX : 0) +
        (showAiPanel ? PANEL_RESIZE_GUTTER_PX : 0);
      const width = clampPanelWidthInLayout(
        right - clientX,
        getLayoutWidth(),
        otherPanels
      );
      setAiPanelWidth(width);
    },
    [filePanelWidth, getLayoutWidth, setAiPanelWidth, showAiPanel, showFilePanel]
  );

  const { initSettings } = useSettingsStore();

  // Load settings from disk on startup
  useEffect(() => { initSettings(); }, []);

  // PlantUML error UI: delegate AI fix button clicks (preview + WYSIWYG innerHTML)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.('.plantuml-ai-fix-btn');
      if (!target || !(target instanceof HTMLElement)) return;
      if (target.hasAttribute('data-fix-handled')) return;
      const fixId = target.getAttribute('data-fix-id');
      if (!fixId) return;
      e.preventDefault();
      e.stopPropagation();
      target.setAttribute('data-fix-handled', '1');
      const payload = consumePlantUmlFixPayload(fixId);
      if (payload) {
        useAppStore.getState().requestPlantUmlAiFix(payload);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // ── Windows / desktop: open file from argv (file association) or second-instance emit ──
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const openFromPath = async (filePath: string) => {
      const noteFile = await openMarkdownFileFromPath(filePath);
      if (!cancelled && noteFile) loadFile(noteFile);
    };

    const runCliOpen = async () => {
      try {
        const { getMatches } = await import('@tauri-apps/plugin-cli');
        const matches = await getMatches();
        const raw = matches.args.path?.value;
        const pathVal = typeof raw === 'string' ? raw : undefined;
        if (pathVal && pathVal.length > 0) {
          await openFromPath(pathVal);
        }
      } catch (e) {
        console.warn('CLI matches:', e);
      }
    };

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;
        unlisten = await listen<string>('open-markdown-path', (event) => {
          const p = event.payload;
          if (typeof p === 'string' && p.length > 0) void openFromPath(p);
        });
      } catch {
        /* e.g. missing event permission in dev misconfig */
      }
    })();

    const unsubHydration = useAppStore.persist.onFinishHydration(() => {
      void runCliOpen();
    });
    if (useAppStore.persist.hasHydrated()) {
      void runCliOpen();
    }

    return () => {
      cancelled = true;
      unsubHydration();
      unlisten?.();
    };
  }, [loadFile]);

  // ── Auto-save: debounce 1s after active tab content changes ───────────────
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  const contentRef = useRef(content);
  const fileRef = useRef(currentFile);
  activeTabIdRef.current = activeTabId;
  contentRef.current = content;
  fileRef.current = currentFile;

  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab || !isFileTab(activeTab)) return;
    if (!currentFile.isDirty) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const file = fileRef.current;
      const tabId = activeTabIdRef.current;
      const c = contentRef.current;
      if (!file.isDirty) return;
      const st = useAppStore.getState();
      const tNow = st.tabs.find((x) => x.id === tabId);
      if (!tNow || !isFileTab(tNow)) return;

      if (isTauri()) {
        try {
          const savedPath = await saveMarkdownFileTauri(file, c);
          if (savedPath) {
            updateTabFile(tabId, { ...file, isDirty: false, path: savedPath });
            refreshFileTree();
          }
        } catch (err) {
          console.error('Auto-save failed:', err);
        }
      } else {
        // Browser: just mark clean (no silent download)
        updateTabFile(tabId, { ...file, isDirty: false });
      }
    }, 1000);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [content, currentFile.isDirty, activeTabId, tabs]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const { settingsDialogOpen, closeSettingsDialog, rightPanel, setRightPanel } = useAppStore.getState();
        if (settingsDialogOpen) {
          closeSettingsDialog();
          e.preventDefault();
        } else if (rightPanel) {
          setRightPanel(null);
          e.preventDefault();
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === 'n') {
        e.preventDefault();
        const newFile = createNewFile();
        loadFile(newFile);
      } else if (e.key === 'o') {
        e.preventDefault();
        if (isTauri()) {
          const noteFile = await openMarkdownFileTauri();
          if (noteFile) loadFile(noteFile);
        } else {
          const input = document.getElementById('__notez-open-input__') as HTMLInputElement | null;
          input?.click();
        }
      } else if (e.key === 's') {
        e.preventDefault();
        const { activeTabId: aid, tabs: tabList } = useAppStore.getState();
        const curTab = tabList.find((t) => t.id === aid);
        if (!curTab || !isFileTab(curTab)) return;
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        const file = fileRef.current;
        const tabId = activeTabIdRef.current;
        const c = contentRef.current;
        if (isTauri()) {
          const savedPath = await saveMarkdownFileTauri(file, c);
          if (savedPath) updateTabFile(tabId, { ...file, isDirty: false, path: savedPath });
        } else {
          const { blob, filename } = saveMarkdownFile(c, file.title);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          a.click();
          updateTabFile(tabId, { ...file, isDirty: false });
        }
      } else if (e.key === 'w') {
        e.preventDefault();
        const { tabs: tabList, activeTabId: aid, closeTab } = useAppStore.getState();
        if (tabList.length > 1) closeTab(aid);
      } else if (e.key === ',') {
        e.preventDefault();
        useAppStore.getState().toggleSettingsDialog();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loadFile, updateTabFile]);

  return (
    <div className="h-screen flex flex-col notez-app-shell">
      {/* Hidden browser file open input */}
      <input
        id="__notez-open-input__"
        type="file"
        accept=".md,.txt,.markdown"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            const noteFile = await openMarkdownFile(file);
            loadFile(noteFile);
          }
          e.target.value = '';
        }}
      />

      <SettingsDialog open={settingsDialogOpen} onClose={closeSettingsDialog} />

      {/* ── Body: Sidebar + Left Panel + Main + Right Panel ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Narrow icon sidebar */}
        <Sidebar />

        <div ref={panelsLayoutRef} className="flex flex-1 min-w-0 overflow-hidden">
          {/* Left: File explorer panel */}
          {showFilePanel && (
            <div
              className="flex-shrink-0 notez-panel overflow-hidden flex flex-col"
              style={{ width: filePanelWidth }}
            >
              <FileExplorer />
            </div>
          )}

          {showFilePanel && (
            <PanelResizeHandle
              aria-label="调整文件树宽度"
              onDrag={handleFilePanelResize}
            />
          )}

          {/* Main content */}
          <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
            {activeView === 'editor' ? (
              <>
                {/* Tab bar — only when multiple tabs or always for consistency */}
                {tabs.length > 0 && <TabBar />}
                <MarkdownEditor
                  key={activeTabId}
                  content={content}
                  onChange={(c) => useAppStore.getState().setContent(c)}
                />
              </>
            ) : (
              <TaskBoardUI tasks={tasks} onTasksChange={setTasks} />
            )}
          </main>

          {showAiPanel && (
            <PanelResizeHandle
              aria-label="调整 AI 面板宽度"
              onDrag={handleAiPanelResize}
            />
          )}

          {/* Right: AI assistant panel */}
          {showAiPanel && (
            <div
              className="flex-shrink-0 notez-panel overflow-hidden flex flex-col"
              style={{ width: aiPanelWidth }}
            >
              <AiPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
