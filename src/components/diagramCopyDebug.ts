/**
 * 开发态复制诊断：控制台输出 + sessionStorage 保留最近一次失败详情。
 * 在 DevTools 执行 `localStorage.setItem('notez-diagram-copy-debug','1')` 可强制开启。
 */

export interface DiagramCopyDebugEntry {
  at: string;
  phase: string;
  ok: boolean;
  detail?: Record<string, unknown>;
  error?: string;
}

const STORAGE_KEY = 'notez-diagram-copy-last-debug';

export function isDiagramCopyDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('notez-diagram-copy-debug') === '1';
  } catch {
    return false;
  }
}

export function recordDiagramCopyDebug(entry: Omit<DiagramCopyDebugEntry, 'at'>): void {
  if (!isDiagramCopyDebugEnabled()) return;

  const full: DiagramCopyDebugEntry = { ...entry, at: new Date().toISOString() };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch {
    /* ignore quota */
  }

  const tag = `[diagramCopy:${entry.phase}]`;
  if (entry.ok) {
    console.info(tag, entry.detail ?? '');
  } else {
    console.error(tag, entry.error ?? 'failed', entry.detail ?? '');
  }
}

export function readLastDiagramCopyDebug(): DiagramCopyDebugEntry | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DiagramCopyDebugEntry) : null;
  } catch {
    return null;
  }
}
