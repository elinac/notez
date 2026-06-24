/**
 * Diagram Renderer Registry
 *
 * Extensible registry for code block diagram renderers used in WYSIWYG mode.
 * Each renderer handles a specific language (e.g. "plantuml", "mermaid").
 *
 * To add a new diagram type:
 *   1. Implement a DiagramRenderer
 *   2. Register it with registerDiagramRenderer(language, renderer)
 */

import { LanguageDescription, type LanguageSupport } from '@codemirror/language';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A renderer takes diagram source code and returns:
 *   - A Promise<string>: SVG/HTML string to inject as innerHTML
 *   - A Promise<HTMLElement>: a DOM element to insert directly
 */
export type DiagramRenderer = (code: string) => Promise<string | HTMLElement>;

// ── Registry ──────────────────────────────────────────────────────────────────

const registry = new Map<string, DiagramRenderer>();

/** Register a renderer for a language identifier (case-insensitive). */
export function registerDiagramRenderer(language: string, renderer: DiagramRenderer) {
  registry.set(language.toLowerCase(), renderer);
}

/** Look up a renderer. Returns undefined if not registered. */
export function getDiagramRenderer(language: string): DiagramRenderer | undefined {
  return registry.get(language.toLowerCase().trim());
}

/** Optional search aliases for diagram languages in the Milkdown language picker. */
const diagramLanguageAliases: Record<string, string[]> = {
  plantuml: ['puml'],
  mermaid: ['mmd'],
};

/**
 * CodeMirror language entries for registered diagram types.
 * No syntax highlighter — preview is handled by `codeBlockRenderPreview`.
 */
export function getDiagramCodeBlockLanguages(): LanguageDescription[] {
  return [...registry.keys()].map((name) =>
    LanguageDescription.of({
      name,
      alias: diagramLanguageAliases[name] ?? [],
      load: () => Promise.resolve(undefined as unknown as LanguageSupport),
    })
  );
}

// ── Built-in: PlantUML ────────────────────────────────────────────────────────

import { initDiagramZoom, wrapDiagramZoomContent } from './diagramZoom';
import { renderPlantUMLOffline } from './plantuml-offline/PlantUMLOfflineRenderer';
import { scopeSvgIdsForHtmlDocument } from './plantuml-offline/scopeSvgIdsForHtmlDocument';

registerDiagramRenderer('plantuml', async (code) => {
  const svg = await renderPlantUMLOffline(code);
  return scopeSvgIdsForHtmlDocument(svg);
});

// ── Built-in: Mermaid ─────────────────────────────────────────────────────────

registerDiagramRenderer('mermaid', async (code) => {
  const { renderMermaidSvg, formatMermaidErrorHtml } = await import('./mermaidSingleton');
  const id = `mermaid-wysiwyg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    return await renderMermaidSvg(id, code);
  } catch (err) {
    return formatMermaidErrorHtml(err);
  }
});

// ── Shared render helper ──────────────────────────────────────────────────────

type ApplyPreview = (value: null | string | HTMLElement) => void;

/**
 * Milkdown CodeMirror `renderPreview` callback.
 * - `null`: no preview — show syntax-highlighted source (java, python, …)
 * - `undefined`: async preview — Milkdown shows loading until `applyPreview` runs
 */
export function codeBlockRenderPreview(
  language: string,
  code: string,
  applyPreview: ApplyPreview
): null | undefined {
  if (!getDiagramRenderer(language)) {
    return null;
  }
  void renderDiagramPreview(language, code, applyPreview);
  return undefined;
}

/**
 * Async diagram renderer used by `codeBlockRenderPreview`.
 * Returns true if the language is handled; false means "show raw code".
 */
export async function renderDiagramPreview(
  language: string,
  code: string,
  applyPreview: (value: null | string | HTMLElement) => void
): Promise<boolean> {
  const renderer = getDiagramRenderer(language);
  if (!renderer) return false;

  // Show loading placeholder immediately
  const loading = document.createElement('div');
  loading.textContent = '⏳ 渲染中…';
  loading.className = 'text-gray-400 text-sm p-4';
  applyPreview(loading);

  try {
    const result = await renderer(code);
    const wrapper = document.createElement('div');
    wrapper.className = `diagram-preview diagram-${language.toLowerCase()} diagram-color-fix p-2`;
    wrapper.dataset.diagramZoomRoot = '';

    const content = document.createElement('div');
    if (typeof result === 'string') {
      content.innerHTML = result;
    } else {
      content.appendChild(result);
    }
    wrapper.appendChild(wrapDiagramZoomContent(content));
    initDiagramZoom(wrapper);
    applyPreview(wrapper);
  } catch (err) {
    const errEl = document.createElement('div');
    errEl.className = 'text-red-500 text-sm p-2';
    errEl.textContent = `渲染失败: ${String(err)}`;
    applyPreview(errEl);
  }

  return true;
}
