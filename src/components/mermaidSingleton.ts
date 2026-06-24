/**
 * Mermaid Singleton — ensures mermaid is initialized exactly once.
 *
 * Why this matters:
 *   Calling mermaid.initialize() multiple times corrupts Mermaid's internal
 *   theme/config state, causing it to omit <text> nodes from generated SVGs
 *   (diagrams render as shapes without any labels).
 *
 *   This module is the single source of truth for Mermaid configuration.
 *   All other modules must import `getMermaid()` from here instead of
 *   calling mermaid.initialize() themselves.
 */
import mermaid from 'mermaid';

let initialized = false;

export function ensureMermaidInitialized() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
  });
}

/** Returns the mermaid instance, guaranteed to be initialized. */
export function getMermaid() {
  ensureMermaidInitialized();
  return mermaid;
}

/**
 * Remove temporary DOM that mermaid.render() may leave on document.body.
 * Mermaid throws before calling removeTempElements() on parse/draw failure.
 */
export function cleanupMermaidRenderArtifacts(renderId: string): void {
  document.getElementById(renderId)?.remove();
  document.getElementById(`d${renderId}`)?.remove();
  document.getElementById(`i${renderId}`)?.remove();
}

/** True when SVG is Mermaid's built-in bomb/error diagram instead of real output. */
export function isMermaidErrorSvg(svg: string): boolean {
  return /Syntax error in text|Syntax error in graph/i.test(svg);
}

/**
 * Render Mermaid to an SVG string and always clean up body-level temp nodes.
 * Throws on parse/render failure or when Mermaid returns its error SVG.
 */
export async function renderMermaidSvg(renderId: string, code: string): Promise<string> {
  const mermaid = getMermaid();
  try {
    const { svg } = await mermaid.render(renderId, code);
    cleanupMermaidRenderArtifacts(renderId);
    if (isMermaidErrorSvg(svg)) {
      throw new Error('Mermaid 语法错误');
    }
    return svg;
  } catch (err) {
    cleanupMermaidRenderArtifacts(renderId);
    throw err;
  }
}

export function formatMermaidErrorHtml(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `<div class="text-red-500 text-sm p-2">Mermaid 渲染错误: ${message}</div>`;
}

export default mermaid;
