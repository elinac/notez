/**
 * PlantUML 后端设置：归一化规则、持久化载荷、initSettings 与磁盘字段对齐（浏览器路径：localStorage）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PLANTUML_THEME } from '../../constants/plantumlThemes';
import type { PersistedSettings } from '../useSettingsStore';
import {
  useSettingsStore,
  normalizePlantUmlBackend,
  DEFAULT_PLANTUML_BACKEND,
} from '../useSettingsStore';

const LS_KEY = 'notez-settings';

describe('normalizePlantUmlBackend', () => {
  it('仅精确 rust 为 rust，其余为 jar', () => {
    expect(normalizePlantUmlBackend(undefined)).toBe('jar');
    expect(normalizePlantUmlBackend(null)).toBe('jar');
    expect(normalizePlantUmlBackend('')).toBe('jar');
    expect(normalizePlantUmlBackend('jar')).toBe('jar');
    expect(normalizePlantUmlBackend('JAR')).toBe('jar');
    expect(normalizePlantUmlBackend('rust')).toBe('rust');
    expect(normalizePlantUmlBackend('RUST')).toBe('jar');
    expect(normalizePlantUmlBackend('wasm')).toBe('jar');
  });
});

describe('plantUmlBackend 持久化与 initSettings（localStorage）', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      loaded: false,
      plantUmlTheme: DEFAULT_PLANTUML_THEME,
      plantUmlBackend: DEFAULT_PLANTUML_BACKEND,
    });
  });

  it('setPlantUmlBackend 写入 localStorage 载荷', () => {
    useSettingsStore.getState().setPlantUmlBackend('rust');
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    const data = JSON.parse(raw!) as PersistedSettings;
    expect(data.plantUmlBackend).toBe('rust');
  });

  it('initSettings 从磁盘读到 rust 时状态为 rust', async () => {
    const configs = useSettingsStore.getState().aiConfigs;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: configs,
        activeAiConfigId: null,
        plantUmlBackend: 'rust',
      } satisfies PersistedSettings)
    );
    useSettingsStore.setState({ plantUmlBackend: 'jar' });
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().plantUmlBackend).toBe('rust');
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it('initSettings 缺省 plantUmlBackend 字段时为 jar', async () => {
    const configs = useSettingsStore.getState().aiConfigs;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: configs,
        activeAiConfigId: null,
      } satisfies PersistedSettings)
    );
    useSettingsStore.setState({ plantUmlBackend: 'rust' });
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().plantUmlBackend).toBe('jar');
  });

  it('initSettings 将非法后端值归一为 jar', async () => {
    const configs = useSettingsStore.getState().aiConfigs;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        aiConfigs: configs,
        activeAiConfigId: null,
        plantUmlBackend: 'wasm',
      })
    );
    useSettingsStore.setState({ plantUmlBackend: 'rust' });
    await useSettingsStore.getState().initSettings();
    expect(useSettingsStore.getState().plantUmlBackend).toBe('jar');
  });
});
