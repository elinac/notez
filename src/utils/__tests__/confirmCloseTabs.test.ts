import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type FileEditorTab } from '../../store/useAppStore';
import { confirmAndCloseTabs } from '../confirmCloseTabs';

vi.mock('../resolveUnsavedTabs', () => ({
  resolveUnsavedTabs: vi.fn(),
}));

import { resolveUnsavedTabs } from '../resolveUnsavedTabs';

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
    vi.mocked(resolveUnsavedTabs).mockReset();
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

  it('dirty 且用户 abort → tabs 不变', async () => {
    vi.mocked(resolveUnsavedTabs).mockResolvedValue('abort');
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(resolveUnsavedTabs).toHaveBeenCalledWith([makeTab('a', true)]);
  });

  it('dirty 且用户 proceed → 执行关闭', async () => {
    vi.mocked(resolveUnsavedTabs).mockResolvedValue('proceed');
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('无 dirty → resolve([]) 后关闭', async () => {
    useAppStore.setState({
      tabs: [makeTab('a'), makeTab('b')],
      activeTabId: 'b',
    });
    vi.mocked(resolveUnsavedTabs).mockResolvedValue('proceed');
    await confirmAndCloseTabs('others', 'b');
    expect(resolveUnsavedTabs).toHaveBeenCalledWith([]);
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('proceed 后锚点已消失 → no-op', async () => {
    vi.mocked(resolveUnsavedTabs).mockImplementation(async () => {
      useAppStore.setState({
        tabs: [makeTab('a', true)],
        activeTabId: 'a',
        currentFile: makeTab('a', true).file,
        content: 'c-a',
      });
      return 'proceed';
    });
    await confirmAndCloseTabs('others', 'b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a']);
  });

  it('close dirty abort → 不关', async () => {
    vi.mocked(resolveUnsavedTabs).mockResolvedValue('abort');
    await confirmAndCloseTabs('close', 'a');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(resolveUnsavedTabs).toHaveBeenCalledWith([makeTab('a', true)]);
  });

  it('all 单 dirty tab proceed 后换成新建标签', async () => {
    const only = makeTab('only', true);
    useAppStore.setState({
      tabs: [only],
      activeTabId: 'only',
      currentFile: only.file,
      content: only.content,
      splitPaneRatioByTabId: { only: 0.5 },
    });
    vi.mocked(resolveUnsavedTabs).mockResolvedValue('proceed');
    await confirmAndCloseTabs('all', 'only');
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).not.toBe('only');
    expect(s.currentFile.title).toBe('无标题');
    expect(s.splitPaneRatioByTabId).toEqual({});
    expect(resolveUnsavedTabs).toHaveBeenCalledWith([only]);
  });

  it('all 无 dirty → resolve([]) 后换成新建标签', async () => {
    useAppStore.setState({
      tabs: [makeTab('a'), makeTab('b')],
      activeTabId: 'b',
    });
    vi.mocked(resolveUnsavedTabs).mockResolvedValue('proceed');
    await confirmAndCloseTabs('all', 'b');
    const s = useAppStore.getState();
    expect(resolveUnsavedTabs).toHaveBeenCalledWith([]);
    expect(s.tabs).toHaveLength(1);
    expect(s.currentFile.title).toBe('无标题');
  });
});
