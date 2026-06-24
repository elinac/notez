import type { Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { githubLightInit } from '@uiw/codemirror-theme-github';
import { monokaiInit } from '@uiw/codemirror-theme-monokai';
import { draculaInit } from '@uiw/codemirror-theme-dracula';

export const DEFAULT_CODE_BLOCK_THEME_ID = 'one-dark';

export interface CodeBlockThemeOption {
  value: string;
  label: string;
}

export const CODE_BLOCK_THEME_OPTIONS: CodeBlockThemeOption[] = [
  { value: 'one-dark', label: 'One Dark' },
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'dracula', label: 'Dracula' },
];

const VALID_IDS = new Set(CODE_BLOCK_THEME_OPTIONS.map((o) => o.value));

const SYNTAX_ONLY_SETTINGS = {
  background: 'transparent',
  gutterBackground: 'transparent',
  lineHighlight: 'transparent',
} as const;

function syntaxOnly(init: (opts?: object) => Extension): Extension[] {
  return [init({ settings: { ...SYNTAX_ONLY_SETTINGS } })];
}

const SYNTAX_FACTORIES: Record<string, () => Extension[]> = {
  'one-dark': () => [oneDark],
  'github-light': () => syntaxOnly(githubLightInit),
  monokai: () => syntaxOnly(monokaiInit),
  dracula: () => syntaxOnly(draculaInit),
};

export function normalizeCodeBlockThemeId(raw: unknown): string {
  return typeof raw === 'string' && VALID_IDS.has(raw) ? raw : DEFAULT_CODE_BLOCK_THEME_ID;
}

export function getCodeBlockSyntaxExtension(id: string): Extension[] {
  return SYNTAX_FACTORIES[normalizeCodeBlockThemeId(id)]();
}

/** Crepe CodeMirror feature expects a single Extension */
export function getCodeBlockSyntaxThemeExtension(id: string): Extension {
  return getCodeBlockSyntaxExtension(id)[0];
}
