import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as diagramCopyImage from '../diagramCopyImage';
import {
  copyDiagramCode,
  copyDiagramImage,
  decodeHtmlEntities,
  ensureSplitPaneDiagramCopyToolbars,
  ensureWysiwygDiagramCopyToolbars,
  getSplitPaneDiagramSource,
  installDiagramCopyGlobalBridge,
  type DiagramCopyMode,
} from '../diagramCopy';

describe('diagramCopy', () => {
  beforeEach(() => {
    sessionStorage.clear();
    installDiagramCopyGlobalBridge();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.notez-toast').forEach((el) => el.remove());
  });

  describe('installDiagramCopyGlobalBridge', () => {
    it('persists copy mode in sessionStorage', () => {
      expect(window.__notezDiagramCopy?.getMode()).toBe('code');
      window.__notezDiagramCopy?.setMode('image');
      expect(window.__notezDiagramCopy?.getMode()).toBe('image');
      expect(sessionStorage.getItem('notez-diagram-copy-mode')).toBe('image');
    });
  });

  describe('copyDiagramCode', () => {
    it('writes text to clipboard and shows success toast', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      const ok = await copyDiagramCode('@startuml\n@enduml');

      expect(ok).toBe(true);
      expect(writeText).toHaveBeenCalledWith('@startuml\n@enduml');
      expect(document.querySelector('.notez-toast')?.textContent).toBe('已复制代码');
    });

    it('shows error toast when clipboard fails', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      });

      const ok = await copyDiagramCode('code');

      expect(ok).toBe(false);
      expect(document.querySelector('.notez-toast--error')?.textContent).toBe('复制失败');
    });
  });

  describe('copyDiagramImage', () => {
    it('shows error when root has no svg', async () => {
      const root = document.createElement('div');
      const ok = await copyDiagramImage(root);

      expect(ok).toBe(false);
      expect(document.querySelector('.notez-toast--error')?.textContent).toBe(
        '复制失败：未找到图片'
      );
    });

    it('copies png to clipboard when svg is present', async () => {
      const copySpy = vi.spyOn(diagramCopyImage, 'copySvgAsImageToClipboard').mockResolvedValue();

      const root = document.createElement('div');
      root.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
          <rect width="10" height="10" fill="red"/>
        </svg>
      `;

      const ok = await copyDiagramImage(root);

      expect(ok).toBe(true);
      expect(copySpy).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.notez-toast')?.textContent).toBe('已复制图片');
    });

    it('shows error toast when raster/clipboard pipeline fails', async () => {
      vi.spyOn(diagramCopyImage, 'copySvgAsImageToClipboard').mockRejectedValue(
        new Error('pipeline failed')
      );

      const root = document.createElement('div');
      root.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`;

      const ok = await copyDiagramImage(root);

      expect(ok).toBe(false);
      expect(document.querySelector('.notez-toast--error')?.textContent).toBe(
        '复制失败：pipeline failed'
      );
    });
  });
});

describe('ensureWysiwygDiagramCopyToolbars', () => {
  it('replaces plain Copy button on diagram code blocks', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="milkdown-code-block">
        <div class="tools">
          <button class="language-button">plantuml</button>
          <div class="tools-button-group">
            <button type="button" class="copy-button">Copy</button>
          </div>
        </div>
        <div class="diagram-preview" data-diagram-zoom-root>
          <svg></svg>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    const injected = ensureWysiwygDiagramCopyToolbars(host);
    expect(injected).toBe(1);
    expect(host.querySelector('.diagram-copy-group')).not.toBeNull();
    expect(host.querySelector('.diagram-copy-main')?.getAttribute('aria-label')).toBe('复制代码');
    expect(host.querySelector('.diagram-copy-main')?.querySelector('svg')).not.toBeNull();
    expect(host.querySelector('.diagram-copy-main')?.textContent?.trim()).toBe('');
    expect(host.querySelector('.copy-button:not(.diagram-copy-main)')).toBeNull();

    host.remove();
  });
});

describe('ensureSplitPaneDiagramCopyToolbars', () => {
  it('prepends copy group to split-pane diagram blocks', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="diagram-block" data-diagram-type="plantuml" data-diagram-source="@startuml&amp;na-&gt;b@enduml" data-diagram-zoom-root>
        <div class="diagram-tools">
          <div class="diagram-tools-button-group">
            <button type="button" class="diagram-zoom-out">−</button>
          </div>
        </div>
        <div class="diagram-zoom-viewport">
          <div class="plantuml-container"></div>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    const injected = ensureSplitPaneDiagramCopyToolbars(host);
    expect(injected).toBe(1);
    const group = host.querySelector('.diagram-tools-button-group');
    expect(group?.firstElementChild?.classList.contains('diagram-copy-group')).toBe(true);

    host.remove();
  });

  it('reads source from data-diagram-source after container cleared', () => {
    const block = document.createElement('div');
    block.className = 'diagram-block';
    block.dataset.diagramType = 'plantuml';
    block.dataset.diagramSource = '@startuml&amp;Alice-&gt;&gt;Bob@enduml';
    block.innerHTML = '<div class="plantuml-container"></div>';

    expect(getSplitPaneDiagramSource(block)).toBe('@startuml&Alice->>Bob@enduml');
    expect(decodeHtmlEntities('@startuml&amp;test')).toBe('@startuml&test');
  });
});

describe('DiagramCopyMode storage', () => {
  it('defaults invalid stored values to code', () => {
    sessionStorage.setItem('notez-diagram-copy-mode', 'invalid' as DiagramCopyMode);
    installDiagramCopyGlobalBridge();
    expect(window.__notezDiagramCopy?.getMode()).toBe('code');
  });
});
