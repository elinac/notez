import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PlantUMLErrorCodeView } from './PlantUMLErrorCodeView';

export function renderPlantUmlErrorToElement(result: {
  source: string;
  error: string;
  line?: number;
}): HTMLElement {
  const container = document.createElement('div');
  container.className = 'puml-error-code-view-wysiwyg-host';
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <PlantUMLErrorCodeView
        source={result.source}
        errorMessage={result.error}
        errorLine={result.line}
      />
    );
  });
  return container;
}
