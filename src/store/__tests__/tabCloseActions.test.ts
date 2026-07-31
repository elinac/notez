import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore, type FileEditorTab } from '../useAppStore';
import { getCloseTargetIds } from '../../utils/tabCloseTargets';

function makeTab(id: string, title = id): FileEditorTab {
  return {
    kind: 'file',
    id,
    content: `content-${id}`,
    file: {
      id: `f-${id}`,
      title,
      content: `content-${id}`,
      isDirty: false,
    },
  };
}

describe('tab close batch actions', () => {
  beforeEach(() => {
    localStorage.clear();
    const a = makeTab('a');
    const b = makeTab('b');
    const c = makeTab('c');
    useAppStore.setState({
      tabs: [a, b, c],
      activeTabId: 'b',
      currentFile: b.file,
      content: b.content,
      splitPaneRatioByTabId: { a: 0.4, b: 0.5, c: 0.6 },
    });
  });

  it('closeOtherTabs 只留锚点并 syncActive', () => {
    useAppStore.getState().closeOtherTabs('b');
    const s = useAppStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual(['b']);
    expect(s.activeTabId).toBe('b');
    expect(s.content).toBe('content-b');
    expect(s.currentFile.title).toBe('b');
    expect(s.splitPaneRatioByTabId).toEqual({ b: 0.5 });
  });

  it('closeTabsToLeft / Right 与 getCloseTargetIds 一致', () => {
    const tabs = useAppStore.getState().tabs;
    useAppStore.getState().closeTabsToLeft('b');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['b', 'c']);
    expect(
      getCloseTargetIds(tabs, 'left', 'b'),
    ).toEqual(['a']);

    useAppStore.setState({
      tabs: [makeTab('a'), makeTab('b'), makeTab('c')],
      activeTabId: 'c',
      currentFile: makeTab('c').file,
      content: 'content-c',
      splitPaneRatioByTabId: { a: 0.4, b: 0.5, c: 0.6 },
    });
    useAppStore.getState().closeTabsToRight('b');
    const s = useAppStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    // active 在被关集合 → 切到锚点
    expect(s.activeTabId).toBe('b');
    expect(s.content).toBe('content-b');
  });

  it('closeTabsToRight 时 active 不在被关集合则不变', () => {
    useAppStore.setState({ activeTabId: 'a', currentFile: makeTab('a').file, content: 'content-a' });
    useAppStore.getState().closeTabsToRight('b');
    expect(useAppStore.getState().activeTabId).toBe('a');
    expect(useAppStore.getState().content).toBe('content-a');
  });

  it('closeAllTabs 换成单个 createNewFile 风格 tab', () => {
    useAppStore.getState().closeAllTabs();
    const s = useAppStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.tabs[0].kind).toBe('file');
    expect(s.currentFile.title).toBe('无标题');
    expect(s.content).toBe(s.tabs[0].content);
    expect(s.splitPaneRatioByTabId).toEqual({});
  });

  it('锚点无效 no-op', () => {
    const before = useAppStore.getState().tabs;
    useAppStore.getState().closeOtherTabs('missing');
    expect(useAppStore.getState().tabs).toEqual(before);
  });
});
