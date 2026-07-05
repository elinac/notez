import type { RenderResult } from './PlantUMLOfflineRenderer';
import { createPlantUmlErrorHost } from './mountPlantUmlErrorView';

export function renderPlantUmlErrorToElement(
  result: Extract<RenderResult, { ok: false }>
): HTMLElement {
  return createPlantUmlErrorHost({
    source: result.source,
    error: result.error,
    line: result.line,
  });
}
