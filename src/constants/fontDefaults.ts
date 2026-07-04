import type { FontConfig } from '../components/settings/settingsTypes';

export const DEFAULT_UI_FONT: FontConfig = {
  fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontSize: 16,
};

export const DEFAULT_EDITOR_FONT: FontConfig = {
  fontFamily: 'inherit',
  fontSize: 16,
};

export const DEFAULT_CODE_FONT: FontConfig = {
  fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  fontSize: 14,
};

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;

export const RECOMMENDED_FONTS = {
  ui: ['Segoe UI Variable', 'Segoe UI', '微软雅黑', '思源黑体', 'PingFang SC'],
  editor: ['微软雅黑', '思源宋体', '思源黑体', 'Segoe UI Variable', 'Georgia'],
  code: ['Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', 'Source Code Pro'],
} as const;
