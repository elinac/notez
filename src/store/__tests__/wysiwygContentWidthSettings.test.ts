/**
 * WYSIWYG 内容宽度：内存 setter 不写盘、persist 落盘、initSettings 缺省/恢复
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WYSIWYG_CONTENT_WIDTH_DEFAULT } from '../../constants/wysiwygContentWidth';
import type { PersistedSettings } from '../useSettingsStore';
import { useSettingsStore } from '../useSettingsStore';

const LS_KEY = 'notez-settings';

describe('wysiwygContentWidthPercent settings', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      loaded: false,
      wysiwygContentWidthPercent: WYSIWYG_CONTENT_WIDTH_DEFAULT,
    });
  });

  it('setWysiwygContentWidthPercent clamp 且不写盘', () => {
    useSettingsStore.getState().setEditorThemeId('nord');
    const before = localStorage.getItem(LS_KEY)!;
    expect(
      (JSON.parse(before) as PersistedSettings).wysiwygContentWidthPercent,
    ).toBe(100);

    useSettingsStore.getState().setWysiwygContentWidthPercent(49);
    expect(useSettingsStore.getState().wysiwygContentWidthPercent).toBe(50);
    expect(localStorage.getItem(LS_KEY)).toBe(before);
    expect(
      (JSON.parse(localStorage.getItem(LS_KEY)!) as PersistedSettings)
        .wysiwygContentWidthPercent,
    ).toBe(100);
  });

  it('persistWysiwygContentWidthPercent 写入载荷', () => {
    useSettingsStore.getState().setWysiwygContentWidthPercent(72);
    useSettingsStore.getState().persistWysiwygContentWidthPercent();
    const data = JSON.parse(localStorage.getItem(LS_KEY)!) as PersistedSettings;
    expect(data.wysiwygContentWidthPercent).toBe(72);
  });

  it('initSettings 缺省字段为 100', async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: useSettingsStore.getState().aiConfigs,
        activeAiConfigId: null,
      }),
    );
    useSettingsStore.setState({ wysiwygContentWidthPercent: 60, loaded: false });
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().wysiwygContentWidthPercent).toBe(100);
  });

  it('initSettings 恢复已存合法值', async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: useSettingsStore.getState().aiConfigs,
        activeAiConfigId: null,
        wysiwygContentWidthPercent: 65,
      } satisfies PersistedSettings),
    );
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().wysiwygContentWidthPercent).toBe(65);
  });
});
