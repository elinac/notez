/**
 * Editor theme settings: persist, initSettings, normalization (browser: localStorage)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_EDITOR_COLOR_MODE,
  DEFAULT_EDITOR_THEME_ID,
} from '../../constants/editorThemes';
import { DEFAULT_CODE_BLOCK_THEME_ID } from '../../constants/codeBlockThemes';
import type { PersistedSettings } from '../useSettingsStore';
import { useSettingsStore } from '../useSettingsStore';

const LS_KEY = 'notez-settings';

describe('editor theme settings persist', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      loaded: false,
      editorColorMode: DEFAULT_EDITOR_COLOR_MODE,
      editorThemeId: DEFAULT_EDITOR_THEME_ID,
      codeBlockThemeId: DEFAULT_CODE_BLOCK_THEME_ID,
    });
  });

  it('setEditorThemeId 写入 localStorage', () => {
    useSettingsStore.getState().setEditorThemeId('nord');
    const data = JSON.parse(localStorage.getItem(LS_KEY)!) as PersistedSettings;
    expect(data.editorThemeId).toBe('nord');
  });

  it('setCodeBlockThemeId 写入 localStorage', () => {
    useSettingsStore.getState().setCodeBlockThemeId('dracula');
    const data = JSON.parse(localStorage.getItem(LS_KEY)!) as PersistedSettings;
    expect(data.codeBlockThemeId).toBe('dracula');
  });

  it('initSettings 缺省字段使用默认值', async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: useSettingsStore.getState().aiConfigs,
        activeAiConfigId: null,
      })
    );
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().editorThemeId).toBe(DEFAULT_EDITOR_THEME_ID);
    expect(useSettingsStore.getState().editorColorMode).toBe(DEFAULT_EDITOR_COLOR_MODE);
    expect(useSettingsStore.getState().codeBlockThemeId).toBe(DEFAULT_CODE_BLOCK_THEME_ID);
  });

  it('initSettings 非法 editorThemeId 归一化', async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: useSettingsStore.getState().aiConfigs,
        activeAiConfigId: null,
        editorThemeId: 'solarized',
      })
    );
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().editorThemeId).toBe('frame');
  });
});
