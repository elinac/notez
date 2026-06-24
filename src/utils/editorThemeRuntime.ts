import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { EditorColorMode, EffectiveEditorColorMode } from '../constants/editorThemes';
import { getCodeBlockSyntaxExtension } from '../constants/codeBlockThemes';

export function resolveEditorColorMode(
  mode: EditorColorMode,
  prefersDark: boolean
): EffectiveEditorColorMode {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

const lightChrome = EditorView.theme(
  {
    '&': { color: '#24292f', backgroundColor: '#ffffff' },
    '.cm-gutters': { backgroundColor: '#f6f8fa', color: '#57606a', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: '#eaeef2' },
    '.cm-activeLine': { backgroundColor: '#f6f8fa' },
  },
  { dark: false }
);

const darkChrome = EditorView.theme(
  {
    '&': { color: '#abb2bf', backgroundColor: '#282c34' },
    '.cm-gutters': { backgroundColor: '#21252b', color: '#636d83', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: '#2c313a' },
    '.cm-activeLine': { backgroundColor: '#2c313a22' },
  },
  { dark: true }
);

export function buildSourceEditorThemeExtensions(
  effective: EffectiveEditorColorMode
): Extension[] {
  return [effective === 'dark' ? darkChrome : lightChrome];
}

export function buildCodeBlockSyntaxExtensions(codeBlockThemeId: string): Extension[] {
  return getCodeBlockSyntaxExtension(codeBlockThemeId);
}
