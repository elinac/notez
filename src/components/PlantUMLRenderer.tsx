import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsStore } from '../store/useSettingsStore';
import { renderPlantUMLOffline } from './plantuml-offline/PlantUMLOfflineRenderer';
import { PlantUMLErrorCodeView } from './plantuml-offline/PlantUMLErrorCodeView';
import { scopeSvgIdsForHtmlDocument } from './plantuml-offline/scopeSvgIdsForHtmlDocument';
import { formatMermaidErrorHtml, renderMermaidSvg } from './mermaidSingleton';
import { diagramBlockShellHtml, initDiagramBlockZoom } from './diagramZoom';
import { ensureSplitPaneDiagramCopyToolbars } from './diagramCopy';

interface PlantUMLRendererProps {
  content: string;
  /**
   * 当前标签/文档标识（如 activeTabId）。在「不同文件但渲染出的 html 字符串相同」时仍应刷新预览；
   * 仅依赖 theme+html 会漏掉这类 effect，导致继承样式或旧 SVG 残留。
   */
  previewDocumentId?: string;
}

type ErrorPortalEntry = {
  node: HTMLElement;
  source: string;
  error: string;
  line?: number;
};

/**
 * Render markdown with PlantUML offline support
 * Uses placeholder tokens to protect code blocks from markdown processing
 */
export function renderMarkdownWithPlantUML(text: string): string {
  // Step 1: Extract all code blocks and replace with opaque placeholder tokens
  // This prevents renderBasicMarkdown from corrupting data inside code blocks
  const plantUMLBlocks: string[] = [];
  const mermaidBlocks: string[] = [];

  let processedText = text.replace(
    /```plantuml\r?\n([\s\S]*?)```/g,
    (_match, code) => {
      const escaped = code.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      const idx = plantUMLBlocks.length;
      plantUMLBlocks.push(
        diagramBlockShellHtml(
          'plantuml',
          'plantuml-container',
          'data-plantuml-code',
          escaped,
          '<div class="text-gray-400 text-sm">Loading PlantUML diagram...</div>'
        )
      );
      return `%%PLANTUML_BLOCK_${idx}%%`;
    }
  );

  processedText = processedText.replace(
    /```mermaid\r?\n([\s\S]*?)```/g,
    (_match, code) => {
      const escapedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      const idx = mermaidBlocks.length;
      mermaidBlocks.push(
        diagramBlockShellHtml(
          'mermaid',
          'mermaid-container',
          'data-mermaid-code',
          escapedCode,
          '<div class="text-gray-400 text-sm">Loading diagram...</div>'
        )
      );
      return `%%MERMAID_BLOCK_${idx}%%`;
    }
  );

  // Step 2: Run markdown rendering on remaining text (placeholders are untouched)
  processedText = renderBasicMarkdown(processedText);

  // Step 3: Restore placeholder tokens with the real HTML divs
  plantUMLBlocks.forEach((html, idx) => {
    processedText = processedText.replace(`%%PLANTUML_BLOCK_${idx}%%`, html);
  });
  mermaidBlocks.forEach((html, idx) => {
    processedText = processedText.replace(`%%MERMAID_BLOCK_${idx}%%`, html);
  });

  return processedText;
}

/**
 * Basic markdown renderer
 */
function renderBasicMarkdown(text: string): string {
  // ── GFM Tables: parse before line-by-line replacements ──────────────────────
  text = text.replace(
    /^(\|.+\|[ \t]*\n)(\|[-:| \t]+\|[ \t]*\n)((?:\|.+\|[ \t]*\n?)*)/gm,
    (_match, headerRow, _sepRow, bodyRows) => {
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim());

      const headers = parseRow(headerRow);
      const thCells = headers
        .map((h) => `<th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide border border-gray-200 bg-gray-50">${h}</th>`)
        .join('');

      const rows = bodyRows
        .trim()
        .split('\n')
        .filter((r: string) => r.trim())
        .map((row: string) => {
          const cells = parseRow(row)
            .map((c) => `<td class="px-3 py-2 text-sm text-gray-700 border border-gray-200">${c}</td>`)
            .join('');
          return `<tr class="even:bg-gray-50">${cells}</tr>`;
        })
        .join('');

      return `<div class="overflow-x-auto my-4"><table class="min-w-full border-collapse border border-gray-200 rounded"><thead><tr>${thCells}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  );

  return (
    text
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>')
      .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/`([^`]+)`/gim, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      // Only match fenced code blocks that are NOT already converted to divs
      .replace(/```(\w*)\r?\n([\s\S]*?)```/g, '<pre class="bg-gray-100 p-3 rounded overflow-x-auto my-2"><code class="text-sm">$2</code></pre>')
      .replace(/^\s*-\s+(.*$)/gim, '<li class="ml-4">$1</li>')
      .replace(/(<li.*<\/li>\n)+/gim, '<ul class="list-disc my-2">$&</ul>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" class="text-blue-600 hover:underline" target="_blank">$1</a>')
      .replace(/^>\s+(.*$)/gim, '<blockquote class="border-l-4 border-gray-300 pl-4 my-2 italic text-gray-600">$1</blockquote>')
      .replace(/^---$/gim, '<hr class="my-4 border-gray-300" />')
      .replace(/\n\n/gim, '</p><p class="my-2">')
      // Don't wrap lines that start with block-level HTML tags (including <svg)
      .replace(/^(?!<[hlusp]|<pre|<blockquote|<hr|<div|<svg|<table)(.+)$/gim, '<p class="my-2">$1</p>')
  );
}

export function PlantUMLRenderer({ content, previewDocumentId = '' }: PlantUMLRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plantUmlTheme = useSettingsStore((s) => s.plantUmlTheme);
  const [errorPortals, setErrorPortals] = useState<ErrorPortalEntry[]>([]);

  // useLayoutEffect：在绘制前同步 innerHTML，减少分屏下异步注入 SVG 时的样式/继承错乱；
  // 依赖 content + plantUmlTheme + previewDocumentId，避免仅 theme+html 碰撞时跳过刷新。
  useLayoutEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const html = renderMarkdownWithPlantUML(content);

    // Write HTML into DOM directly (bypass React's virtual DOM for async updates)
    containerRef.current.innerHTML = html;
    setErrorPortals([]);

    for (const block of containerRef.current.querySelectorAll<HTMLElement>('.diagram-block')) {
      initDiagramBlockZoom(block);
    }
    ensureSplitPaneDiagramCopyToolbars(containerRef.current);

    // Step 2: async-render PlantUML blocks（串行：并行会同时起多 JVM，严重卡顿）
    const plantUMLBlocks = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>('.plantuml-container')
    );
    const themeForThisPass = plantUmlTheme;
    (async () => {
      const errors: ErrorPortalEntry[] = [];
      for (const block of plantUMLBlocks) {
        if (cancelled) return;
        const code = block.getAttribute('data-plantuml-code');
        if (!code) continue;
        const decoded = code
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"');
        const result = await renderPlantUMLOffline(decoded, themeForThisPass);
        if (cancelled) return;
        if (containerRef.current?.contains(block)) {
          if (result.ok) {
            block.innerHTML = scopeSvgIdsForHtmlDocument(result.html);
          } else {
            block.innerHTML = '';
            errors.push({
              node: block,
              source: result.source,
              error: result.error,
              line: result.line,
            });
          }
        }
      }
      if (!cancelled && errors.length > 0) {
        setErrorPortals(errors);
      }
    })();

    // Step 3: async-render all Mermaid blocks
    const mermaidBlocks = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>('.mermaid-container')
    );
    if (mermaidBlocks.length > 0) {
      (async () => {
        for (const [index, block] of mermaidBlocks.entries()) {
          if (cancelled) return;
          const code = block.getAttribute('data-mermaid-code');
          if (!code) continue;
          try {
            // Decode HTML entities
            const decoded = code
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'");
            const id = `mermaid-${Date.now()}-${index}`;
            const svg = await renderMermaidSvg(id, decoded);
            if (cancelled) return;
            if (containerRef.current?.contains(block)) {
              block.innerHTML = svg;
            }
          } catch (err) {
            if (cancelled) return;
            if (containerRef.current?.contains(block)) {
              block.innerHTML = formatMermaidErrorHtml(err);
            }
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [content, plantUmlTheme, previewDocumentId]);

  return (
    <>
      <div
        ref={containerRef}
        className="diagram-color-fix prose prose-slate max-w-none p-4"
      />
      {errorPortals.map(({ node, source, error, line }, i) =>
        createPortal(
          <PlantUMLErrorCodeView
            key={`${previewDocumentId}-${i}-${source.slice(0, 32)}`}
            source={source}
            errorMessage={error}
            errorLine={line}
          />,
          node
        )
      )}
    </>
  );
}

// Keep for backward compatibility
export function encodePlantUML(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}
