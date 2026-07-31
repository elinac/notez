export const WYSIWYG_CONTENT_WIDTH_MIN = 50;
export const WYSIWYG_CONTENT_WIDTH_MAX = 100;
export const WYSIWYG_CONTENT_WIDTH_DEFAULT = 100;

export function normalizeWysiwygContentWidthPercent(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return WYSIWYG_CONTENT_WIDTH_DEFAULT;
  return Math.min(
    WYSIWYG_CONTENT_WIDTH_MAX,
    Math.max(WYSIWYG_CONTENT_WIDTH_MIN, Math.round(n)),
  );
}

/** Crepe 策略 A：N=100 还原主题 120px；否则用侧边距塑造内容占比 ≈ N% */
export function wysiwygPadInlineCss(percent: number): string {
  const n = normalizeWysiwygContentWidthPercent(percent);
  if (n >= WYSIWYG_CONTENT_WIDTH_MAX) return '120px';
  return `max(24px, calc((100% - ${n}%) / 2))`;
}
