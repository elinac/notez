/**
 * Phase 0 Validation: DOMPurify impact on diagram SVG content.
 *
 * The unpatched @milkdown/components runs DOMPurify.sanitize() on preview content.
 * This test verifies what gets stripped from PlantUML and Mermaid SVG outputs.
 */
import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';

const PLANTUML_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  contentScriptType="application/ecmascript" contentStyleType="text/css"
  height="200" width="300" style="background: #FFFFFF;">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:rgb(255,255,0);stop-opacity:1"/>
      <stop offset="100%" style="stop-color:rgb(255,0,0);stop-opacity:1"/>
    </linearGradient>
  </defs>
  <g>
    <rect fill="#FEFECE" height="30" style="stroke:#A80036;stroke-width:1.5;" width="80" x="10" y="10"/>
    <text fill="#000000" font-family="sans-serif" font-size="14" x="20" y="30">Alice</text>
    <line style="stroke:#A80036;stroke-width:1.0;stroke-dasharray:5.0,5.0;" x1="50" x2="50" y1="40" y2="180"/>
    <polygon fill="#A80036" points="138,67,148,71,138,75,142,71" style="stroke:#A80036;stroke-width:1.0;"/>
    <path d="M 50,71 L 142,71" style="stroke:#A80036;stroke-width:1.0;"/>
    <text fill="#000000" font-family="sans-serif" font-size="13" x="60" y="66">hello</text>
  </g>
</svg>`;

const MERMAID_SVG_WITH_FOREIGN_OBJECT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"
  class="mermaid-svg" style="max-width: 400px;" role="graphics-document document">
  <style>
    .node rect { fill: #f9f; stroke: #333; }
    .edgePath path { stroke: #333; }
  </style>
  <g class="nodes">
    <g class="node" id="flowchart-A-0" transform="translate(100,50)">
      <rect rx="5" ry="5" x="-40" y="-20" width="80" height="40" class="node-rect"/>
      <g class="label" transform="translate(-30,-10)">
        <foreignObject width="60" height="20">
          <div xmlns="http://www.w3.org/1999/xhtml" style="display:inline-block;white-space:nowrap;">
            <span class="nodeLabel">Start</span>
          </div>
        </foreignObject>
      </g>
    </g>
    <g class="node" id="flowchart-B-1" transform="translate(300,50)">
      <rect rx="5" ry="5" x="-40" y="-20" width="80" height="40"/>
      <g class="label" transform="translate(-30,-10)">
        <foreignObject width="60" height="20">
          <div xmlns="http://www.w3.org/1999/xhtml" style="display:inline-block;white-space:nowrap;">
            <span class="nodeLabel">End</span>
          </div>
        </foreignObject>
      </g>
    </g>
  </g>
  <g class="edgePaths">
    <path class="edgePath" d="M140,50L260,50" marker-end="url(#arrowhead)"/>
  </g>
</svg>`;

const MERMAID_SVG_TEXT_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <g class="nodes">
    <g class="node" transform="translate(100,50)">
      <rect rx="5" ry="5" x="-40" y="-20" width="80" height="40"/>
      <text x="0" y="5" text-anchor="middle">Hello</text>
    </g>
  </g>
</svg>`;

describe('DOMPurify SVG impact (Phase 0 validation)', () => {
  it('PlantUML SVG preserves all elements', () => {
    const result = DOMPurify.sanitize(PLANTUML_SVG);
    expect(result).toContain('<rect');
    expect(result).toContain('<text');
    expect(result).toContain('<line');
    expect(result).toContain('<polygon');
    expect(result).toContain('<path');
    expect(result).toContain('linearGradient');
    expect(result).toContain('style=');
    expect(result).toContain('font-family');
  });

  it('PlantUML SVG: style attributes preserved', () => {
    const result = DOMPurify.sanitize(PLANTUML_SVG);
    expect(result).toContain('stroke:#A80036');
    expect(result).toContain('stroke-dasharray');
  });

  it('Mermaid SVG: foreignObject is stripped by default', () => {
    const result = DOMPurify.sanitize(MERMAID_SVG_WITH_FOREIGN_OBJECT);
    const hasForeignObject = result.includes('<foreignObject') || result.includes('<foreignobject');
    expect(hasForeignObject).toBe(false);
  });

  it('Mermaid SVG: node labels inside foreignObject are lost', () => {
    const result = DOMPurify.sanitize(MERMAID_SVG_WITH_FOREIGN_OBJECT);
    expect(result).not.toContain('nodeLabel');
    expect(result).not.toContain('Start');
    expect(result).not.toContain('End');
  });

  it('Mermaid SVG (text-only fallback): text elements preserved', () => {
    const result = DOMPurify.sanitize(MERMAID_SVG_TEXT_ONLY);
    expect(result).toContain('<text');
    expect(result).toContain('Hello');
  });

  it('data-* attributes on wrapper div are preserved', () => {
    const wrapper = `<div class="diagram-preview" data-diagram-zoom-root>
      <div class="diagram-zoom-viewport">
        <div class="diagram-zoom-content" data-diagram-zoom-content>
          ${PLANTUML_SVG}
        </div>
      </div>
    </div>`;
    const result = DOMPurify.sanitize(wrapper);
    expect(result).toContain('data-diagram-zoom-root');
    expect(result).toContain('data-diagram-zoom-content');
    expect(result).toContain('diagram-preview');
  });

  it('SVG <style> element is preserved', () => {
    const result = DOMPurify.sanitize(MERMAID_SVG_WITH_FOREIGN_OBJECT);
    expect(result).toContain('<style>');
    expect(result).toContain('.node rect');
  });

  it('ADD_TAGS preserves foreignObject shell but strips XHTML content inside', () => {
    const result = DOMPurify.sanitize(MERMAID_SVG_WITH_FOREIGN_OBJECT, {
      ADD_TAGS: ['foreignObject'],
      ADD_ATTR: ['xmlns'],
    });
    const hasForeignObject = result.includes('<foreignObject') || result.includes('<foreignobject');
    expect(hasForeignObject).toBe(true);
    // XHTML content inside foreignObject is still stripped — proving ADD_TAGS alone is insufficient
    expect(result).not.toContain('Start');
    expect(result).not.toContain('nodeLabel');
  });
});
