import { useEffect } from 'react';
import {
  getCrepeThemeCssUrl,
  type EditorThemeId,
  type EffectiveEditorColorMode,
} from '../constants/editorThemes';

const CREPE_LINK_ID = 'notez-crepe-theme-variant';

export function useCrepeThemeStylesheet(
  themeId: EditorThemeId,
  effective: EffectiveEditorColorMode
) {
  useEffect(() => {
    const href = getCrepeThemeCssUrl(themeId, effective);
    let link = document.getElementById(CREPE_LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = CREPE_LINK_ID;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = href;
    return () => {
      link?.remove();
    };
  }, [themeId, effective]);
}
