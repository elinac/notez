/**
 * FileExplorer — Multi-root workspace file tree panel
 *
 * Supports multiple workspace root directories, each shown as a top-level
 * collapsible node (similar to VS Code multi-root workspaces).
 *
 * Uses Tauri plugin-fs + plugin-dialog in desktop mode.
 * Shows a placeholder in browser/dev mode.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FolderOpen,
  FolderClosed,
  FileText,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  FilePlus,
  FolderPlus,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { NoteFile, isTauri, createNewFile } from './FileOperations';
import { confirmAction, promptNewFilePath } from '../utils/nativeDialog';
import { isSameNormalizedPath } from '../utils/workspacePath';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

interface ContextMenu {
  x: number;
  y: number;
  node: FileNode;
  /** The workspace root this node belongs to */
  workspaceDir: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Recursively read directory, returning only dirs and .md/.markdown/.txt files */
async function readDirRecursive(dirPath: string): Promise<FileNode[]> {
  const { readDir } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  const entries = await readDir(dirPath);

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = await join(dirPath, entry.name);

    if (entry.isDirectory) {
      const children = await readDirRecursive(fullPath);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: fullPath, isDir: true, children });
      }
    } else if (
      entry.name.endsWith('.md') ||
      entry.name.endsWith('.markdown') ||
      entry.name.endsWith('.txt')
    ) {
      nodes.push({ name: entry.name, path: fullPath, isDir: false });
    }
  }

  return nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── TreeItem ───────────────────────────────────────────────────────────────────

function TreeItem({
  node,
  depth,
  onFileClick,
  onContextMenu,
  activePath,
}: {
  node: FileNode;
  depth: number;
  onFileClick: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  activePath: string | undefined;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const indent = depth * 12;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="flex items-center gap-1 w-full px-2 py-0.5 text-left text-xs text-gray-600 hover:bg-gray-100 transition-colors"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          {expanded ? (
            <ChevronDown size={12} className="flex-shrink-0 text-gray-400" />
          ) : (
            <ChevronRight size={12} className="flex-shrink-0 text-gray-400" />
          )}
          {expanded ? (
            <FolderOpen size={13} className="flex-shrink-0 text-yellow-500" />
          ) : (
            <FolderClosed size={13} className="flex-shrink-0 text-yellow-500" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
              activePath={activePath}
            />
          ))}
      </div>
    );
  }

  const isActive =
    activePath != null && isSameNormalizedPath(activePath, node.path);
  return (
    <button
      onClick={() => onFileClick(node)}
      onContextMenu={(e) => onContextMenu(e, node)}
      title={node.path}
      className={`flex items-center gap-1.5 w-full py-0.5 text-left text-xs truncate transition-colors ${
        isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
      }`}
      style={{ paddingLeft: `${20 + indent}px`, paddingRight: '8px' }}
    >
      <FileText size={12} className="flex-shrink-0 text-gray-400" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ── WorkspaceSection ───────────────────────────────────────────────────────────

/**
 * One workspace root rendered as a collapsible top-level section.
 */
function WorkspaceSection({
  dir,
  ephemeral = false,
  fileTreeVersion,
  activePath,
  onFileClick,
  onContextMenu,
  onRemove,
  onNewFile,
}: {
  dir: string;
  ephemeral?: boolean;
  fileTreeVersion: number;
  activePath: string | undefined;
  onFileClick: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode, workspaceDir: string) => void;
  onRemove: (dir: string) => void;
  onNewFile: (dir: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirName = dir.replace(/\\/g, '/').split('/').pop() ?? dir;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTree(await readDirRecursive(dir));
    } catch (err) {
      setError(`读取失败: ${String(err)}`);
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [dir]);

  useEffect(() => {
    if (isTauri()) load();
  }, [load, fileTreeVersion]);

  return (
    <div className="flex flex-col">
      {/* Section header */}
      <div className="flex items-center justify-between px-1.5 py-1 bg-gray-100 border-b border-gray-200 group sticky top-0 z-10">
        <button
          className="flex items-center gap-1 min-w-0 flex-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          title={dir}
        >
          {expanded ? (
            <ChevronDown size={11} className="flex-shrink-0 text-gray-400" />
          ) : (
            <ChevronRight size={11} className="flex-shrink-0 text-gray-400" />
          )}
          <FolderOpen
            size={12}
            className={`flex-shrink-0 ${ephemeral ? 'text-gray-500' : 'text-yellow-500'}`}
          />
          <span className="text-xs font-semibold text-gray-700 truncate ml-0.5">
            {dirName}
            {ephemeral && (
              <span className="ml-1 text-[10px] font-normal text-gray-400">临时</span>
            )}
          </span>
        </button>
        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onNewFile(dir)}
            title="在此工作区新建文件"
            className="p-0.5 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <FilePlus size={11} />
          </button>
          <button
            onClick={() => load()}
            title="刷新"
            className="p-0.5 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <RefreshCw size={11} />
          </button>
          <button
            onClick={() => onRemove(dir)}
            title={ephemeral ? '移除此临时工作区' : '移除此工作区'}
            className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Tree body */}
      {expanded && (
        <div className="py-0.5">
          {loading && <div className="text-xs text-gray-400 px-3 py-1">加载中…</div>}
          {error && <div className="text-xs text-red-400 px-3 py-1 break-all">{error}</div>}
          {!loading && !error && tree.length === 0 && (
            <div className="text-xs text-gray-400 px-3 py-1">目录为空</div>
          )}
          {!loading &&
            tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                onFileClick={onFileClick}
                onContextMenu={(e, n) => onContextMenu(e, n, dir)}
                activePath={activePath}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── FileExplorer ───────────────────────────────────────────────────────────────

export function FileExplorer() {
  const {
    workspaceDirs,
    ephemeralWorkspaceDirs,
    addWorkspaceDir,
    removeWorkspaceDir,
    removeEphemeralWorkspaceDir,
    loadFile,
    currentFile,
    refreshFileTree,
    fileTreeVersion,
    _hasHydrated,
  } = useAppStore();

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renaming, setRenaming] = useState<{ node: FileNode; value: string } | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click; Escape dismisses menu/rename
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setRenaming(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleAddWorkspace = async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title: '添加工作区目录' });
    if (selected && !Array.isArray(selected)) {
      addWorkspaceDir(selected as string);
    }
  };

  const handleNewFileInWorkspace = async (dir: string) => {
    const newFile = createNewFile();
    loadFile(newFile);
    if (dir) refreshFileTree();
  };

  const handleFileClick = async (node: FileNode) => {
    if (!isTauri()) return;
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(node.path);
      const title = node.name.replace(/\.(md|markdown|txt)$/, '');
      const noteFile: NoteFile = {
        id: generateId(),
        title,
        content,
        path: node.path,
        extension: '.md',
        isDirty: false,
        lastModified: Date.now(),
      };
      loadFile(noteFile);
    } catch (err) {
      setGlobalError(`打开文件失败: ${String(err)}`);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode, workspaceDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node, workspaceDir });
  };

  const handleRename = () => {
    if (!contextMenu) return;
    setRenaming({ node: contextMenu.node, value: contextMenu.node.name });
    setContextMenu(null);
  };

  const handleRenameSubmit = async () => {
    if (!renaming || !renaming.value.trim()) { setRenaming(null); return; }
    const newName = renaming.value.trim();
    if (newName === renaming.node.name) { setRenaming(null); return; }
    try {
      const { rename } = await import('@tauri-apps/plugin-fs');
      const { join, dirname } = await import('@tauri-apps/api/path');
      const dir = await dirname(renaming.node.path);
      const newPath = await join(dir, newName);
      await rename(renaming.node.path, newPath);
      refreshFileTree();
    } catch (err) {
      setGlobalError(`重命名失败: ${String(err)}`);
    }
    setRenaming(null);
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const node = contextMenu.node;
    setContextMenu(null);
    const label = node.isDir ? '目录' : '文件';
    const ok = await confirmAction(`确定要删除${label}「${node.name}」吗？`, {
      okLabel: '删除',
      cancelLabel: '取消',
    });
    if (!ok) return;
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      await remove(node.path, { recursive: node.isDir });
      refreshFileTree();
    } catch (err) {
      setGlobalError(`删除失败: ${String(err)}`);
    }
  };

  const handleNewFileInDir = async () => {
    if (!contextMenu) return;
    const node = contextMenu.node;
    const dirPath = node.isDir
      ? node.path
      : await (async () => {
          const { dirname } = await import('@tauri-apps/api/path');
          return dirname(node.path);
        })();
    setContextMenu(null);
    const newPath = await promptNewFilePath(dirPath);
    if (!newPath) return;
    try {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const baseName = newPath.replace(/^.*[/\\]/, '').replace(/\.(md|markdown|txt)$/i, '');
      await writeTextFile(newPath, `# ${baseName}\n\n在这里开始记录你的笔记…`);
      refreshFileTree();
    } catch (err) {
      setGlobalError(`新建失败: ${String(err)}`);
    }
  };

  const visibleEphemeralDirs = ephemeralWorkspaceDirs.filter(
    (e) => !workspaceDirs.some((w) => isSameNormalizedPath(w, e))
  );

  // ── Non-Tauri fallback ────────────────────────────────────────────────────
  if (!isTauri()) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-center p-4">
        <FolderOpen size={32} className="text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">文件管理在桌面应用中可用</p>
      </div>
    );
  }

  // ── Waiting for persist hydration ────────────────────────────────────────
  if (!_hasHydrated) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-center p-4">
        <div className="text-xs text-gray-400">正在恢复工作区…</div>
      </div>
    );
  }

  // ── No workspaces yet ────────────────────────────────────────────────────
  if (workspaceDirs.length === 0 && visibleEphemeralDirs.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-center p-4 gap-3">
        <FolderOpen size={32} className="text-gray-300" />
        <p className="text-xs text-gray-500">未添加工作区</p>
        <button
          onClick={handleAddWorkspace}
          className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          添加工作区目录
        </button>
      </div>
    );
  }

  // ── Multi-root workspace view ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Panel toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <span className="text-xs font-medium text-gray-600">工作区</span>
        <button
          onClick={handleAddWorkspace}
          title="添加工作区目录"
          className="p-0.5 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <FolderPlus size={13} />
        </button>
      </div>

      {/* Global error */}
      {globalError && (
        <div className="text-xs text-red-400 px-3 py-1.5 border-b border-red-100 break-all flex items-start gap-1">
          <span className="flex-1">{globalError}</span>
          <button onClick={() => setGlobalError(null)} className="flex-shrink-0 text-red-300 hover:text-red-500">
            <X size={11} />
          </button>
        </div>
      )}

      {/* Scrollable workspace list */}
      <div className="flex-1 overflow-y-auto">
        {workspaceDirs.map((dir) => (
          <WorkspaceSection
            key={dir}
            dir={dir}
            fileTreeVersion={fileTreeVersion}
            activePath={currentFile.path}
            onFileClick={handleFileClick}
            onContextMenu={handleContextMenu}
            onRemove={removeWorkspaceDir}
            onNewFile={handleNewFileInWorkspace}
          />
        ))}
        {visibleEphemeralDirs.map((dir) => (
          <WorkspaceSection
            key={`ephemeral:${dir}`}
            dir={dir}
            ephemeral
            fileTreeVersion={fileTreeVersion}
            activePath={currentFile.path}
            onFileClick={handleFileClick}
            onContextMenu={handleContextMenu}
            onRemove={removeEphemeralWorkspaceDir}
            onNewFile={handleNewFileInWorkspace}
          />
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-native-context-menu
          className="fixed z-50 notez-panel border border-gray-200 rounded shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '130px' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleNewFileInDir}
            className="w-full px-3 py-1.5 text-left hover:bg-gray-100"
          >
            {contextMenu.node.isDir ? '在此目录新建文件' : '新建文件到此处'}
          </button>
          <button
            onClick={handleRename}
            className="w-full px-3 py-1.5 text-left hover:bg-gray-100"
          >
            重命名
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            onClick={handleDelete}
            className="w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
          >
            删除
          </button>
        </div>
      )}

      {/* Rename dialog */}
      {renaming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-72 shadow-xl">
            <p className="text-sm font-medium mb-2">重命名</p>
            <input
              className="w-full px-2 py-1.5 text-sm border border-blue-400 rounded outline-none mb-3"
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') setRenaming(null);
              }}
              autoFocus
              onFocus={(e) => e.target.select()}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRenaming(null)}
                className="px-3 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleRenameSubmit}
                className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
