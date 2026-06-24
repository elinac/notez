import { useMemo } from 'react';
import { EditorView } from '@codemirror/view';
import type { EditorMode } from '../store/useAppStore';
import {
  parseOutline,
  scrollCodeMirrorToLine,
  scrollToHeadingInContainer,
  type OutlineItem,
} from './outlineNavigation';

interface OutlinePanelProps {
  content: string;
  editorMode: EditorMode;
  viewRef: React.RefObject<EditorView | null>;
  wysiwygContainerRef: React.RefObject<HTMLElement | null>;
  previewContainerRef: React.RefObject<HTMLElement | null>;
}

export function OutlinePanel({
  content,
  editorMode,
  viewRef,
  wysiwygContainerRef,
  previewContainerRef,
}: OutlinePanelProps) {
  const outline = useMemo(() => parseOutline(content), [content]);

  const handleClick = (item: OutlineItem, headingIndex: number) => {
    if (editorMode === 'wysiwyg') {
      scrollToHeadingInContainer(wysiwygContainerRef.current, headingIndex);
      return;
    }

    if (editorMode === 'split') {
      scrollToHeadingInContainer(previewContainerRef.current, headingIndex);
      scrollCodeMirrorToLine(viewRef.current, item.lineIndex);
      return;
    }

    scrollCodeMirrorToLine(viewRef.current, item.lineIndex);
  };

  if (outline.length === 0) {
    return (
      <div
        className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg"
        style={{ top: 40, right: 8, width: 220 }}
      >
        <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 font-medium">
          文档大纲
        </div>
        <div className="px-3 py-3 text-xs text-gray-400 text-center">
          暂无标题
        </div>
      </div>
    );
  }

  const minLevel = Math.min(...outline.map((o) => o.level));

  return (
    <div
      className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg flex flex-col"
      style={{ top: 40, right: 8, width: 220, maxHeight: '60vh' }}
    >
      <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100 font-medium flex-shrink-0">
        文档大纲
      </div>
      <div className="overflow-y-auto flex-1 py-1">
        {outline.map((item, idx) => (
          <button
            key={idx}
            onClick={() => handleClick(item, idx)}
            className="w-full text-left px-3 py-1 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 truncate block"
            style={{ paddingLeft: 12 + (item.level - minLevel) * 12 }}
            title={item.text}
          >
            <span className="text-gray-300 mr-1">
              {'#'.repeat(item.level)}
            </span>
            {item.text}
          </button>
        ))}
      </div>
    </div>
  );
}
