import { describe, expect, it } from 'vitest';
import {
  SPLIT_RATIO_EPS,
  clampSplitRatio,
  removeTabSplitRatio,
} from '../splitPaneRatio';

describe('clampSplitRatio', () => {
  it('clamps high values below 1', () => {
    expect(clampSplitRatio(1)).toBeLessThan(1);
    expect(clampSplitRatio(1)).toBe(1 - SPLIT_RATIO_EPS);
  });

  it('clamps low values above 0', () => {
    expect(clampSplitRatio(0)).toBeGreaterThan(0);
    expect(clampSplitRatio(0)).toBe(SPLIT_RATIO_EPS);
  });

  it('leaves interior values unchanged', () => {
    expect(clampSplitRatio(0.37)).toBe(0.37);
  });

  it('returns 0.5 for non-finite input', () => {
    expect(clampSplitRatio(Number.NaN)).toBe(0.5);
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

describe('removeTabSplitRatio', () => {
  it('removes one tab id immutably', () => {
    const before = { a: 0.2, b: 0.8 };
    const after = removeTabSplitRatio(before, 'a');
    expect(after).toEqual({ b: 0.8 });
    expect(before).toEqual({ a: 0.2, b: 0.8 });
  });
});
