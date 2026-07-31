import type { EditorTab } from '../store/useAppStore';

export type TabCloseAction = 'close' | 'others' | 'left' | 'right' | 'all';

export function getCloseTargetIds(
  tabs: EditorTab[],
  action: TabCloseAction,
  anchorTabId: string,
): string[] {
  if (action === 'all') {
    return tabs.map((t) => t.id);
  }
  const idx = tabs.findIndex((t) => t.id === anchorTabId);
  if (idx < 0) return [];

  switch (action) {
    case 'close':
      return [anchorTabId];
    case 'others':
      return tabs.filter((t) => t.id !== anchorTabId).map((t) => t.id);
    case 'left':
      return tabs.slice(0, idx).map((t) => t.id);
    case 'right':
      return tabs.slice(idx + 1).map((t) => t.id);
    default:
      return [];
  }
}

export function countDirtyInTargets(tabs: EditorTab[], ids: string[]): number {
  const idSet = new Set(ids);
  // EditorTab 目前仅 file 一种；直接读 file.isDirty，避免对 useAppStore 的值导入环依赖
  return tabs.filter((t) => idSet.has(t.id) && t.file.isDirty).length;
}
