import { describe, expect, it, vi } from 'vitest';

vi.mock('../plantuml-offline/PlantUMLOfflineRenderer', () => ({
  renderPlantUMLOffline: vi.fn().mockResolvedValue({
    ok: true,
    html: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
  }),
}));

import { codeBlockRenderPreview, getDiagramCodeBlockLanguages } from '../diagramRenderers';

describe('getDiagramCodeBlockLanguages', () => {
  it('includes mermaid and plantuml for the WYSIWYG language picker', () => {
    const names = getDiagramCodeBlockLanguages().map((lang) => lang.name);
    expect(names).toContain('mermaid');
    expect(names).toContain('plantuml');
  });

  it('loads plantuml LanguageSupport for syntax highlighting', async () => {
    const plantuml = getDiagramCodeBlockLanguages().find((l) => l.name === 'plantuml');
    expect(plantuml).toBeDefined();
    const support = await plantuml!.load();
    expect(support?.language.name).toBe('plantuml');
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
