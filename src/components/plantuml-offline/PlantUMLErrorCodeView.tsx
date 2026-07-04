import { useEffect, useLayoutEffect, useRef } from 'react';
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

export function PlantUMLErrorCodeView({
  source,
  errorMessage,
  errorLine,
}: PlantUMLErrorCodeViewProps) {
  const errorLineRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const colorMode = useEffectiveEditorColorMode();
  const isDark = colorMode === 'dark';

  const lines = normalizeSourceLines(source);
  const summary = formatPlantUmlErrorSummary(errorMessage, errorLine);

  useEffect(() => {
    if (errorLine && errorLineRef.current) {
      errorLineRef.current.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    }
  }, [errorLine, source]);

  useLayoutEffect(() => {
    if (!errorLine || !errorLineRef.current || !bubbleRef.current) return;
    const top = errorLineRef.current.offsetTop + errorLineRef.current.offsetHeight + 4;
    bubbleRef.current.style.top = `${top}px`;
  }, [errorLine, source, lines.length]);

  const handleFix = () => {
    useAppStore.getState().requestPlantUmlAiFix({
      source,
      errorMessage,
      errorLine,
    });
  };

  return (
    <div
      className={`puml-error-code-view${isDark ? ' puml-error-code-view--dark' : ''}`}
      role="region"
      aria-label="PlantUML 源码，渲染出错"
    >
      <div className="puml-error-code-view__lang">plantuml</div>
      <div className="puml-error-code-view__lines">
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
              <span className="puml-error-code-view__line-text">
                {line || '\u00a0'}
              </span>
            </div>
          );
        })}
      </div>

      <div
        ref={bubbleRef}
        className={`puml-error-code-view__bubble${
          errorLine ? '' : ' puml-error-code-view__bubble--bottom'
        }`}
        role="alert"
        aria-live="polite"
        data-error-line={errorLine ?? undefined}
      >
        <div className="puml-error-code-view__bubble-main">
          <span className="puml-error-code-view__bubble-icon" aria-hidden="true">
            ⚠
          </span>
          {errorLine !== undefined && (
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
    </div>
  );
}
