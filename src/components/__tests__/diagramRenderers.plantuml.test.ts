import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../plantuml-offline/PlantUMLOfflineRenderer', () => ({
  renderPlantUMLOffline: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      requestPlantUmlAiFix: vi.fn(),
    })),
  },
}));

import { getDiagramRenderer } from '../diagramRenderers';
import { renderPlantUMLOffline } from '../plantuml-offline/PlantUMLOfflineRenderer';

describe('diagramRenderers plantuml', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    vi.mocked(renderPlantUMLOffline).mockReset();
  });

  it('success returns scoped SVG string', async () => {
    vi.mocked(renderPlantUMLOffline).mockResolvedValue({
      ok: true,
      html: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    });
    const renderer = getDiagramRenderer('plantuml')!;
    const result = await renderer('@startuml\na->b\n@enduml');
    expect(typeof result).toBe('string');
    expect(String(result)).toContain('<svg');
  });

  it('failure returns HTMLElement with error code view', async () => {
    vi.mocked(renderPlantUMLOffline).mockResolvedValue({
      ok: false,
      source: '@startuml\nbad\n@enduml',
      error: 'Syntax Error?',
      line: 2,
    });
    const renderer = getDiagramRenderer('plantuml')!;
    const result = await renderer('@startuml\nbad\n@enduml');
    expect(result).toBeInstanceOf(HTMLElement);
    expect((result as HTMLElement).querySelector('.puml-error-code-view')).toBeTruthy();
  });
});
