/** 避免 flex 子项宽度为 0；spec：不设用户可见最小宽度，仅数值边界。 */
export const SPLIT_RATIO_EPS = 0.001;

export function clampSplitRatio(r: number): number {
  if (!Number.isFinite(r)) return 0.5;
  return Math.min(1 - SPLIT_RATIO_EPS, Math.max(SPLIT_RATIO_EPS, r));
}

export function removeTabSplitRatio(
  map: Record<string, number>,
  tabId: string
): Record<string, number> {
  const { [tabId]: _removed, ...rest } = map;
  return rest;
}
