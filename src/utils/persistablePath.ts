/** 与 saveMarkdownFileTauri 另存为条件对齐：可直写磁盘时为 true */
export function hasPersistablePath(file: { path?: string; title: string }): boolean {
  const p = file.path;
  return Boolean(p && p !== file.title);
}
