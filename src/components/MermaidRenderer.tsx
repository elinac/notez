/**
 * MermaidRenderer — Markdown preview with Mermaid diagram support
 *
 * Architecture:
 *   1. Parse markdown into a list of typed blocks (text | mermaid).
 *   2. Render text blocks via basic markdown → dangerouslySetInnerHTML.
 *   3. Render mermaid blocks into isolated <div> refs using mermaid.render(),
 *      which returns an SVG string injected via innerHTML.
 *      This avoids React re-render overwriting the SVG that mermaid wrote.
 *
 * Key decisions:
 *   - securityLevel:'loose' is required so SVG is inlined into the DOM.
 *     'strict' uses a shadow DOM, which hides SVG text nodes.
 *   - We do NOT use mermaid.run() because React's reconciler would clear
 *     the DOM node on every re-render before mermaid.run() completes.
 *   - Each MermaidBlock component keeps a stable ref and renders once when
 *     mounted, re-rendering only when its source code changes.
 */
import { useEffect, useRef, memo } from 'react';
import { ensureMermaidInitialized, renderMermaidSvg } from './mermaidSingleton';

// Initialize once at module load time
ensureMermaidInitialized();

// ── Block types ────────────────────────────────────────────────────────────────

export type TextBlock    = { type: 'text';    html: string };
export type MermaidBlock = { type: 'mermaid'; code: string; key: string };
export type Block = TextBlock | MermaidBlock;

// ── Parse markdown into blocks ─────────────────────────────────────────────────

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const mermaidRe = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let mermaidIdx = 0;

  while ((match = mermaidRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      blocks.push({ type: 'text', html: renderBasicMarkdown(before) });
    }
    blocks.push({
      type: 'mermaid',
      code: match[1].trimEnd(),
      key: `mermaid-${mermaidIdx++}`,
    });
    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  if (remaining.trim()) {
    blocks.push({ type: 'text', html: renderBasicMarkdown(remaining) });
  }

  return blocks;
}

// ── MermaidBlock component ─────────────────────────────────────────────────────

let renderCounter = 0;

const MermaidDiagram = memo(function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    let cancelled = false;

    const id = `mermaid-svg-${++renderCounter}`;
    renderMermaidSvg(id, code).then((svg) => {
      if (!cancelled && el) {
        el.innerHTML = svg;
        // Make SVG responsive
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
        }
      }
    }).catch((err: unknown) => {
      if (!cancelled && el) {
        el.innerHTML = `<div style="color:#ef4444;padding:8px;border:1px solid #fca5a5;border-radius:4px;font-size:12px">Mermaid 渲染错误: ${String(err)}</div>`;
      }
    });

    return () => { cancelled = true; };
  }, [code]);

  return (
    <div
      ref={containerRef}
      className="my-4 overflow-x-auto"
      style={{ minHeight: '40px' }}
    />
  );
});

// ── MermaidRenderer ────────────────────────────────────────────────────────────

interface MermaidRendererProps {
  content: string;
}

export function MermaidRenderer({ content }: MermaidRendererProps) {
  const blocks = parseBlocks(content);

  return (
    <div className="p-4 text-sm text-gray-800 leading-relaxed">
      {blocks.map((block, i) => {
        if (block.type === 'mermaid') {
          return <MermaidDiagram key={block.key} code={block.code} />;
        }
        return (
          <div
            key={`text-${i}`}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        );
      })}
    </div>
  );
}

// ── Export for tests ───────────────────────────────────────────────────────────

export { parseBlocks };

/**
 * Legacy export kept for backward-compat with diagramRenderers.ts
 * Returns the HTML string representation (mermaid blocks become placeholder divs).
 */
export function renderMarkdownWithMermaid(text: string): string {
  const blocks = parseBlocks(text);
  return blocks.map((b) =>
    b.type === 'text'
      ? b.html
      : `<div class="mermaid-placeholder" data-code="${encodeURIComponent(b.code)}"></div>`
  ).join('\n');
}

// ── Basic markdown renderer ────────────────────────────────────────────────────

function renderBasicMarkdown(text: string): string {
  return text
    .replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>')
    .replace(/^## (.*$)/gim,  '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>')
    .replace(/^# (.*$)/gim,   '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gim,     '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim,         '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-100 p-3 rounded overflow-x-auto my-2"><code class="text-sm">$2</code></pre>')
    .replace(/^\s*-\s+(.*$)/gim, '<li class="ml-4">$1</li>')
    .replace(/(<li.*<\/li>\n)+/gim, '<ul class="list-disc my-2">$&</ul>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" class="text-blue-600 hover:underline" target="_blank">$1</a>')
    .replace(/^>\s+(.*$)/gim, '<blockquote class="border-l-4 border-gray-300 pl-4 my-2 italic text-gray-600">$1</blockquote>')
    .replace(/^---$/gim, '<hr class="my-4 border-gray-300" />')
    .replace(/\n\n/gim, '</p><p class="my-2">')
    .replace(/^(?!<[hlu]|<pre|<blockquote|<hr|<div)(.+)$/gim, '<p class="my-2">$1</p>');
}
