import { describe, expect, it } from 'vitest';
import {
  WYSIWYG_CONTENT_WIDTH_DEFAULT,
  normalizeWysiwygContentWidthPercent,
  wysiwygPadInlineCss,
} from '../wysiwygContentWidth';

describe('normalizeWysiwygContentWidthPercent', () => {
  it('缺省与非法回落默认 100', () => {
    expect(normalizeWysiwygContentWidthPercent(undefined)).toBe(WYSIWYG_CONTENT_WIDTH_DEFAULT);
    expect(normalizeWysiwygContentWidthPercent(null)).toBe(100);
    expect(normalizeWysiwygContentWidthPercent('x')).toBe(100);
    expect(normalizeWysiwygContentWidthPercent(NaN)).toBe(100);
    expect(normalizeWysiwygContentWidthPercent(Infinity)).toBe(100);
  });

  it('clamp 并四舍五入', () => {
    expect(normalizeWysiwygContentWidthPercent(49)).toBe(50);
    expect(normalizeWysiwygContentWidthPercent(101)).toBe(100);
    expect(normalizeWysiwygContentWidthPercent(80.6)).toBe(81);
    expect(normalizeWysiwygContentWidthPercent('70')).toBe(70);
  });
});

describe('wysiwygPadInlineCss', () => {
  it('100 → 120px', () => {
    expect(wysiwygPadInlineCss(100)).toBe('120px');
  });

  it('<100 → max(24px, calc(...))', () => {
    expect(wysiwygPadInlineCss(70)).toBe('max(24px, calc((100% - 70%) / 2))');
    expect(wysiwygPadInlineCss(50)).toBe('max(24px, calc((100% - 50%) / 2))');
  });
});
