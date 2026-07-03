import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copySvgAsImageToClipboard,
  copySvgElementToClipboard,
  findDiagramSvg,
  getSvgDimensions,
  serializeSvgForCopy,
  stripPlantumlMetadataFromSvgTree,
  svgElementToPngBlob,
  writeBlobToClipboard,
} from '../diagramCopyImage';

function mountSvg(markup: string): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const svg = host.querySelector('svg');
  if (!svg) throw new Error('fixture missing <svg>');
  document.body.appendChild(host);
  return svg;
}

describe('getSvgDimensions', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses viewBox when width/height attributes are stripped (PlantUML output)', () => {
    const svg = mountSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 348 205"
        style="max-width:100%;height:auto" class="plantuml-output">
        <rect width="10" height="10"/>
      </svg>
    `);
    expect(getSvgDimensions(svg)).toEqual({ width: 348, height: 205 });
  });

  it('parses pixel width/height attributes', () => {
    const svg = mountSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="120px" height="80px">
        <rect width="10" height="10"/>
      </svg>
    `);
    expect(getSvgDimensions(svg)).toEqual({ width: 120, height: 80 });
  });
});

describe('serializeSvgForCopy', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('injects explicit width/height for rasterization', () => {
    const svg = mountSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 40">
        <circle cx="25" cy="20" r="10"/>
      </svg>
    `);
    const xml = serializeSvgForCopy(svg);
    expect(xml).toContain('width="50"');
    expect(xml).toContain('height="40"');
    expect(xml).toContain('viewBox="0 0 50 40"');
  });

  it('strips plantuml-src HTML comments produced by innerHTML injection', () => {
    const svg = mountSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 149 160" class="plantuml-output plantuml-svg">
        <g><text x="1" y="10">用户</text></g>
      </svg>
    `);
    const g = svg.querySelector('g');
    if (!g) throw new Error('missing g');
    g.appendChild(document.createComment('?plantuml-src AqWiAibCpYn8p2jHU3vbnREExLm5I4BFvlG-xLhuVFLw?'));

    const xml = serializeSvgForCopy(svg);
    expect(xml).not.toContain('plantuml-src');
    expect(xml).not.toMatch(/<!--\?plantuml/);
  });

  it('findDiagramSvg prefers plantuml-svg over smaller toolbar icons', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="diagram-preview" data-diagram-zoom-root>
        <div class="diagram-zoom-content">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 -960 960 960"><path d="M0"/></svg>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 149 160" class="plantuml-output plantuml-svg">
            <rect width="149" height="160"/>
          </svg>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    const root = host.querySelector('.diagram-preview') as HTMLElement;
    const picked = findDiagramSvg(root);
    expect(picked?.classList.contains('plantuml-svg')).toBe(true);
    host.remove();
  });

  it('strips processing instructions from JAR sequence fixture (tmp-seq.svg)', () => {
    const fixture = readFileSync(resolve(process.cwd(), 'tmp-seq.svg'), 'utf8');
    const host = document.createElement('div');
    host.innerHTML = fixture;
    const svg = host.querySelector('svg');
    expect(svg).not.toBeNull();
    stripPlantumlMetadataFromSvgTree(svg!);
    const xml = serializeSvgForCopy(svg!);
    expect(xml).not.toContain('plantuml-src');
    expect(xml).toMatch(/width="149"/);
    expect(xml).toMatch(/height="160"/);
  });
});

describe('writeBlobToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes Promise<Blob> to ClipboardItem (WebView2 requirement)', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    let received: unknown;
    vi.stubGlobal(
      'ClipboardItem',
      class {
        types: string[];
        constructor(items: Record<string, unknown>) {
          received = items['image/png'];
          this.types = Object.keys(items);
        }
      }
    );
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write } });

    await writeBlobToClipboard(blob, 'image/png');

    expect(received).toBeInstanceOf(Promise);
    await expect(received).resolves.toBe(blob);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('copySvgAsImageToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function mockRasterAndClipboard() {
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 348;
      height = 205;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal(
      'ClipboardItem',
      class {
        types: string[];
        constructor(items: Record<string, Blob | Promise<Blob>>) {
          this.types = Object.keys(items);
        }
      }
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      if (typeof callback === 'function') {
        callback(new Blob(['png'], { type: 'image/png' }));
      }
    });
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write } });
    return write;
  }

  it('copies PNG for viewBox-only PlantUML-like SVG', async () => {
    const write = mockRasterAndClipboard();
    const svg = mountSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 348 205" class="plantuml-output">
        <rect x="0" y="0" width="100" height="50" fill="red"/>
      </svg>
    `);

    await copySvgAsImageToClipboard(svg);

    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0][0] as ClipboardItem[];
    expect(items[0].types).toContain('image/png');
  });

  it('falls back to SVG clipboard when PNG write is rejected', async () => {
    mockRasterAndClipboard();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });

    const svg = mountSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <rect width="20" height="20"/>
      </svg>
    `);

    await copySvgAsImageToClipboard(svg);

    expect(write).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalled();
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('<svg');
    expect(text).toContain('width="20"');
  });
});

describe('svgElementToPngBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('returns a PNG blob', async () => {
    class MockImage {
      onload: (() => void) | null = null;
      width = 10;
      height = 10;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', MockImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      if (typeof callback === 'function') {
        callback(new Blob(['png'], { type: 'image/png' }));
      }
    });

    const svg = mountSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <rect width="10" height="10"/>
      </svg>
    `);

    const blob = await svgElementToPngBlob(svg);
    expect(blob.type).toBe('image/png');
  });
});

describe('copySvgElementToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('writes image/svg+xml when supported', async () => {
    vi.stubGlobal(
      'ClipboardItem',
      class {
        types: string[];
        constructor(items: Record<string, Blob | Promise<Blob>>) {
          this.types = Object.keys(items);
        }
      }
    );
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write } });

    const svg = mountSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>`);
    await copySvgElementToClipboard(svg);

    const items = write.mock.calls[0][0] as ClipboardItem[];
    expect(items[0].types).toContain('image/svg+xml');
  });
});
