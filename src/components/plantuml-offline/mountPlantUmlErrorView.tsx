import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PlantUMLErrorCodeView } from './PlantUMLErrorCodeView';

export type PlantUmlErrorPayload = {
  source: string;
  error: string;
  line?: number;
};

/** WYSIWYG / imperative hosts: sync-render React error view into a detached container. */
export function createPlantUmlErrorHost(payload: PlantUmlErrorPayload): HTMLElement {
  const container = document.createElement('div');
  container.className = 'puml-error-code-view-wysiwyg-host';
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <PlantUMLErrorCodeView
        source={payload.source}
        errorMessage={payload.error}
        errorLine={payload.line}
      />
    );
  });
  (container as HTMLElement & { __notezPumlErrorRoot?: Root }).__notezPumlErrorRoot = root;
  return container;
}
