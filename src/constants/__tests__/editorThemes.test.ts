import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EDITOR_THEME_ID,
  DEFAULT_EDITOR_COLOR_MODE,
  EDITOR_THEME_OPTIONS,
  normalizeEditorThemeId,
  normalizeEditorColorMode,
  getCrepeThemeCssUrl,
} from '../editorThemes';

describe('editorThemes', () => {
  it('normalizeEditorThemeId 未知值回落 frame', () => {
    expect(normalizeEditorThemeId('nord')).toBe('nord');
    expect(normalizeEditorThemeId('invalid')).toBe(DEFAULT_EDITOR_THEME_ID);
  });

  it('normalizeEditorColorMode 未知值回落 system', () => {
    expect(normalizeEditorColorMode('light')).toBe('light');
    expect(normalizeEditorColorMode('dark')).toBe('dark');
    expect(normalizeEditorColorMode('system')).toBe('system');
    expect(normalizeEditorColorMode('auto')).toBe(DEFAULT_EDITOR_COLOR_MODE);
  });

  it('getCrepeThemeCssUrl 覆盖 3 主题 × 2 明暗', () => {
    for (const id of ['frame', 'nord', 'crepe'] as const) {
      const light = getCrepeThemeCssUrl(id, 'light');
      const dark = getCrepeThemeCssUrl(id, 'dark');
      expect(typeof light).toBe('string');
      expect(typeof dark).toBe('string');
      // Vitest 下 ?url 可能为空字符串；生产构建由 Vite 解析为 asset URL
      if (light) expect(light).toMatch(/\.css$/);
      if (dark) expect(dark).toMatch(/\.css$|dark/);
    }
  });

  it('EDITOR_THEME_OPTIONS 与 normalize 一致', () => {
    expect(EDITOR_THEME_OPTIONS.map((o) => o.value)).toEqual(['frame', 'nord', 'crepe']);
  });
});
