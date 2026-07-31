import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type FileEditorTab } from '../../store/useAppStore';
import { buildUnsavedPromptMessage, resolveUnsavedTabs } from '../resolveUnsavedTabs';

vi.mock('../savePrompt', () => ({ promptSaveChanges: vi.fn() }));
vi.mock('../autoSaveController', () => ({ cancelPendingAutoSave: vi.fn() }));
vi.mock('../nativeDialog', () => ({ showMessage: vi.fn() }));
vi.mock('../../components/FileOperations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/FileOperations')>();
  return { ...actual, saveMarkdownFileTauri: vi.fn() };
});

import { promptSaveChanges } from '../savePrompt';
import { cancelPendingAutoSave } from '../autoSaveController';
import { saveMarkdownFileTauri } from '../../components/FileOperations';

function dirtyTab(id: string, content: string, path?: string): FileEditorTab {
  return {
    kind: 'file',
    id,
    content,
    file: {
      id: `f-${id}`,
      title: id,
      content: 'STALE',
      path,
      isDirty: true,
    },
  };
}

describe('buildUnsavedPromptMessage', () => {
  it('单文件含标题', () => {
    expect(buildUnsavedPromptMessage([dirtyTab('笔记', 'x')])).toContain('「笔记」');
  });
  it('多文件含 N', () => {
    expect(buildUnsavedPromptMessage([dirtyTab('a', '1'), dirtyTab('b', '2')])).toContain('2');
  });
});

describe('resolveUnsavedTabs', () => {
  beforeEach(() => {
    vi.mocked(promptSaveChanges).mockReset();
    vi.mocked(saveMarkdownFileTauri).mockReset();
    useAppStore.setState({
      tabs: [dirtyTab('a', 'BODY-A', 'D:\\a.md')],
      activeTabId: 'a',
      currentFile: dirtyTab('a', 'BODY-A', 'D:\\a.md').file,
      content: 'BODY-A',
    });
  });

  it('无 dirty → proceed 且 cancelPending', async () => {
    await expect(resolveUnsavedTabs([])).resolves.toBe('proceed');
    expect(cancelPendingAutoSave).toHaveBeenCalled();
    expect(promptSaveChanges).not.toHaveBeenCalled();
  });

  it('cancel → abort', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('cancel');
    await expect(resolveUnsavedTabs([dirtyTab('a', 'BODY-A', 'D:\\a.md')])).resolves.toBe('abort');
  });

  it('discard → proceed 不保存', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('discard');
    await expect(resolveUnsavedTabs([dirtyTab('a', 'BODY-A', 'D:\\a.md')])).resolves.toBe('proceed');
    expect(saveMarkdownFileTauri).not.toHaveBeenCalled();
  });

  it('save 使用 tab.content 非 file.content', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('save');
    vi.mocked(saveMarkdownFileTauri).mockResolvedValue('D:\\a.md');
    const tab = dirtyTab('a', 'BODY-A', 'D:\\a.md');
    await expect(resolveUnsavedTabs([tab])).resolves.toBe('proceed');
    expect(saveMarkdownFileTauri).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'a' }),
      'BODY-A',
    );
    expect(useAppStore.getState().tabs[0].file.isDirty).toBe(false);
  });

  it('save 取消另存为 → abort', async () => {
    vi.mocked(promptSaveChanges).mockResolvedValue('save');
    vi.mocked(saveMarkdownFileTauri).mockResolvedValue(null);
    await expect(resolveUnsavedTabs([dirtyTab('a', 'BODY')])).resolves.toBe('abort');
  });
});
