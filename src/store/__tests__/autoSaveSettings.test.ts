import { beforeEach, describe, expect, it } from 'vitest';
import {
  normalizeAutoSaveEnabled,
  useSettingsStore,
  type PersistedSettings,
} from '../useSettingsStore';

const LS_KEY = 'notez-settings';

describe('normalizeAutoSaveEnabled', () => {
  it('仅 true 为 true', () => {
    expect(normalizeAutoSaveEnabled(true)).toBe(true);
    expect(normalizeAutoSaveEnabled(false)).toBe(false);
    expect(normalizeAutoSaveEnabled(undefined)).toBe(false);
    expect(normalizeAutoSaveEnabled('true')).toBe(false);
    expect(normalizeAutoSaveEnabled(1)).toBe(false);
  });
});

describe('autoSaveEnabled 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ loaded: false, autoSaveEnabled: false });
  });

  it('默认 false', () => {
    expect(useSettingsStore.getState().autoSaveEnabled).toBe(false);
  });

  it('setAutoSaveEnabled(true) 写入载荷', () => {
    useSettingsStore.getState().setAutoSaveEnabled(true);
    const data = JSON.parse(localStorage.getItem(LS_KEY)!) as PersistedSettings;
    expect(data.autoSaveEnabled).toBe(true);
  });

  it('initSettings 缺字段 → false', async () => {
    const configs = useSettingsStore.getState().aiConfigs;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ aiConfigs: configs, activeAiConfigId: null } satisfies PersistedSettings),
    );
    useSettingsStore.setState({ autoSaveEnabled: true, loaded: false });
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().autoSaveEnabled).toBe(false);
  });
});
