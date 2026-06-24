/**
 * WYSIWYG Markdown Editor — Milkdown Crepe
 * Typora-style: renders markdown inline, shows syntax only around cursor
 * PlantUML and Mermaid code blocks are rendered as diagrams in preview mode
 */
import { useEffect, useRef, useCallback } from 'react';
import { languages as cmLanguages } from '@codemirror/language-data';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { replaceAll } from '@milkdown/utils';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEffectiveEditorColorMode } from '../hooks/useEffectiveEditorColorMode';
import {
  getCrepeThemeCssUrl,
  type EditorThemeId,
  type EffectiveEditorColorMode,
} from '../constants/editorThemes';
import { getCodeBlockSyntaxThemeExtension } from '../constants/codeBlockThemes';
import { codeBlockRenderPreview, getDiagramCodeBlockLanguages } from './diagramRenderers';
import { startWysiwygDiagramZoomObserver } from './diagramZoom';
import '@milkdown/crepe/theme/common/style.css';

const CREPE_LINK_ID = 'notez-crepe-theme-variant';

function useCrepeThemeStylesheet(themeId: EditorThemeId, effective: EffectiveEditorColorMode) {
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

interface WysiwygEditorProps {
  content: string;
  onChange: (content: string) => void;
  /** Exposes the scroll container for outline navigation. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function WysiwygEditor({ content, onChange, scrollContainerRef }: WysiwygEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorThemeId = useSettingsStore((s) => s.editorThemeId);
  const codeBlockThemeId = useSettingsStore((s) => s.codeBlockThemeId);
  const effectiveColorMode = useEffectiveEditorColorMode();

  useCrepeThemeStylesheet(editorThemeId, effectiveColorMode);

  const setContainerRef = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (scrollContainerRef) {
      scrollContainerRef.current = node;
    }
  };
  const crepeRef = useRef<Crepe | null>(null);
  const externalContent = useRef<string>(content);
  const editingContent = useRef<string>(content);

  const handleChange = useCallback(
    (_ctx: unknown, markdown: string) => {
      editingContent.current = markdown;
      onChange(markdown);
    },
    [onChange]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const diagramLanguages = getDiagramCodeBlockLanguages();
    const codeMirrorFeatureConfig = {
      languages: [...cmLanguages, ...diagramLanguages],
      previewOnlyByDefault: true,
      renderPreview: codeBlockRenderPreview,
      theme: getCodeBlockSyntaxThemeExtension(codeBlockThemeId),
    };

    const crepe = new Crepe({
      root: containerRef.current,
      defaultValue: content,
      featureConfigs: {
        [CrepeFeature.CodeMirror]: codeMirrorFeatureConfig,
      },
    });

    crepe.on((api) => {
      api.markdownUpdated(handleChange);
    });

    let stopZoomObserver: (() => void) | undefined;

    crepe.create().then(() => {
      crepeRef.current = crepe;
      if (containerRef.current) {
        stopZoomObserver = startWysiwygDiagramZoomObserver(containerRef.current);
      }
    });

    return () => {
      stopZoomObserver?.();
      crepe.destroy();
      crepeRef.current = null;
    };
    // Remount via parent key when theme settings change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!crepeRef.current) return;
    if (content === editingContent.current) return;
    if (content === externalContent.current) return;

    externalContent.current = content;
    crepeRef.current.editor.action(replaceAll(content));
  }, [content]);

  return (
    <div
      ref={setContainerRef}
      className="wysiwyg-editor h-full overflow-auto"
    />
  );
}
