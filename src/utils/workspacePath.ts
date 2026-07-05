/** Windows 盘符或 UNC 路径 */
function isWindowsStylePath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(p) || /^[a-zA-Z]:$/.test(p) || p.startsWith('//');
}

/** 同步 path key：去重、active 高亮 */
export function workspacePathKey(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (isWindowsStylePath(path)) {
    p = p.toLowerCase();
  }
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

export function isSameNormalizedPath(a: string, b: string): boolean {
  return workspacePathKey(a) === workspacePathKey(b);
}

export async function resolveWorkspaceDirFromFilePath(
  filePath: string
): Promise<string | null> {
  try {
    const { dirname, normalize } = await import('@tauri-apps/api/path');
    const normalizedFile = await normalize(filePath);
    const parent = await dirname(normalizedFile);
    return await normalize(parent);
  } catch {
    return null;
  }
}
