import { saveMarkdownFileTauri } from '../components/FileOperations';
import { useAppStore, type FileEditorTab } from '../store/useAppStore';
import { cancelPendingAutoSave } from './autoSaveController';
import { showMessage } from './nativeDialog';
import { promptSaveChanges } from './savePrompt';

export function buildUnsavedPromptMessage(dirtyTabs: FileEditorTab[]): string {
  if (dirtyTabs.length === 1) {
    const title = dirtyTabs[0].file.title;
    return `「${title}」有未保存的更改。是否保存？`;
  }
  return `有 ${dirtyTabs.length} 个标签有未保存的更改。是否全部保存？`;
}

export async function resolveUnsavedTabs(
  dirtyTabs: FileEditorTab[]
): Promise<'proceed' | 'abort'> {
  cancelPendingAutoSave();

  if (dirtyTabs.length === 0) {
    return 'proceed';
  }

  const choice = await promptSaveChanges(buildUnsavedPromptMessage(dirtyTabs));

  if (choice === 'cancel') {
    return 'abort';
  }

  if (choice === 'discard') {
    return 'proceed';
  }

  for (const tab of dirtyTabs) {
    const file = tab.file;
    try {
      const savedPath = await saveMarkdownFileTauri({ ...file }, tab.content);
      if (savedPath === null) {
        await showMessage(`保存「${file.title}」失败或已取消。`);
        return 'abort';
      }
      useAppStore.getState().updateTabFile(tab.id, {
        ...file,
        content: tab.content,
        path: savedPath ?? file.path,
        isDirty: false,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await showMessage(`保存「${file.title}」失败：${detail}`);
      return 'abort';
    }
  }

  return 'proceed';
}
