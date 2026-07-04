/**
 * PlantUML render error UI: line parsing, highlighted source, AI fix button payload.
 */

export type PlantUmlFixPayload = {
  source: string;
  errorMessage: string;
  errorLine?: number;
};

const fixPayloadStore = new Map<string, PlantUmlFixPayload>();

let fixIdCounter = 0;

function nextFixId(): string {
  fixIdCounter += 1;
  return `puml-fix-${Date.now()}-${fixIdCounter}`;
}

export function registerPlantUmlFixPayload(payload: PlantUmlFixPayload): string {
  const id = nextFixId();
  fixPayloadStore.set(id, payload);
  return id;
}

export function consumePlantUmlFixPayload(id: string): PlantUmlFixPayload | undefined {
  const payload = fixPayloadStore.get(id);
  if (payload) fixPayloadStore.delete(id);
  return payload;
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parse error line number from Rust or JAR PlantUML error messages. */
export function parsePlantUmlErrorLine(message: string): number | undefined {
  const rustMatch = message.match(/第\s*(\d+)\s*行/);
  if (rustMatch) return parseInt(rustMatch[1], 10);

  const lines = message.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (/^(ERROR|Syntax Error)/i.test(lines[i]) || lines[i].includes('退出码')) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/^\d+$/.test(lines[j])) return parseInt(lines[j], 10);
      }
    }
  }

  const lineMatch = message.match(/(?:line|Line)\s+(\d+)/);
  if (lineMatch) return parseInt(lineMatch[1], 10);

  return undefined;
}

/** Human-readable error summary (hide redundant exit code / standalone line no). */
export function formatPlantUmlErrorSummary(message: string, errorLine?: number): string {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const filtered = lines.filter((line) => {
    if (/PlantUML 退出码/i.test(line)) return false;
    if (line === 'ERROR') return false;
    if (errorLine !== undefined && line === String(errorLine)) return false;
    return true;
  });

  if (filtered.length > 0) return filtered.join(' · ');
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

function normalizeSourceLines(source: string): string[] {
  const lines = source.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** 过长源码只展示错误行附近，避免错误卡片被撑得过高 */
function sliceSourceForDisplay(
  source: string,
  errorLine?: number
): { lines: string[]; startLine: number; truncated: boolean } {
  const all = normalizeSourceLines(source);
  const maxLines = 12;
  const context = 2;

  if (all.length <= maxLines) {
    return { lines: all, startLine: 1, truncated: false };
  }

  if (errorLine !== undefined && errorLine >= 1 && errorLine <= all.length) {
    let start = Math.max(0, errorLine - 1 - context);
    let end = Math.min(all.length, errorLine + context);
    while (end - start < maxLines && (start > 0 || end < all.length)) {
      if (start > 0) start--;
      else end++;
    }
    return {
      lines: all.slice(start, end),
      startLine: start + 1,
      truncated: start > 0 || end < all.length,
    };
  }

  return { lines: all.slice(0, maxLines), startLine: 1, truncated: true };
}

function formatSourceWithLineNumbers(source: string, errorLine?: number): string {
  const { lines, startLine, truncated } = sliceSourceForDisplay(source, errorLine);
  const rows = lines
    .map((line, i) => {
      const n = startLine + i;
      const isErr = errorLine === n;
      const rowCls = isErr
        ? 'plantuml-error__source-row plantuml-error__source-row--err'
        : 'plantuml-error__source-row';
      const text = escapeHtmlText(line);
      return `<div class="${rowCls}"><span class="plantuml-error__line-no">${n}</span><span class="plantuml-error__line-text">${text || '<span class="plantuml-error__empty-line" aria-hidden="true"></span>'}</span></div>`;
    })
    .join('');

  if (!truncated) return rows;

  const hint =
    '<div class="plantuml-error__source-truncated">… 仅显示部分源码，完整内容在编辑器中查看</div>';
  return `${hint}${rows}`;
}

/** @deprecated 主路径改用 PlantUMLErrorCodeView；保留供全局 click 委托兜底 */
export function formatPlantUmlErrorHtml(message: string, source: string): string {
  const errorLine = parsePlantUmlErrorLine(message);
  const summary = escapeHtmlText(formatPlantUmlErrorSummary(message, errorLine));
  const fixId = registerPlantUmlFixPayload({ source, errorMessage: message, errorLine });

  const lineBadge =
    errorLine !== undefined
      ? `<span class="plantuml-error__line-badge">第 ${errorLine} 行</span>`
      : `<span class="plantuml-error__line-badge plantuml-error__line-badge--unknown">行号未知</span>`;

  const sourceHtml = formatSourceWithLineNumbers(source, errorLine);

  return `<div class="plantuml-error" role="alert" aria-live="polite">
      <div class="plantuml-error__header">
        <div class="plantuml-error__header-main">
          <span class="plantuml-error__icon" aria-hidden="true">✕</span>
          <span class="plantuml-error__title">PlantUML 渲染失败</span>
          ${lineBadge}
        </div>
        <button type="button" class="plantuml-ai-fix-btn" data-fix-id="${fixId}" title="使用 AI 分析并修复语法错误">AI 修复</button>
      </div>
      <p class="plantuml-error__summary">${summary}</p>
      <details class="plantuml-error__details">
        <summary class="plantuml-error__details-summary">查看源码</summary>
        <div class="plantuml-error__source-wrap">
          <div class="plantuml-error__source">${sourceHtml}</div>
        </div>
      </details>
    </div>`;
}
