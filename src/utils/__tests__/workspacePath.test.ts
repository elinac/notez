import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isSameNormalizedPath,
  workspacePathKey,
} from '../workspacePath';

describe('workspacePathKey', () => {
  it('统一斜杠并去掉末尾斜杠', () => {
    expect(workspacePathKey('C:\\foo\\bar\\')).toBe('c:/foo/bar');
  });

  it('Windows 盘符路径大小写不敏感', () => {
    expect(workspacePathKey('D:\\Docs')).toBe('d:/docs');
    expect(isSameNormalizedPath('D:\\Docs', 'd:/docs')).toBe(true);
  });

  it('POSIX 路径保持大小写', () => {
    expect(workspacePathKey('/Home/User')).toBe('/Home/User');
    expect(isSameNormalizedPath('/Home/User', '/home/user')).toBe(false);
  });

  it('盘符根保留', () => {
    expect(workspacePathKey('C:\\')).toBe('c:');
  });
});

describe('resolveWorkspaceDirFromFilePath', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('normalize → dirname → normalize', async () => {
    vi.doMock('@tauri-apps/api/path', () => ({
      normalize: vi.fn(async (p: string) => p.replace(/\\/g, '/')),
      dirname: vi.fn(async (p: string) => {
        const i = p.lastIndexOf('/');
        return i >= 0 ? p.slice(0, i) : p;
      }),
    }));
    const { resolveWorkspaceDirFromFilePath: resolve } = await import('../workspacePath');
    const dir = await resolve('C:\\Docs\\note.md');
    expect(dir).toBe('C:/Docs');
  });

  it('失败返回 null', async () => {
    vi.doMock('@tauri-apps/api/path', () => ({
      normalize: vi.fn(async () => {
        throw new Error('fail');
      }),
      dirname: vi.fn(),
    }));
    const { resolveWorkspaceDirFromFilePath: resolve } = await import('../workspacePath');
    expect(await resolve('C:\\x\\a.md')).toBeNull();
  });
});
