import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlantUmlErrorHost } from '../mountPlantUmlErrorView';
import { useAppStore } from '../../../store/useAppStore';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(),
  },
}));

describe('mountPlantUmlErrorView', () => {
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

    vi.mocked(useAppStore.getState).mockReturnValue({
      requestPlantUmlAiFix: vi.fn(),
    } as ReturnType<typeof useAppStore.getState>);
  });

  it('createPlantUmlErrorHost renders PlantUMLErrorCodeView', () => {
    const host = createPlantUmlErrorHost({
      source: '@startuml\na -> b\n@enduml',
      error: 'Syntax Error?',
      line: 2,
    });

    expect(host.className).toBe('puml-error-code-view-wysiwyg-host');
    expect(host.querySelector('.puml-error-code-view')).toBeTruthy();
    expect(host.querySelector('.puml-error-code-view__line--err')).toBeTruthy();
  });
});
