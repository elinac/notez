import { describe, expect, it, vi } from 'vitest';
import { codeBlockRenderPreview, getDiagramCodeBlockLanguages } from '../diagramRenderers';

describe('getDiagramCodeBlockLanguages', () => {
  it('includes mermaid and plantuml for the WYSIWYG language picker', () => {
    const names = getDiagramCodeBlockLanguages().map((lang) => lang.name);
    expect(names).toContain('mermaid');
    expect(names).toContain('plantuml');
  });
});

describe('codeBlockRenderPreview', () => {
  it('returns null for non-diagram languages so Milkdown shows source code', () => {
    const applyPreview = vi.fn();
    expect(codeBlockRenderPreview('java', 'class Main {}', applyPreview)).toBe(null);
    expect(applyPreview).not.toHaveBeenCalled();
  });

  it('returns undefined for diagram languages and triggers async preview', () => {
    const applyPreview = vi.fn();
    expect(codeBlockRenderPreview('plantuml', '@startuml\nA -> B\n@enduml', applyPreview)).toBe(
      undefined
    );
    expect(applyPreview).toHaveBeenCalled();
  });
});
