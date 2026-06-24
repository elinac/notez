import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveEditorColorMode } from '../utils/editorThemeRuntime';
import type { EffectiveEditorColorMode } from '../constants/editorThemes';

export function useEffectiveEditorColorMode(): EffectiveEditorColorMode {
  const editorColorMode = useSettingsStore((s) => s.editorColorMode);
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return resolveEditorColorMode(editorColorMode, prefersDark);
}
