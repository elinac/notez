import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type FileEditorTab } from '../../store/useAppStore';
import { confirmAndCloseTabs } from '../confirmCloseTabs';

vi.mock('../nativeDialog', () => ({
  confirmAction: vi.fn(),
}));

import { confirmAction } from '../nativeDialog';

function makeTab(id: string, dirty = false): FileEditorTab {
  return {
    kind: 'file',
    id,
    content: `c-${id}`,
    file: {
      id: `f-${id}`,
      title: id,
      content: `c-${id}`,
      isDirty: dirty,
    },
  };
}

describe('confirmAndCloseTabs', () => {
  beforeEach(() => {
    vi.mocked(confirmAction).mockReset();
    localStorage.clear();
    const a = makeTab('a', true);
    const b = makeTab('b');
    useAppStore.setState({
      tabs: [a, b],
      activeTabId: 'b',
      currentFile: b.file,
      content: b.content,
      splitPaneRatioByTabId: {},
    });
  });

  it('dirty 且用户取消 → tabs 不变', async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(confirmAction).toHaveBeenCalled();
  });

  it('dirty 且用户确认 → 执行关闭', async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('无 dirty → 不弹确认并关闭', async () => {
    useAppStore.setState({
      tabs: [makeTab('a'), makeTab('b')],
      activeTabId: 'b',
    });
    await confirmAndCloseTabs('others', 'b');
    expect(confirmAction).not.toHaveBeenCalled();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('确认后锚点已消失 → no-op', async () => {
    vi.mocked(confirmAction).mockImplementation(async () => {
      useAppStore.setState({
        tabs: [makeTab('a', true)],
        activeTabId: 'a',
        currentFile: makeTab('a', true).file,
        content: 'c-a',
      });
      return true;
    });
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a']);
  });
});
