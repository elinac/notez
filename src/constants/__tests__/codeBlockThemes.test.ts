import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CODE_BLOCK_THEME_ID,
  CODE_BLOCK_THEME_OPTIONS,
  normalizeCodeBlockThemeId,
  getCodeBlockSyntaxExtension,
} from '../codeBlockThemes';

describe('codeBlockThemes', () => {
  it('normalizeCodeBlockThemeId 未知值回落 one-dark', () => {
    expect(normalizeCodeBlockThemeId('dracula')).toBe('dracula');
    expect(normalizeCodeBlockThemeId('nope')).toBe(DEFAULT_CODE_BLOCK_THEME_ID);
  });

  it('每个注册主题返回 Extension 数组', () => {
    for (const opt of CODE_BLOCK_THEME_OPTIONS) {
      const ext = getCodeBlockSyntaxExtension(opt.value);
      expect(ext).toBeTruthy();
      expect(ext.length).toBeGreaterThan(0);
    }
  });
});
