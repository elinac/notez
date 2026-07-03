import { describe, it, expect } from 'vitest';
import { resolveEditorColorMode, getSourceEditorChrome } from '../editorThemeRuntime';

describe('editorThemeRuntime', () => {
  it('resolveEditorColorMode', () => {
    expect(resolveEditorColorMode('light', true)).toBe('light');
    expect(resolveEditorColorMode('dark', false)).toBe('dark');
    expect(resolveEditorColorMode('system', true)).toBe('dark');
    expect(resolveEditorColorMode('system', false)).toBe('light');
  });

  it('getSourceEditorChrome 返回有效扩展', () => {
    expect(getSourceEditorChrome('dark')).toBeTruthy();
    expect(getSourceEditorChrome('light')).toBeTruthy();
  });
});
