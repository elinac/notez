import { useCallback, useEffect, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Crepe } from '@milkdown/crepe';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Quote,
  List,
  ListOrdered,
  ListChecks,
  FileCode,
  Minus,
  Link,
  Image,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useAppStore, type EditorMode } from '../store/useAppStore';
import { HeadingDropdown } from './HeadingDropdown';
import { TableGridPicker } from './TableGridPicker';
import * as cm from '../utils/cmToolbarActions';
import * as mk from '../utils/milkdownToolbarActions';

interface FormattingToolbarProps {
  editorMode: EditorMode;
  viewRef: React.RefObject<EditorView | null>;
  crepeRef: React.RefObject<Crepe | null>;
}

function Separator() {
  return <div className="w-px h-4 bg-gray-300 mx-0.5 flex-shrink-0" />;
}

interface ToolBtnProps {
  icon: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}

function ToolBtn({ icon, title, active, onClick }: ToolBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
        active
          ? 'bg-blue-100 text-blue-600'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
    </button>
  );
}

export function FormattingToolbar({
  editorMode,
  viewRef,
  crepeRef,
}: FormattingToolbarProps) {
  const { showFormattingToolbar, setShowFormattingToolbar } = useAppStore();
  const [headingLevel, setHeadingLevel] = useState(0);
  const [markState, setMarkState] = useState<mk.MarkState>({
    bold: false,
    italic: false,
    strikethrough: false,
    inlineCode: false,
    link: false,
  });

  const isWysiwyg = editorMode === 'wysiwyg';

  // Poll mark/heading state when selection changes
  const updateState = useCallback(() => {
    if (isWysiwyg && crepeRef.current) {
      setMarkState(mk.getMarkState(crepeRef.current));
      const h = mk.getCurrentHeading(crepeRef.current);
      setHeadingLevel(h.level);
    } else if (!isWysiwyg && viewRef.current) {
      setHeadingLevel(cm.detectHeadingLevel(viewRef.current));
      setMarkState({
        bold: cm.isInlineMarkActive(viewRef.current, '**'),
        italic: cm.isInlineMarkActive(viewRef.current, '*'),
        strikethrough: cm.isInlineMarkActive(viewRef.current, '~~'),
        inlineCode: cm.isInlineMarkActive(viewRef.current, '`'),
        link: false,
      });
    }
  }, [isWysiwyg, crepeRef, viewRef]);

  useEffect(() => {
    const interval = setInterval(updateState, 300);
    return () => clearInterval(interval);
  }, [updateState]);

  // ── Action dispatchers ────────────────────────────────────────────────────

  const act = useCallback(
    (
      cmAction: (view: EditorView) => void,
      mkAction: (crepe: Crepe) => void,
    ) => {
      if (isWysiwyg && crepeRef.current) {
        mkAction(crepeRef.current);
      } else if (viewRef.current) {
        cmAction(viewRef.current);
      }
      setTimeout(updateState, 50);
    },
    [isWysiwyg, crepeRef, viewRef, updateState],
  );

  const onBold = () =>
    act(
      (v) => cm.wrapSelection(v, '**'),
      mk.toggleBold,
    );
  const onItalic = () =>
    act(
      (v) => cm.wrapSelection(v, '*'),
      mk.toggleItalic,
    );
  const onStrikethrough = () =>
    act(
      (v) => cm.wrapSelection(v, '~~'),
      mk.toggleStrikethrough,
    );
  const onInlineCode = () =>
    act(
      (v) => cm.wrapSelection(v, '`'),
      mk.toggleInlineCode,
    );

  const onHeading = (level: number) =>
    act(
      (v) => {
        if (level === 0) cm.removeHeadingPrefix(v);
        else cm.toggleLinePrefix(v, '#'.repeat(level) + ' ');
      },
      (c) => mk.setHeading(c, level),
    );

  const onBlockquote = () =>
    act(
      (v) => cm.toggleLinePrefix(v, '> '),
      mk.toggleBlockquote,
    );
  const onBulletList = () =>
    act(
      (v) => cm.toggleLinePrefix(v, '- '),
      mk.toggleBulletList,
    );
  const onOrderedList = () =>
    act(
      (v) => cm.toggleLinePrefix(v, '1. '),
      mk.toggleOrderedList,
    );
  const onTaskList = () =>
    act(
      (v) => cm.toggleLinePrefix(v, '- [ ] '),
      mk.insertTaskList,
    );

  const onCodeBlock = () =>
    act(
      (v) => cm.insertBlock(v, '```\n\n```'),
      mk.insertCodeBlock,
    );
  const onHr = () =>
    act(
      (v) => cm.insertBlock(v, '---'),
      mk.insertHr,
    );
  const onLink = () =>
    act(cm.insertLink, mk.toggleLink);
  const onImage = () =>
    act(cm.insertImage, mk.insertImage);
  const onTable = (cols: number, rows: number) =>
    act(
      (v) => cm.insertTable(v, cols, rows),
      (c) => mk.insertMilkdownTable(c, rows, cols),
    );

  if (!showFormattingToolbar) {
    return (
      <div className="flex items-center justify-end px-3 py-0.5 bg-gray-50 border-b border-gray-200">
        <button
          onClick={() => setShowFormattingToolbar(true)}
          title="展开格式工具栏"
          className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:bg-gray-100 transition-colors"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1 bg-gray-50 border-b border-gray-200 flex-wrap">
      {/* Text formatting */}
      <ToolBtn icon={<Bold size={14} />} title="加粗 (Ctrl+B)" active={markState.bold} onClick={onBold} />
      <ToolBtn icon={<Italic size={14} />} title="斜体 (Ctrl+I)" active={markState.italic} onClick={onItalic} />
      <ToolBtn icon={<Strikethrough size={14} />} title="删除线 (Ctrl+Alt+X)" active={markState.strikethrough} onClick={onStrikethrough} />
      <ToolBtn icon={<Code size={14} />} title="行内代码 (Ctrl+E)" active={markState.inlineCode} onClick={onInlineCode} />

      <Separator />

      {/* Block structures */}
      <HeadingDropdown currentLevel={headingLevel} onSelect={onHeading} />
      <ToolBtn icon={<Quote size={14} />} title="引用 (Ctrl+Shift+B)" onClick={onBlockquote} />
      <ToolBtn icon={<List size={14} />} title="无序列表 (Ctrl+Alt+8)" onClick={onBulletList} />
      <ToolBtn icon={<ListOrdered size={14} />} title="有序列表 (Ctrl+Alt+7)" onClick={onOrderedList} />
      <ToolBtn icon={<ListChecks size={14} />} title="任务列表" onClick={onTaskList} />

      <Separator />

      {/* Insert */}
      <ToolBtn icon={<FileCode size={14} />} title="代码块" onClick={onCodeBlock} />
      <ToolBtn icon={<Minus size={14} />} title="分割线" onClick={onHr} />
      <ToolBtn icon={<Link size={14} />} title="链接 (Ctrl+K)" active={markState.link} onClick={onLink} />
      <ToolBtn icon={<Image size={14} />} title="图片" onClick={onImage} />
      <TableGridPicker onSelect={onTable} />

      {/* Spacer + collapse */}
      <div className="flex-1" />
      <button
        onClick={() => setShowFormattingToolbar(false)}
        title="折叠格式工具栏"
        className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:bg-gray-100 transition-colors"
      >
        <ChevronUp size={14} />
      </button>
    </div>
  );
}
