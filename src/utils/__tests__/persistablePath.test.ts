import { describe, expect, it } from 'vitest';
import { hasPersistablePath } from '../persistablePath';

describe('hasPersistablePath', () => {
  it('无 path → false', () => {
    expect(hasPersistablePath({ title: '无标题' })).toBe(false);
  });
  it('path === title → false（浏览器文件名占位）', () => {
    expect(hasPersistablePath({ title: 'a.md', path: 'a.md' })).toBe(false);
  });
  it('独立磁盘 path → true', () => {
    expect(hasPersistablePath({ title: 'a', path: 'D:\\notes\\a.md' })).toBe(true);
  });
});
