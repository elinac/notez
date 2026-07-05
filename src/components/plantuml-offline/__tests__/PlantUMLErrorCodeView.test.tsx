import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlantUMLErrorCodeView } from '../PlantUMLErrorCodeView';
import { useAppStore } from '../../../store/useAppStore';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(),
  },
}));

const SOURCE = `@startuml
participant Alice
participant Bob
Alice ->> Bob missing colon
Bob --> Alice : ok
@enduml`;

describe('PlantUMLErrorCodeView', () => {
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

  it('renders full source with line numbers and highlights error line', () => {
    render(
      <PlantUMLErrorCodeView
        source={SOURCE}
        errorMessage="Syntax Error? (Assumed diagram type: sequence)"
        errorLine={4}
      />
    );

    expect(screen.getByRole('region', { name: /PlantUML 源码，渲染出错/i })).toBeTruthy();
    expect(screen.getByText('Alice ->> Bob missing colon')).toBeTruthy();
    const errRow = screen.getByText('Alice ->> Bob missing colon').closest('.puml-error-code-view__line--err');
    expect(errRow).toBeTruthy();
    expect(errRow?.nextElementSibling?.classList.contains('puml-error-code-view__line')).toBe(true);
    expect(document.querySelector('.puml-error-code-view__bubble--callout')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/第 4 行/);
    expect(screen.getByRole('alert').textContent).toMatch(/Syntax Error/);
  });

  it('shows bubble at bottom without line badge when errorLine unknown', () => {
    render(
      <PlantUMLErrorCodeView source={SOURCE} errorMessage="unknown error" />
    );
    expect(screen.queryByText(/第 \d+ 行/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/unknown error/);
    expect(document.querySelector('.puml-error-code-view__bubble--bottom')).toBeTruthy();
    expect(document.querySelector('.puml-error-code-view__line--err')).toBeNull();
  });

  it('AI fix button calls requestPlantUmlAiFix', () => {
    const requestPlantUmlAiFix = vi.fn();
    vi.mocked(useAppStore.getState).mockReturnValue({
      requestPlantUmlAiFix,
    } as ReturnType<typeof useAppStore.getState>);

    render(
      <PlantUMLErrorCodeView
        source={SOURCE}
        errorMessage="Syntax Error?"
        errorLine={4}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /AI 修复/i }));
    expect(requestPlantUmlAiFix).toHaveBeenCalledWith({
      source: SOURCE,
      errorMessage: 'Syntax Error?',
      errorLine: 4,
    });
  });
});
