import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useEffectiveEditorColorMode } from '../../hooks/useEffectiveEditorColorMode';
import { formatPlantUmlErrorSummary } from './plantumlErrorUi';

export interface PlantUMLErrorCodeViewProps {
  source: string;
  errorMessage: string;
  errorLine?: number;
}

function normalizeSourceLines(source: string): string[] {
  const lines = source.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** Reserved width for the right-side error callout column */
const CALLOUT_WIDTH_PX = 280;
const CALLOUT_GAP_PX = 12;

export function PlantUMLErrorCodeView({
  source,
  errorMessage,
  errorLine,
}: PlantUMLErrorCodeViewProps) {
  const linesRef = useRef<HTMLDivElement>(null);
  const errorLineRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleTop, setBubbleTop] = useState(0);
  const [linesPadBottom, setLinesPadBottom] = useState(0);
  const colorMode = useEffectiveEditorColorMode();
  const isDark = colorMode === 'dark';

  const lines = normalizeSourceLines(source);
  const summary = formatPlantUmlErrorSummary(errorMessage, errorLine);
  const hasAnchoredBubble = errorLine !== undefined;

  useLayoutEffect(() => {
    if (!hasAnchoredBubble) {
      setBubbleTop(0);
      setLinesPadBottom(0);
      return;
    }

    const updateBubbleLayout = () => {
      const lineEl = errorLineRef.current;
      const bubbleEl = bubbleRef.current;
      const linesEl = linesRef.current;
      if (!lineEl || !bubbleEl || !linesEl) return;

      setBubbleTop(lineEl.offsetTop);

      const bubbleBottom = lineEl.offsetTop + bubbleEl.offsetHeight;
      const lastLine = linesEl.querySelector<HTMLElement>(':scope > .puml-error-code-view__line:last-of-type');
      const naturalBottom = lastLine
        ? lastLine.offsetTop + lastLine.offsetHeight
        : lineEl.offsetTop + lineEl.offsetHeight;
      setLinesPadBottom(Math.max(0, bubbleBottom - naturalBottom + 8));
    };

    updateBubbleLayout();

    window.addEventListener('resize', updateBubbleLayout);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateBubbleLayout);
      if (bubbleRef.current) ro.observe(bubbleRef.current);
      if (linesRef.current) ro.observe(linesRef.current);
    }

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateBubbleLayout);
    };
  }, [hasAnchoredBubble, errorLine, source, summary]);

  useEffect(() => {
    if (errorLine && errorLineRef.current) {
      errorLineRef.current.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    }
  }, [errorLine, source]);

  const handleFix = () => {
    useAppStore.getState().requestPlantUmlAiFix({
      source,
      errorMessage,
      errorLine,
    });
  };

  const bubbleClassName = hasAnchoredBubble
    ? 'puml-error-code-view__bubble puml-error-code-view__bubble--callout'
    : 'puml-error-code-view__bubble puml-error-code-view__bubble--bottom';

  const bubble = (
    <div
      ref={hasAnchoredBubble ? bubbleRef : undefined}
      className={bubbleClassName}
      style={hasAnchoredBubble ? { top: bubbleTop } : undefined}
      role="alert"
      aria-live="polite"
    >
      <div className="puml-error-code-view__bubble-main">
        <span className="puml-error-code-view__bubble-icon" aria-hidden="true">
          ⚠
        </span>
        {hasAnchoredBubble && (
          <span className="puml-error-code-view__line-badge">第 {errorLine} 行</span>
        )}
        <span className="puml-error-code-view__bubble-summary">{summary}</span>
      </div>
      <button
        type="button"
        className="plantuml-ai-fix-btn puml-error-code-view__fix-btn"
        title="使用 AI 分析并修复语法错误"
        onClick={handleFix}
      >
        AI 修复
      </button>
    </div>
  );

  const linesStyle = hasAnchoredBubble
    ? {
        paddingRight: CALLOUT_WIDTH_PX + CALLOUT_GAP_PX,
        paddingBottom: linesPadBottom,
      }
    : undefined;

  return (
    <div
      className={`puml-error-code-view${isDark ? ' puml-error-code-view--dark' : ''}${
        hasAnchoredBubble ? ' puml-error-code-view--callout' : ''
      }`}
      role="region"
      aria-label="PlantUML 源码，渲染出错"
    >
      <div className="puml-error-code-view__lang">plantuml</div>
      <div
        ref={linesRef}
        className="puml-error-code-view__lines"
        style={linesStyle}
      >
        {lines.map((line, i) => {
          const lineNo = i + 1;
          const isErr = errorLine === lineNo;
          return (
            <div
              key={lineNo}
              ref={isErr ? errorLineRef : undefined}
              className={
                isErr
                  ? 'puml-error-code-view__line puml-error-code-view__line--err'
                  : 'puml-error-code-view__line'
              }
              aria-invalid={isErr ? true : undefined}
            >
              <span className="puml-error-code-view__line-no" aria-hidden="true">
                {isErr ? '✕' : ''}
                {lineNo}
              </span>
              <span className="puml-error-code-view__line-text">{line || '\u00a0'}</span>
            </div>
          );
        })}
        {hasAnchoredBubble && bubble}
      </div>
      {!hasAnchoredBubble && bubble}
    </div>
  );
}
