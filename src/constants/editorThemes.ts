import frameLight from '@milkdown/crepe/theme/frame.css?url';
import frameDark from '@milkdown/crepe/theme/frame-dark.css?url';
import nordLight from '@milkdown/crepe/theme/nord.css?url';
import nordDark from '@milkdown/crepe/theme/nord-dark.css?url';
import crepeLight from '@milkdown/crepe/theme/classic.css?url';
import crepeDark from '@milkdown/crepe/theme/classic-dark.css?url';
import { normalizeOptionId } from '../utils/normalizeOptionId';

export type EditorThemeId = 'frame' | 'nord' | 'crepe';
export type EditorColorMode = 'light' | 'dark' | 'system';
export type EffectiveEditorColorMode = 'light' | 'dark';

export const DEFAULT_EDITOR_THEME_ID: EditorThemeId = 'frame';
export const DEFAULT_EDITOR_COLOR_MODE: EditorColorMode = 'system';

export interface EditorThemeOption {
  value: EditorThemeId;
  label: string;
}

export const EDITOR_THEME_OPTIONS: EditorThemeOption[] = [
  { value: 'frame', label: 'Frame' },
  { value: 'nord', label: 'Nord' },
  { value: 'crepe', label: 'Crepe' },
];

export const EDITOR_COLOR_MODE_OPTIONS: { value: EditorColorMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const CREPE_CSS: Record<EditorThemeId, Record<EffectiveEditorColorMode, string>> = {
  frame: { light: frameLight, dark: frameDark },
  nord: { light: nordLight, dark: nordDark },
  crepe: { light: crepeLight, dark: crepeDark },
};

const VALID_THEME_IDS = new Set<string>(EDITOR_THEME_OPTIONS.map((o) => o.value));
const VALID_COLOR_MODES = new Set<string>(['light', 'dark', 'system']);

export function normalizeEditorThemeId(raw: unknown): EditorThemeId {
  return normalizeOptionId(raw, VALID_THEME_IDS, DEFAULT_EDITOR_THEME_ID);
}

export function normalizeEditorColorMode(raw: unknown): EditorColorMode {
  return normalizeOptionId(raw, VALID_COLOR_MODES, DEFAULT_EDITOR_COLOR_MODE);
}

export function getCrepeThemeCssUrl(
  themeId: EditorThemeId,
  effective: EffectiveEditorColorMode
): string {
  return CREPE_CSS[themeId][effective];
}
