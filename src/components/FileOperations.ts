/**
 * File operations for NoteZ
 * Handles opening, saving, and managing markdown files.
 * Adapts to Tauri (native dialogs + fs) when running as desktop app,
 * falls back to browser File API when running in web/dev mode.
 */

/** Runtime check: are we inside a Tauri desktop app? */
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface NoteFile {
  id: string;
  title: string;
  content: string;
  path?: string;
  extension?: string;
  isDirty: boolean;
  lastModified?: number;
}

export interface RecentFile {
  id: string;
  title: string;
  path: string;
  lastOpened: number;
  /** Stored content snapshot — enables re-opening from recent list without native FS */
  content?: string;
}

const RECENT_FILES_KEY = 'notez_recent_files';
const MAX_RECENT_FILES = 10;
/** Max bytes stored per file in recent-content cache (~100 KB) */
const MAX_CONTENT_BYTES = 100_000;

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize filename by removing illegal characters
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Extract title from filename (remove extension)
 */
function extractTitle(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

/**
 * Create a new file with default content
 */
export function createNewFile(): NoteFile {
  const now = Date.now();
  return {
    id: generateId(),
    title: '无标题',
    content: `# 无标题

在这里开始记录你的笔记…`,
    extension: '.md',
    isDirty: false,
    lastModified: now,
  };
}

/**
 * Open a markdown file from File object
 */
export function openMarkdownFile(file: File): Promise<NoteFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const content = e.target?.result as string || '';
      const filename = file.name;
      const title = extractTitle(filename);
      const extension = filename.substring(filename.lastIndexOf('.')) || '.md';
      
      const noteFile: NoteFile = {
        id: generateId(),
        title,
        content,
        path: file.name,
        extension,
        isDirty: false,
        lastModified: file.lastModified,
      };
      
      // Add to recent files (include content snapshot for re-opening)
      addRecentFile({
        id: noteFile.id,
        title: noteFile.title,
        path: file.name,
        lastOpened: Date.now(),
        content,
      });
      
      resolve(noteFile);
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
}

/**
 * Prepare file content for saving
 */
export function saveMarkdownFile(content: string, title: string): { blob: Blob; filename: string } {
  const sanitizedTitle = sanitizeFilename(title);
  const filename = sanitizedTitle.endsWith('.md') ? sanitizedTitle : `${sanitizedTitle}.md`;
  const blob = new Blob([content], { type: 'text/markdown' });
  
  return { blob, filename };
}

/**
 * Download file to user's computer
 */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Get recent files from localStorage
 */
export function getRecentFiles(): RecentFile[] {
  try {
    const stored = localStorage.getItem(RECENT_FILES_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load recent files:', error);
  }
  return [];
}

/**
 * Add a file to recent files list
 */
export function addRecentFile(file: RecentFile): void {
  try {
    const recent = getRecentFiles();

    // Remove existing entry with same path
    const filtered = recent.filter(f => f.path !== file.path);

    // Trim content to avoid blowing up localStorage
    const entry: RecentFile = {
      ...file,
      content: file.content
        ? file.content.slice(0, MAX_CONTENT_BYTES)
        : undefined,
    };

    // Add new file at the beginning
    filtered.unshift(entry);

    // Keep only MAX_RECENT_FILES
    const trimmed = filtered.slice(0, MAX_RECENT_FILES);

    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to save recent file:', error);
  }
}

/**
 * Remove a file from recent files list
 */
export function removeRecentFile(path: string): void {
  try {
    const recent = getRecentFiles();
    const filtered = recent.filter(f => f.path !== path);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to remove recent file:', error);
  }
}

/**
 * Clear all recent files
 */
export function clearRecentFiles(): void {
  try {
    localStorage.removeItem(RECENT_FILES_KEY);
  } catch (error) {
    console.error('Failed to clear recent files:', error);
  }
}

// ── Tauri-aware open / save ────────────────────────────────────────────────

/**
 * Open a markdown file.
 * - In Tauri: shows native file open dialog, reads via @tauri-apps/plugin-fs.
 * - In browser: triggers the hidden <input type="file"> (caller handles it).
 *
 * Returns a NoteFile, or null if the user cancelled.
 */
export async function openMarkdownFileTauri(): Promise<NoteFile | null> {
  if (!IS_TAURI) return null;

  const { open } = await import('@tauri-apps/plugin-dialog');

  const selected = await open({
    title: 'Open Markdown File',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    multiple: false,
  });

  if (!selected || Array.isArray(selected)) return null;

  const filePath = selected as string;
  return loadNoteFileFromNativePath(filePath);
}

/** Read a native path into a NoteFile (any extension; used by file dialog). */
async function loadNoteFileFromNativePath(filePath: string): Promise<NoteFile | null> {
  if (!IS_TAURI) return null;

  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const content = await readTextFile(filePath);

    const segments = filePath.replace(/\\/g, '/').split('/');
    const filename = segments[segments.length - 1] || filePath;
    const title = extractTitle(filename);
    const dot = filename.lastIndexOf('.');
    const extension = dot > 0 ? filename.substring(dot) : '.md';

    const noteFile: NoteFile = {
      id: generateId(),
      title,
      content,
      path: filePath,
      extension,
      isDirty: false,
      lastModified: Date.now(),
    };

    addRecentFile({
      id: noteFile.id,
      title: noteFile.title,
      path: filePath,
      lastOpened: Date.now(),
      content,
    });

    return noteFile;
  } catch (err) {
    console.error('loadNoteFileFromNativePath:', err);
    return null;
  }
}

/**
 * Open a markdown file from an absolute / native path (e.g. OS file association, CLI arg).
 * Only accepts .md / .markdown. Returns null if not in Tauri, wrong extension, or read fails.
 */
export async function openMarkdownFileFromPath(filePath: string): Promise<NoteFile | null> {
  if (!IS_TAURI) return null;

  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) {
    return null;
  }

  return loadNoteFileFromNativePath(filePath);
}

/**
 * Save the current file.
 * - In Tauri: shows native save dialog (or writes to existing path) via @tauri-apps/plugin-fs.
 * - In browser: triggers browser download.
 *
 * Returns the path saved to, or null if cancelled.
 */
export async function saveMarkdownFileTauri(
  currentFile: NoteFile,
  content: string
): Promise<string | null> {
  if (!IS_TAURI) {
    // Fallback: browser download
    const { blob, filename } = saveMarkdownFile(content, currentFile.title);
    downloadFile(blob, filename);
    return currentFile.path ?? currentFile.title + '.md';
  }

  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  // If we already have a native path, write directly without dialog
  let savePath = currentFile.path;

  if (!savePath || savePath === currentFile.title) {
    // New file or browser-opened file — show save-as dialog
    const selected = await save({
      title: 'Save Markdown File',
      defaultPath: currentFile.title + '.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (!selected) return null;
    savePath = selected as string;
  }

  await writeTextFile(savePath, content);
  return savePath;
}

/** Returns true when running inside a Tauri desktop shell */
export const isTauri = () => IS_TAURI;
