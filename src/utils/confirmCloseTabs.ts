import { isFileTab, useAppStore } from '../store/useAppStore';
import { resolveUnsavedTabs } from './resolveUnsavedTabs';
import {
  getCloseTargetIds,
  type TabCloseAction,
} from './tabCloseTargets';

export async function confirmAndCloseTabs(
  action: TabCloseAction,
  anchorId: string,
): Promise<void> {
  const { tabs } = useAppStore.getState();
  const targetIds = getCloseTargetIds(tabs, action, anchorId);

  // `all` 即使仅 1 个 tab 也继续；其它 action 无目标则结束
  if (action !== 'all' && targetIds.length === 0) return;

  const idSet = new Set(targetIds);
  const dirtyTabs = tabs.filter(
    (t) => idSet.has(t.id) && isFileTab(t) && t.file.isDirty,
  );

  const result = await resolveUnsavedTabs(dirtyTabs);
  if (result === 'abort') return;

  const state = useAppStore.getState();
  if (action !== 'all' && !state.tabs.some((t) => t.id === anchorId)) {
    return;
  }

  switch (action) {
    case 'close':
      state.closeTab(anchorId);
      break;
    case 'others':
      state.closeOtherTabs(anchorId);
      break;
    case 'left':
      state.closeTabsToLeft(anchorId);
      break;
    case 'right':
      state.closeTabsToRight(anchorId);
      break;
    case 'all':
      state.closeAllTabs();
      break;
  }
}
