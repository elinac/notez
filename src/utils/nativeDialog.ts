import { isTauri } from '../components/FileOperations';

/** Native message box (Tauri) or alert fallback (browser). */
export async function showMessage(
  text: string,
  options?: { title?: string; kind?: 'info' | 'warning' | 'error' },
): Promise<void> {
  if (isTauri()) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(text, {
      title: options?.title ?? 'NoteZ',
      kind: options?.kind ?? 'info',
    });
    return;
  }
  window.alert(text);
}

/** Yes/no confirmation — native ask on Tauri. */
export async function confirmAction(
  text: string,
  options?: { title?: string; okLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return ask(text, {
      title: options?.title ?? 'NoteZ',
      kind: 'warning',
      okLabel: options?.okLabel ?? '确定',
      cancelLabel: options?.cancelLabel ?? '取消',
    });
  }
  return window.confirm(text);
}

/** Save-as dialog for creating a new file in a directory. Returns full path or null. */
export async function promptNewFilePath(
  dirPath: string,
  defaultName = '新文件.md',
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { join } = await import('@tauri-apps/api/path');
    const defaultPath = await join(dirPath, defaultName);
    const selected = await save({
      defaultPath,
      title: '新建文件',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    return typeof selected === 'string' ? selected : null;
  }
  const name = window.prompt('新文件名（含扩展名）:', defaultName);
  return name?.trim() ? name.trim() : null;
}
