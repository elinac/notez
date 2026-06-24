import { describe, it, expect } from 'vitest';
import {
  resolveEditorColorMode,
  buildSourceEditorThemeExtensions,
  buildCodeBlockSyntaxExtensions,
} from '../editorThemeRuntime';

describe('editorThemeRuntime', () => {
  it('resolveEditorColorMode', () => {
    expect(resolveEditorColorMode('light', true)).toBe('light');
    expect(resolveEditorColorMode('dark', false)).toBe('dark');
    expect(resolveEditorColorMode('system', true)).toBe('dark');
    expect(resolveEditorColorMode('system', false)).toBe('light');
  });

  it('buildSourceEditorThemeExtensions 返回非空扩展', () => {
    expect(buildSourceEditorThemeExtensions('dark').length).toBeGreaterThan(0);
    expect(buildSourceEditorThemeExtensions('light').length).toBeGreaterThan(0);
  });

  it('buildCodeBlockSyntaxExtensions 委托 codeBlockThemes', () => {
    expect(buildCodeBlockSyntaxExtensions('dracula').length).toBeGreaterThan(0);
  });
});
