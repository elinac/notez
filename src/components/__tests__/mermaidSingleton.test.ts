import { describe, it, expect, beforeEach } from 'vitest';
import {
  cleanupMermaidRenderArtifacts,
  isMermaidErrorSvg,
  renderMermaidSvg,
} from '../mermaidSingleton';

describe('mermaidSingleton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('cleanupMermaidRenderArtifacts', () => {
    it('removes mermaid temp nodes left on document.body', () => {
      const id = 'test-render-id';
      document.body.innerHTML = `
        <div id="d${id}"><svg id="${id}"><text class="error-text">Syntax error in text</text></svg></div>
        <iframe id="i${id}"></iframe>
      `;
      expect(document.getElementById(`d${id}`)).not.toBeNull();

      cleanupMermaidRenderArtifacts(id);

      expect(document.getElementById(id)).toBeNull();
      expect(document.getElementById(`d${id}`)).toBeNull();
      expect(document.getElementById(`i${id}`)).toBeNull();
    });
  });

  describe('isMermaidErrorSvg', () => {
    it('detects mermaid built-in error SVG', () => {
      expect(isMermaidErrorSvg('<text>Syntax error in text</text>')).toBe(true);
      expect(isMermaidErrorSvg('<text>Syntax error in graph</text>')).toBe(true);
      expect(isMermaidErrorSvg('<svg><text>flowchart</text></svg>')).toBe(false);
    });
  });

  describe('renderMermaidSvg', () => {
    it('cleans up temp DOM when draw fails after parse (jsdom getBBox limitation)', async () => {
      await expect(
        renderMermaidSvg('draw-fail', 'flowchart LR\nA-->B')
      ).rejects.toThrow();

      expect(document.body.querySelector('.error-text')).toBeNull();
      expect(document.getElementById('ddraw-fail')).toBeNull();
    });

    it('throws on invalid syntax and cleans up leaked error DOM', async () => {
      await expect(
        renderMermaidSvg('invalid-syntax', '@startuml\nA->B\n@enduml')
      ).rejects.toThrow();

      expect(document.body.querySelector('.error-text')).toBeNull();
      expect(document.getElementById('dinvalid-syntax')).toBeNull();
    });

    it('does not accumulate error banners across repeated failures', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(renderMermaidSvg(`repeat-fail-${i}`, '')).rejects.toThrow();
      }
      expect(document.body.querySelectorAll('.error-text')).toHaveLength(0);
      expect(document.body.querySelectorAll('[id^="drepeat-fail-"]')).toHaveLength(0);
    });
  });
});
