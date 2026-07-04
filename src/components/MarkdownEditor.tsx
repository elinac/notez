import { useEffect, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import type { Crepe } from '@milkdown/crepe';
import { PlantUMLRenderer } from './PlantUMLRenderer';
import { WysiwygEditor } from './WysiwygEditor';
import { FormattingToolbar } from './FormattingToolbar';
import { OutlinePanel } from './OutlinePanel';
import { useAppStore, EditorMode } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEffectiveEditorColorMode } from '../hooks/useEffectiveEditorColorMode';
import { clampSplitRatio } from '../utils/splitPaneRatio';
import { getCodeBlockSyntaxExtension } from '../constants/codeBlockThemes';
import { getSourceEditorChrome } from '../utils/editorThemeRuntime';
import { getDiagramCodeBlockLanguages } from './diagramRenderers';
import { Columns2, FileEdit, Wand2, List } from 'lucide-react';

const SPLIT_GUTTER_PX = 6;
const editorThemeCompartment = new Compartment();
const codeBlockSyntaxCompartment = new Compartment();
const fontCompartment = new Compartment();

function getFontExtension(editorFont: { fontFamily: string; fontSize: number }) {
  return EditorView.theme({
    '.cm-content': {
      fontFamily: editorFont.fontFamily,
      fontSize: `${editorFont.fontSize}px`,
    },
    '.cm-gutters': {
      fontSize: `${editorFont.fontSize}px`,
    },
  });
}

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
}

const MODE_BUTTONS: { mode: EditorMode; icon: React.ReactNode; label: string; title: string }[] = [
  { mode: 'edit',    icon: <FileEdit size={14} />, label: '源码', title: 'Markdown 源码编辑' },
  { mode: 'split',   icon: <Columns2 size={14} />, label: '分屏', title: '左编辑右预览' },
  { mode: 'wysiwyg', icon: <Wand2 size={14} />,   label: '全屏', title: 'Typora 风格所见即所得' },
];

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const {
    editorMode,
    setEditorMode,
    currentFile,
    setCurrentFile,
    activeTabId,
    splitPaneRatioByTabId,
    setSplitPaneRatio,
  } = useAppStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showOutline, setShowOutline] = useState(false);
  const crepeRef = useRef<Crepe | null>(null);
  const handleCrepeReady = useCallback((crepe: Crepe) => {
    crepeRef.current = crepe;
  }, []);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const wysiwygContainerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const dragSplitRef = useRef(false);

  const splitRatio = splitPaneRatioByTabId[activeTabId] ?? 0.5;
  const effectiveColorMode = useEffectiveEditorColorMode();
  const editorThemeId = useSettingsStore((s) => s.editorThemeId);
  const codeBlockThemeId = useSettingsStore((s) => s.codeBlockThemeId);
  const editorFontConfig = useSettingsStore((s) => s.editorFontConfig);

  const showPreviewPane = editorMode === 'split';
  const showWysiwyg = editorMode === 'wysiwyg';

  useEffect(() => {
    if (!editorRef.current) return;

    const diagramLangs = getDiagramCodeBlockLanguages();
    const startState = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: [...languages, ...diagramLangs] }),
        editorThemeCompartment.of(getSourceEditorChrome(effectiveColorMode)),
        codeBlockSyntaxCompartment.of(getCodeBlockSyntaxExtension(codeBlockThemeId)),
        fontCompartment.of(getFontExtension(editorFontConfig)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; theme updates via compartment
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        editorThemeCompartment.reconfigure(getSourceEditorChrome(effectiveColorMode)),
        codeBlockSyntaxCompartment.reconfigure(getCodeBlockSyntaxExtension(codeBlockThemeId)),
      ],
    });
  }, [effectiveColorMode, codeBlockThemeId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: fontCompartment.reconfigure(getFontExtension(editorFontConfig)),
    });
  }, [editorFontConfig]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cmDoc = view.state.doc.toString();
    if (cmDoc === content) return;

    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: cmDoc.length, insert: content },
      selection: {
        anchor: Math.min(sel.anchor, content.length),
        head: Math.min(sel.head, content.length),
      },
    });
  }, [content]);

  const onSplitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragSplitRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onSplitPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragSplitRef.current || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const w = rect.width;
    if (w <= SPLIT_GUTTER_PX) return;
    const usable = w - SPLIT_GUTTER_PX;
    const x = e.clientX - rect.left;
    const ratio = clampSplitRatio(x / usable);
    setSplitPaneRatio(activeTabId, ratio);
    queueMicrotask(() => viewRef.current?.requestMeasure());
  };

  const onSplitPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragSplitRef.current) return;
    dragSplitRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mode switcher toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        {/* File title — click to edit */}
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="flex-1 min-w-0 text-sm font-medium text-gray-800 bg-white border border-blue-400 rounded px-1.5 py-0.5 outline-none"
            defaultValue={currentFile.title}
            onBlur={(e) => {
              const newTitle = e.target.value.trim() || currentFile.title;
              setCurrentFile({ ...currentFile, title: newTitle, isDirty: true });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="flex-1 min-w-0 text-left text-sm font-medium text-gray-800 hover:text-blue-600 truncate"
            title="点击修改文件名"
          >
            {currentFile.title}
            {currentFile.isDirty && <span className="text-blue-400 ml-1 text-xs">●</span>}
          </button>
        )}

        {/* Spacer */}
        <div className="flex-shrink-0" />

        {/* Mode buttons */}
        <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded p-0.5 flex-shrink-0">
          {MODE_BUTTONS.map(({ mode, icon, label, title }) => (
            <button
              key={mode}
              onClick={() => setEditorMode(mode)}
              title={title}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                editorMode === mode
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Outline toggle button */}
        <button
          onClick={() => setShowOutline((v) => !v)}
          title="文档大纲"
          className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors border ${
            showOutline
              ? 'bg-blue-500 text-white border-blue-500'
              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'
          }`}
        >
          <List size={14} />
        </button>
      </div>

      {/* Formatting toolbar */}
      <FormattingToolbar
        editorMode={editorMode}
        viewRef={viewRef}
        crepeRef={crepeRef}
      />

      {/* Editor body — relative container for outline overlay */}
      <div className="flex-1 overflow-hidden relative">
        {/* Outline floating panel */}
        {showOutline && (
          <OutlinePanel
            content={content}
            editorMode={editorMode}
            viewRef={viewRef}
            wysiwygContainerRef={wysiwygContainerRef}
            previewContainerRef={previewContainerRef}
          />
        )}

        {/* WYSIWYG mode — Milkdown Crepe（条件渲染，不在 DOM 时销毁） */}
        {showWysiwyg && (
          <div className="h-full overflow-hidden">
            <WysiwygEditor
              key={`${editorThemeId}-${effectiveColorMode}-${codeBlockThemeId}`}
              content={content}
              onChange={onChange}
              scrollContainerRef={wysiwygContainerRef}
              onCrepeReady={handleCrepeReady}
            />
          </div>
        )}

        {/* Source / Split mode — CodeMirror（始终保留在 DOM，用 hidden 隐藏以保持 EditorView） */}
        <div
          ref={splitContainerRef}
          className={`h-full min-h-0 min-w-0 flex overflow-hidden ${showWysiwyg ? 'hidden' : ''}`}
        >
          <div
            ref={editorRef}
            style={
              editorMode === 'split'
                ? { flex: `${splitRatio} 1 0%` }
                : undefined
            }
            className={
              editorMode === 'split'
                ? 'h-full min-w-0 overflow-auto'
                : 'h-full w-full overflow-auto'
            }
          />

          {showPreviewPane && (
            <div
              role="separator"
              aria-orientation="vertical"
              className="relative flex h-full flex-shrink-0 cursor-col-resize select-none justify-center bg-transparent touch-none"
              style={{ width: SPLIT_GUTTER_PX }}
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
            >
              <div
                className="pointer-events-none h-full w-px bg-gray-200"
                aria-hidden
              />
            </div>
          )}

          {showPreviewPane && (
            <div
              ref={previewContainerRef}
              className="markdown-split-preview h-full min-w-0 overflow-auto bg-white"
              style={{ flex: `${1 - splitRatio} 1 0%` }}
            >
              <PlantUMLRenderer content={content} previewDocumentId={activeTabId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
