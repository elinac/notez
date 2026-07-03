/**
 * Copy bridge for Milkdown diagram code blocks (PlantUML / Mermaid).
 * Used by patches/@milkdown+components patch via window.__notezDiagramCopy.
 */

import { showToast } from '../utils/toast';
import { isDiagramCopyDebugEnabled, recordDiagramCopyDebug } from './diagramCopyDebug';
import { copySvgAsImageToClipboard, findDiagramSvg, getSvgDimensions } from './diagramCopyImage';

export type DiagramCopyMode = 'code' | 'image';

const MODE_STORAGE_KEY = 'notez-diagram-copy-mode';

function readStoredMode(): DiagramCopyMode {
  if (typeof sessionStorage === 'undefined') return 'code';
  const stored = sessionStorage.getItem(MODE_STORAGE_KEY);
  return stored === 'image' ? 'image' : 'code';
}

function writeStoredMode(mode: DiagramCopyMode): void {
  sessionStorage.setItem(MODE_STORAGE_KEY, mode);
}

export async function copyDiagramCode(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制代码');
    return true;
  } catch {
    showToast('复制失败', { kind: 'error' });
    return false;
  }
}

export async function copyDiagramImage(root: HTMLElement | null): Promise<boolean> {
  if (!root) {
    recordDiagramCopyDebug({ phase: 'resolve-root', ok: false, error: 'root is null' });
    showToast('复制失败：未找到图片', { kind: 'error' });
    return false;
  }

  const svg = findDiagramSvg(root);
  if (!svg) {
    const svgCount = root.querySelectorAll('svg').length;
    recordDiagramCopyDebug({
      phase: 'resolve-svg',
      ok: false,
      error: 'no diagram svg',
      detail: {
        rootClass: root.className,
        svgCount,
        hasZoomContent: Boolean(root.querySelector('[data-diagram-zoom-content]')),
      },
    });
    showToast('复制失败：未找到图片', { kind: 'error' });
    return false;
  }

  const dims = getSvgDimensions(svg);
  recordDiagramCopyDebug({
    phase: 'resolve-svg',
    ok: true,
    detail: {
      svgClass: svg.getAttribute('class'),
      viewBox: svg.getAttribute('viewBox'),
      ...dims,
    },
  });

  try {
    await copySvgAsImageToClipboard(svg);
    recordDiagramCopyDebug({ phase: 'clipboard', ok: true });
    showToast('已复制图片');
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    recordDiagramCopyDebug({
      phase: 'clipboard',
      ok: false,
      error: message,
      detail: { svgClass: svg.getAttribute('class'), ...dims },
    });
    if (isDiagramCopyDebugEnabled()) {
      console.error('[diagramCopy] 复制图片失败', e);
    }
    showToast(isDiagramCopyDebugEnabled() ? `复制失败：${message}` : '复制失败', {
      kind: 'error',
    });
    return false;
  }
}

/** Bridge for Milkdown patch (cannot import TS modules). */
export function installDiagramCopyGlobalBridge(): void {
  if (typeof window === 'undefined') return;

  window.__notezDiagramCopy = {
    getMode(): DiagramCopyMode {
      return readStoredMode();
    },
    setMode(mode: DiagramCopyMode): void {
      writeStoredMode(mode);
    },
    copyCode(text: string): Promise<boolean> {
      return copyDiagramCode(text);
    },
    copyImage(root: HTMLElement | null): Promise<boolean> {
      return copyDiagramImage(root);
    },
  };
}

const DIAGRAM_LANGS = new Set(['mermaid', 'plantuml', 'puml', 'mmd']);

function isWysiwygDiagramCodeBlock(block: Element): boolean {
  if (block.querySelector('[data-diagram-zoom-root], .diagram-preview')) return true;
  const lang = block.querySelector('.language-button')?.textContent?.trim().toLowerCase() ?? '';
  return DIAGRAM_LANGS.has(lang);
}

function getDiagramZoomRoot(block: Element): HTMLElement | null {
  return block.querySelector<HTMLElement>('[data-diagram-zoom-root], .diagram-preview');
}

function getCodeBlockSource(block: Element): string {
  return block.querySelector('.cm-content')?.textContent ?? '';
}

function modeLabel(mode: DiagramCopyMode): string {
  return mode === 'image' ? '复制图片' : '复制代码';
}

/** Matches Milkdown Crepe default copy icon (14×14). */
const COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 -960 960 960" aria-hidden="true"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-320v-480 480Z"/></svg>`;

function buildDiagramCopyGroup(
  block: Element,
  replaceBtn: HTMLElement,
  iconHtml: string
): HTMLElement {
  let mode = readStoredMode();
  const icon = iconHtml.trim() || COPY_ICON_SVG;
  const group = document.createElement('div');
  group.className = 'diagram-copy-group';

  const mainBtn = document.createElement('button');
  mainBtn.type = 'button';
  mainBtn.className = 'copy-button diagram-copy-main';

  const caretBtn = document.createElement('button');
  caretBtn.type = 'button';
  caretBtn.className = 'diagram-copy-caret';
  caretBtn.title = '选择复制方式';
  caretBtn.textContent = '▾';

  const menu = document.createElement('div');
  menu.className = 'diagram-copy-menu';
  menu.hidden = true;

  const codeItem = document.createElement('div');
  codeItem.className = 'diagram-copy-menu-item';
  codeItem.textContent = '复制代码';

  const imageItem = document.createElement('div');
  imageItem.className = 'diagram-copy-menu-item';
  imageItem.textContent = '复制图片';

  menu.append(codeItem, imageItem);
  group.append(mainBtn, caretBtn, menu);

  const syncUi = () => {
    mainBtn.title = modeLabel(mode);
    mainBtn.innerHTML = icon;
    mainBtn.setAttribute('aria-label', modeLabel(mode));
    codeItem.classList.toggle('is-active', mode === 'code');
    imageItem.classList.toggle('is-active', mode === 'image');
  };

  const runCopy = async (target: DiagramCopyMode) => {
    mode = target;
    writeStoredMode(mode);
    window.__notezDiagramCopy?.setMode(mode);
    syncUi();
    menu.hidden = true;
    const root = getDiagramZoomRoot(block);
    if (target === 'image') {
      await copyDiagramImage(root);
    } else {
      await copyDiagramCode(getCodeBlockSource(block));
    }
  };

  mainBtn.addEventListener('click', () => void runCopy(mode));
  caretBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  codeItem.addEventListener('click', () => void runCopy('code'));
  imageItem.addEventListener('click', () => void runCopy('image'));

  const onDocClick = (e: MouseEvent) => {
    if (menu.hidden) return;
    if (!group.contains(e.target as Node)) menu.hidden = true;
  };
  document.addEventListener('click', onDocClick);

  syncUi();
  replaceBtn.replaceWith(group);
  (group as HTMLElement & { __notezCopyCleanup?: () => void }).__notezCopyCleanup = () => {
    document.removeEventListener('click', onDocClick);
  };

  return group;
}

/** Replace plain Copy with diagram copy UI when Milkdown patch fallback still shows "Copy". */
export function ensureWysiwygDiagramCopyToolbars(root: HTMLElement): number {
  let injected = 0;
  for (const block of root.querySelectorAll('.milkdown-code-block')) {
    if (!isWysiwygDiagramCodeBlock(block)) continue;
    if (block.querySelector('.diagram-copy-group')) continue;

    const group = block.querySelector('.tools-button-group');
    const copyBtn = group?.querySelector<HTMLElement>('.copy-button:not(.diagram-copy-main)');
    if (!group || !copyBtn) continue;

    const icon = copyBtn.querySelector('svg, .milkdown-icon')?.outerHTML ?? '';
    buildDiagramCopyGroup(block, copyBtn, icon);
    injected++;
  }
  return injected;
}

/** Observe WYSIWYG DOM and upgrade diagram copy buttons when needed. */
export function startWysiwygDiagramCopyObserver(root: HTMLElement): () => void {
  const run = () => ensureWysiwygDiagramCopyToolbars(root);
  run();
  const observer = new MutationObserver(run);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

declare global {
  interface Window {
    __notezDiagramCopy?: {
      getMode: () => DiagramCopyMode;
      setMode: (mode: DiagramCopyMode) => void;
      copyCode: (text: string) => Promise<boolean>;
      copyImage: (root: HTMLElement | null) => Promise<boolean>;
    };
  }
}
