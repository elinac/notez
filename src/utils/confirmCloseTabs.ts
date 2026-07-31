import { useAppStore } from '../store/useAppStore';
import { confirmAction } from './nativeDialog';
import {
  countDirtyInTargets,
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

  const dirtyCount = countDirtyInTargets(tabs, targetIds);
  if (dirtyCount > 0) {
    const ok = await confirmAction(
      `有 ${dirtyCount} 个未保存的标签，关闭后修改将丢失。确定关闭？`,
      { okLabel: '关闭', cancelLabel: '取消' },
    );
    if (!ok) return;
  }

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
