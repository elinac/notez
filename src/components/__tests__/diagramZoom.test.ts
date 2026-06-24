import { describe, expect, it, beforeEach } from 'vitest';
import {
  DIAGRAM_ZOOM_MAX,
  DIAGRAM_ZOOM_MIN,
  ensureWysiwygDiagramZoomToolbars,
  formatScaleLabel,
  initDiagramZoom,
  wrapDiagramZoomContent,
} from '../diagramZoom';

describe('formatScaleLabel', () => {
  it('formats scale as percentage', () => {
    expect(formatScaleLabel(1)).toBe('100%');
    expect(formatScaleLabel(1.25)).toBe('125%');
    expect(formatScaleLabel(0.25)).toBe('25%');
  });
});

describe('initDiagramZoom', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.dataset.diagramZoomRoot = '';
    const content = document.createElement('div');
    content.textContent = 'diagram';
    root.appendChild(wrapDiagramZoomContent(content));
    document.body.appendChild(root);
  });

  it('starts at 100%', () => {
    const ctrl = initDiagramZoom(root);
    expect(ctrl.getScale()).toBe(1);
    expect(ctrl.formatLabel()).toBe('100%');
  });

  it('zoomIn increases by 25% steps', () => {
    const ctrl = initDiagramZoom(root);
    ctrl.zoomIn();
    expect(ctrl.getScale()).toBe(1.25);
    expect(ctrl.formatLabel()).toBe('125%');
    ctrl.zoomIn();
    expect(ctrl.getScale()).toBe(1.5);
  });

  it('zoomOut decreases by 25% steps', () => {
    const ctrl = initDiagramZoom(root);
    ctrl.zoomOut();
    expect(ctrl.getScale()).toBe(0.75);
  });

  it('clamps at MIN and MAX', () => {
    const ctrl = initDiagramZoom(root);
    for (let i = 0; i < 20; i++) ctrl.zoomOut();
    expect(ctrl.getScale()).toBe(DIAGRAM_ZOOM_MIN);

    ctrl.reset();
    for (let i = 0; i < 20; i++) ctrl.zoomIn();
    expect(ctrl.getScale()).toBe(DIAGRAM_ZOOM_MAX);
  });

  it('reset returns to 100%', () => {
    const ctrl = initDiagramZoom(root);
    ctrl.zoomIn();
    ctrl.zoomIn();
    ctrl.reset();
    expect(ctrl.getScale()).toBe(1);
    expect(ctrl.formatLabel()).toBe('100%');
  });
});

describe('ensureWysiwygDiagramZoomToolbars', () => {
  it('injects zoom buttons before copy in milkdown code block toolbar', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="milkdown-code-block">
        <div class="tools">
          <button class="language-button">mermaid</button>
          <div class="tools-button-group">
            <button type="button" class="copy-button">Copy</button>
            <button type="button" class="preview-toggle-button">Edit</button>
          </div>
        </div>
        <div class="preview">
          <div class="diagram-preview diagram-mermaid" data-diagram-zoom-root>
            <div class="diagram-zoom-viewport">
              <div class="diagram-zoom-content" data-diagram-zoom-content>
                <svg></svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    const injected = ensureWysiwygDiagramZoomToolbars(host);
    expect(injected).toBe(1);

    const group = host.querySelector('.tools-button-group')!;
    const childClasses = [...group.children].map((el) => el.className);
    expect(childClasses[0]).toContain('diagram-zoom-out');
    expect(childClasses.some((c) => c.includes('copy-button'))).toBe(true);

    host.remove();
  });
});
