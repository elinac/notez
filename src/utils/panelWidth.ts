/** 侧栏图标轨宽度（与 Sidebar `w-10` 一致） */
export const SIDEBAR_RAIL_WIDTH_PX = 40;

/** 面板拖动手柄宽度（与 MarkdownEditor 分屏一致） */
export const PANEL_RESIZE_GUTTER_PX = 6;

export const DEFAULT_FILE_PANEL_WIDTH_PX = 224;
export const DEFAULT_AI_PANEL_WIDTH_PX = 288;

export const MIN_PANEL_WIDTH_PX = 160;
export const MAX_PANEL_WIDTH_PX = 640;
/** 拖动时为主编辑区保留的最小宽度 */
export const MIN_MAIN_AREA_WIDTH_PX = 280;

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_FILE_PANEL_WIDTH_PX;
  return Math.min(MAX_PANEL_WIDTH_PX, Math.max(MIN_PANEL_WIDTH_PX, Math.round(width)));
}

/** 在给定可用宽度内限制面板宽度，确保主区域不低于 `minMain`。 */
export function clampPanelWidthInLayout(
  width: number,
  availableWidth: number,
  otherPanelsWidth: number,
  minMain: number = MIN_MAIN_AREA_WIDTH_PX
): number {
  const maxForLayout = Math.max(
    MIN_PANEL_WIDTH_PX,
    availableWidth - otherPanelsWidth - minMain
  );
  const cappedMax = Math.min(MAX_PANEL_WIDTH_PX, maxForLayout);
  if (!Number.isFinite(width)) return clampPanelWidth(DEFAULT_FILE_PANEL_WIDTH_PX);
  return Math.min(cappedMax, Math.max(MIN_PANEL_WIDTH_PX, Math.round(width)));
}
