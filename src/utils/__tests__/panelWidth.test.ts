import { describe, expect, it } from 'vitest';
import {
  clampPanelWidth,
  clampPanelWidthInLayout,
  DEFAULT_FILE_PANEL_WIDTH_PX,
  MAX_PANEL_WIDTH_PX,
  MIN_PANEL_WIDTH_PX,
} from '../panelWidth';

describe('clampPanelWidth', () => {
  it('clamps to min/max', () => {
    expect(clampPanelWidth(50)).toBe(MIN_PANEL_WIDTH_PX);
    expect(clampPanelWidth(9999)).toBe(MAX_PANEL_WIDTH_PX);
    expect(clampPanelWidth(240)).toBe(240);
  });

  it('falls back for non-finite input', () => {
    expect(clampPanelWidth(NaN)).toBe(DEFAULT_FILE_PANEL_WIDTH_PX);
  });
});

describe('clampPanelWidthInLayout', () => {
  it('shrinks max when layout is tight', () => {
    expect(clampPanelWidthInLayout(500, 800, 288, 280)).toBe(232);
  });

  it('never goes below min panel width when layout allows', () => {
    expect(clampPanelWidthInLayout(100, 1200, 0, 280)).toBe(MIN_PANEL_WIDTH_PX);
  });
});
