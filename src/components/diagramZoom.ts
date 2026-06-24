/**
 * Shared zoom controls for Mermaid / PlantUML diagram previews.
 * Used in WYSIWYG (Milkdown) and split-pane markdown preview.
 */

export const DIAGRAM_ZOOM_STEP = 0.25;
export const DIAGRAM_ZOOM_MIN = 0.25;
export const DIAGRAM_ZOOM_MAX = 3.0;
export const DIAGRAM_ZOOM_DEFAULT = 1.0;

export interface DiagramZoomController {
  getScale(): number;
  setScale(scale: number): void;
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  formatLabel(): string;
}

const controllers = new WeakMap<HTMLElement, DiagramZoomController>();

type ZoomRoot = HTMLElement & { __diagramZoom?: DiagramZoomController };

export function formatScaleLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function clampScale(scale: number): number {
  return Math.min(DIAGRAM_ZOOM_MAX, Math.max(DIAGRAM_ZOOM_MIN, scale));
}

function supportsCssZoom(): boolean {
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('zoom', '1');
  }
  return true;
}

const useCssZoom = supportsCssZoom();

function applyScale(content: HTMLElement, viewport: HTMLElement, scale: number): void {
  if (useCssZoom) {
    content.style.zoom = scale === 1 ? '' : String(scale);
    content.style.transform = '';
    content.style.transformOrigin = '';
    viewport.style.minHeight = '';
    return;
  }

  content.style.zoom = '';
  content.style.transform = scale === 1 ? '' : `scale(${scale})`;
  content.style.transformOrigin = 'top center';
  if (scale === 1) {
    viewport.style.minHeight = '';
  } else {
    viewport.style.minHeight = `${content.offsetHeight * scale}px`;
  }
}

function ensureZoomStructure(root: HTMLElement): {
  viewport: HTMLElement;
  content: HTMLElement;
} {
  let viewport = root.querySelector<HTMLElement>(':scope > .diagram-zoom-viewport');
  let content = root.querySelector<HTMLElement>('[data-diagram-zoom-content]');

  if (viewport && content) {
    return { viewport, content };
  }

  viewport = document.createElement('div');
  viewport.className = 'diagram-zoom-viewport';
  content = document.createElement('div');
  content.className = 'diagram-zoom-content';
  content.dataset.diagramZoomContent = '';

  const movable: Node[] = [];
  for (const child of [...root.childNodes]) {
    if (
      child instanceof HTMLElement &&
      (child.classList.contains('diagram-tools') || child.classList.contains('diagram-zoom-viewport'))
    ) {
      continue;
    }
    movable.push(child);
  }
  for (const node of movable) {
    content.appendChild(node);
  }

  viewport.appendChild(content);
  root.appendChild(viewport);
  return { viewport, content };
}

function createController(
  root: HTMLElement,
  content: HTMLElement,
  viewport: HTMLElement,
  onScaleChange?: (scale: number) => void
): DiagramZoomController {
  let scale = DIAGRAM_ZOOM_DEFAULT;

  const controller: DiagramZoomController = {
    getScale: () => scale,
    setScale(next) {
      scale = clampScale(next);
      applyScale(content, viewport, scale);
      onScaleChange?.(scale);
    },
    zoomIn() {
      controller.setScale(scale + DIAGRAM_ZOOM_STEP);
    },
    zoomOut() {
      controller.setScale(scale - DIAGRAM_ZOOM_STEP);
    },
    reset() {
      controller.setScale(DIAGRAM_ZOOM_DEFAULT);
    },
    formatLabel: () => formatScaleLabel(scale),
  };

  controllers.set(root, controller);
  (root as ZoomRoot).__diagramZoom = controller;
  root.dataset.diagramZoomRoot = '';
  controller.setScale(DIAGRAM_ZOOM_DEFAULT);
  return controller;
}

export function getDiagramZoomController(root: HTMLElement): DiagramZoomController | undefined {
  return controllers.get(root) ?? (root as ZoomRoot).__diagramZoom;
}

/** Wrap arbitrary diagram content in viewport/content shells. */
export function wrapDiagramZoomContent(content: HTMLElement): HTMLElement {
  const viewport = document.createElement('div');
  viewport.className = 'diagram-zoom-viewport';
  const inner = document.createElement('div');
  inner.className = 'diagram-zoom-content';
  inner.dataset.diagramZoomContent = '';
  inner.appendChild(content);
  viewport.appendChild(inner);
  return viewport;
}

/** Initialize zoom on a root element (creates viewport/content if needed). */
export function initDiagramZoom(
  root: HTMLElement,
  onScaleChange?: (scale: number) => void
): DiagramZoomController {
  const { viewport, content } = ensureZoomStructure(root);
  return createController(root, content, viewport, onScaleChange);
}

export function bindDiagramZoomToolbar(
  toolbar: Element,
  getController: () => DiagramZoomController | null
): void {
  if (toolbar instanceof HTMLElement && toolbar.dataset.diagramZoomBound === '1') {
    return;
  }
  const label = toolbar.querySelector('.diagram-zoom-label');
  const updateLabel = () => {
    const ctrl = getController();
    if (label && ctrl) {
      label.textContent = ctrl.formatLabel();
    }
  };

  toolbar.querySelector('.diagram-zoom-out')?.addEventListener('click', () => {
    getController()?.zoomOut();
    updateLabel();
  });
  toolbar.querySelector('.diagram-zoom-in')?.addEventListener('click', () => {
    getController()?.zoomIn();
    updateLabel();
  });
  toolbar.querySelector('.diagram-zoom-reset')?.addEventListener('click', () => {
    getController()?.reset();
    updateLabel();
  });
  if (toolbar instanceof HTMLElement) {
    toolbar.dataset.diagramZoomBound = '1';
  }
}

export function createDiagramZoomToolbar(
  getController: () => DiagramZoomController | null
): HTMLElement {
  const tools = document.createElement('div');
  tools.className = 'diagram-tools';

  const spacer = document.createElement('div');
  spacer.className = 'diagram-tools-spacer';
  tools.appendChild(spacer);

  const group = document.createElement('div');
  group.className = 'diagram-tools-button-group';

  const outBtn = document.createElement('button');
  outBtn.type = 'button';
  outBtn.className = 'diagram-zoom-out';
  outBtn.textContent = '−';
  outBtn.title = '缩小';

  const label = document.createElement('span');
  label.className = 'diagram-zoom-label';
  label.textContent = formatScaleLabel(DIAGRAM_ZOOM_DEFAULT);

  const inBtn = document.createElement('button');
  inBtn.type = 'button';
  inBtn.className = 'diagram-zoom-in';
  inBtn.textContent = '+';
  inBtn.title = '放大';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'diagram-zoom-reset';
  resetBtn.textContent = '重置';
  resetBtn.title = '重置缩放';

  group.append(outBtn, label, inBtn, resetBtn);
  tools.appendChild(group);
  bindDiagramZoomToolbar(group, getController);
  return tools;
}

/** HTML shell for split-pane diagram blocks (toolbar is static; bind after SVG load). */
export function diagramBlockShellHtml(
  type: 'plantuml' | 'mermaid',
  containerClass: string,
  dataAttr: string,
  dataValue: string,
  loadingHtml: string
): string {
  return `<div class="diagram-block diagram-color-fix my-4 border rounded overflow-hidden" data-diagram-type="${type}" data-diagram-zoom-root>
  <div class="diagram-tools">
    <div class="diagram-tools-spacer"></div>
    <div class="diagram-tools-button-group">
      <button type="button" class="diagram-zoom-out" title="缩小">−</button>
      <span class="diagram-zoom-label">100%</span>
      <button type="button" class="diagram-zoom-in" title="放大">+</button>
      <button type="button" class="diagram-zoom-reset" title="重置缩放">重置</button>
    </div>
  </div>
  <div class="diagram-zoom-viewport">
    <div class="diagram-zoom-content" data-diagram-zoom-content>
      <div class="${containerClass} p-4 bg-gray-50" ${dataAttr}="${dataValue}">${loadingHtml}</div>
    </div>
  </div>
</div>`;
}

/** Initialize zoom + bind toolbar for a split-pane diagram block. */
export function initDiagramBlockZoom(block: HTMLElement): DiagramZoomController {
  const toolbar = block.querySelector('.diagram-tools-button-group');
  const controller = initDiagramZoom(block, (scale) => {
    const label = toolbar?.querySelector('.diagram-zoom-label');
    if (label) {
      label.textContent = formatScaleLabel(scale);
    }
  });
  if (toolbar) {
    bindDiagramZoomToolbar(toolbar, () => controller);
  }
  return controller;
}

const DIAGRAM_LANGS = new Set(['mermaid', 'plantuml', 'puml', 'mmd']);

function isWysiwygDiagramCodeBlock(block: Element): boolean {
  if (block.querySelector('[data-diagram-zoom-root], .diagram-preview')) return true;
  const lang = block.querySelector('.language-button')?.textContent?.trim().toLowerCase() ?? '';
  return DIAGRAM_LANGS.has(lang);
}

/** Insert zoom controls into Milkdown toolbar before Copy (fallback if Vue patch hides them). */
export function ensureWysiwygDiagramZoomToolbars(root: HTMLElement): number {
  let injected = 0;
  for (const block of root.querySelectorAll('.milkdown-code-block')) {
    if (!isWysiwygDiagramCodeBlock(block)) continue;

    const group = block.querySelector('.tools-button-group');
    const zoomRoot = block.querySelector<HTMLElement>('[data-diagram-zoom-root], .diagram-preview');
    if (!group || !zoomRoot) continue;
    if (group.querySelector('.diagram-zoom-out')) continue;

    const controller = getDiagramZoomController(zoomRoot) ?? initDiagramZoom(zoomRoot);

    const outBtn = document.createElement('button');
    outBtn.type = 'button';
    outBtn.className = 'diagram-zoom-out';
    outBtn.textContent = '−';
    outBtn.title = '缩小';

    const label = document.createElement('span');
    label.className = 'diagram-zoom-label';
    label.textContent = controller.formatLabel();

    const inBtn = document.createElement('button');
    inBtn.type = 'button';
    inBtn.className = 'diagram-zoom-in';
    inBtn.textContent = '+';
    inBtn.title = '放大';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'diagram-zoom-reset';
    resetBtn.textContent = '重置';
    resetBtn.title = '重置缩放';

    const copyBtn = group.querySelector('.copy-button');
    for (const node of [outBtn, label, inBtn, resetBtn]) {
      group.insertBefore(node, copyBtn);
    }

    bindDiagramZoomToolbar(group, () => controller);
    injected++;
  }

  return injected;
}

/** Observe WYSIWYG DOM and inject zoom toolbars when diagram previews appear. */
export function startWysiwygDiagramZoomObserver(root: HTMLElement): () => void {
  const run = () => ensureWysiwygDiagramZoomToolbars(root);
  run();
  const observer = new MutationObserver(run);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Bridge for Milkdown patch (cannot import TS modules). */
export function installDiagramZoomGlobalBridge(): void {
  if (typeof window === 'undefined') return;
  window.__notezDiagramZoom = {
    STEP: DIAGRAM_ZOOM_STEP,
    MIN: DIAGRAM_ZOOM_MIN,
    MAX: DIAGRAM_ZOOM_MAX,
    formatScaleLabel,
    findRootFromCodeBlock(codeBlock: Element | null): HTMLElement | null {
      if (!codeBlock) return null;
      return codeBlock.querySelector('[data-diagram-zoom-root]');
    },
    getController(root: HTMLElement | null): DiagramZoomController | null {
      if (!root) return null;
      return getDiagramZoomController(root) ?? null;
    },
    zoomIn(root: HTMLElement | null) {
      getDiagramZoomController(root!)?.zoomIn();
    },
    zoomOut(root: HTMLElement | null) {
      getDiagramZoomController(root!)?.zoomOut();
    },
    reset(root: HTMLElement | null) {
      getDiagramZoomController(root!)?.reset();
    },
    getLabel(root: HTMLElement | null): string {
      const ctrl = root ? getDiagramZoomController(root) : null;
      return ctrl ? ctrl.formatLabel() : formatScaleLabel(DIAGRAM_ZOOM_DEFAULT);
    },
  };
}

declare global {
  interface Window {
    __notezDiagramZoom?: {
      STEP: number;
      MIN: number;
      MAX: number;
      formatScaleLabel: (scale: number) => string;
      findRootFromCodeBlock: (codeBlock: Element | null) => HTMLElement | null;
      getController: (root: HTMLElement | null) => DiagramZoomController | null;
      zoomIn: (root: HTMLElement | null) => void;
      zoomOut: (root: HTMLElement | null) => void;
      reset: (root: HTMLElement | null) => void;
      getLabel: (root: HTMLElement | null) => string;
    };
  }
}
