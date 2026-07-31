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

  it('close dirty 取消 → 不关', async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    await confirmAndCloseTabs('close', 'a');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(confirmAction).toHaveBeenCalled();
  });

  it('all 单 dirty tab 确认后换成新建标签', async () => {
    const only = makeTab('only', true);
    useAppStore.setState({
      tabs: [only],
      activeTabId: 'only',
      currentFile: only.file,
      content: only.content,
      splitPaneRatioByTabId: { only: 0.5 },
    });
    vi.mocked(confirmAction).mockResolvedValue(true);
    await confirmAndCloseTabs('all', 'only');
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).not.toBe('only');
    expect(s.currentFile.title).toBe('无标题');
    expect(s.splitPaneRatioByTabId).toEqual({});
    expect(confirmAction).toHaveBeenCalled();
  });

  it('all 无 dirty → 不确认并换成新建标签', async () => {
    useAppStore.setState({
      tabs: [makeTab('a'), makeTab('b')],
      activeTabId: 'b',
    });
    await confirmAndCloseTabs('all', 'b');
    const s = useAppStore.getState();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(s.tabs).toHaveLength(1);
    expect(s.currentFile.title).toBe('无标题');
  });
});
