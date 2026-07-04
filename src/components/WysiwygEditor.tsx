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
import { useCrepeThemeStylesheet } from '../hooks/useCrepeThemeStylesheet';
import { getCodeBlockSyntaxExtension } from '../constants/codeBlockThemes';
import { codeBlockRenderPreview, getDiagramCodeBlockLanguages } from './diagramRenderers';
import { startWysiwygDiagramZoomObserver } from './diagramZoom';
import { startWysiwygDiagramCopyObserver } from './diagramCopy';
import '@milkdown/crepe/theme/common/style.css';

interface WysiwygEditorProps {
  content: string;
  onChange: (content: string) => void;
  /** Exposes the scroll container for outline navigation. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** Called when the Crepe editor instance is ready. */
  onCrepeReady?: (crepe: Crepe) => void;
}

export function WysiwygEditor({ content, onChange, scrollContainerRef, onCrepeReady }: WysiwygEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorThemeId = useSettingsStore((s) => s.editorThemeId);
  const codeBlockThemeId = useSettingsStore((s) => s.codeBlockThemeId);
  const editorFontConfig = useSettingsStore((s) => s.editorFontConfig);
  const codeBlockFontConfig = useSettingsStore((s) => s.codeBlockFontConfig);
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
      theme: getCodeBlockSyntaxExtension(codeBlockThemeId),
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
    let stopCopyObserver: (() => void) | undefined;

    crepe.create().then(() => {
      crepeRef.current = crepe;
      onCrepeReady?.(crepe);
      if (containerRef.current) {
        stopZoomObserver = startWysiwygDiagramZoomObserver(containerRef.current);
        stopCopyObserver = startWysiwygDiagramCopyObserver(containerRef.current);
      }
    });

    return () => {
      stopZoomObserver?.();
      stopCopyObserver?.();
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
      style={{
        '--crepe-font-default': editorFontConfig.fontFamily,
        '--crepe-font-code': codeBlockFontConfig.fontFamily,
      } as React.CSSProperties}
    />
  );
}
