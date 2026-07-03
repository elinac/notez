/**
 * SVG → PNG rasterization and clipboard write helpers for diagram copy.
 */

const PROCESSING_INSTRUCTION_RE = /<\?[\s\S]*?\?>/g;
/** innerHTML 会把 <?plantuml-src?> 变成 <!--?plantuml-src ...?--> */
const PLANTUML_META_COMMENT_RE = /<!--\?plantuml[\s\S]*?\?-->/gi;

export function parseSvgLength(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value.replace(/[a-z%]+$/i, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Resolve raster size from viewBox, attributes, layout, or bbox. */
export function getSvgDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { width: vb.width, height: vb.height };
  }

  const attrW = parseSvgLength(svg.getAttribute('width'));
  const attrH = parseSvgLength(svg.getAttribute('height'));
  if (attrW && attrH) {
    return { width: attrW, height: attrH };
  }

  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }

  if (typeof svg.getBBox === 'function') {
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        return { width: box.width, height: box.height };
      }
    } catch {
      /* SVG may not be laid out */
    }
  }

  return { width: 800, height: 600 };
}

/** Remove PlantUML metadata nodes that break SVG→Image rasterization after innerHTML round-trip. */
export function stripPlantumlMetadataFromSvgTree(root: ParentNode): void {
  const nodes = [...root.childNodes];
  for (const child of nodes) {
    if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
      child.parentNode?.removeChild(child);
      continue;
    }
    if (child.nodeType === Node.COMMENT_NODE) {
      const data = (child as Comment).data.trim();
      if (/^\?plantuml/i.test(data)) {
        child.parentNode?.removeChild(child);
        continue;
      }
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      stripPlantumlMetadataFromSvgTree(child as Element);
    }
  }
}

/** Pick the diagram SVG inside a zoom/preview root (not toolbar icons). */
export function findDiagramSvg(root: HTMLElement): SVGSVGElement | null {
  const plantuml = root.querySelector<SVGSVGElement>('svg.plantuml-svg, svg.plantuml-output');
  if (plantuml) return plantuml;

  const mermaid = root.querySelector<SVGSVGElement>('.mermaid svg');
  if (mermaid) return mermaid;

  const all = [...root.querySelectorAll<SVGSVGElement>('svg')];
  if (all.length === 0) return null;
  if (all.length === 1) return all[0]!;

  let best: SVGSVGElement | null = null;
  let bestArea = 0;
  for (const svg of all) {
    const { width, height } = getSvgDimensions(svg);
    const area = width * height;
    if (area > bestArea) {
      bestArea = area;
      best = svg;
    }
  }
  return best;
}

export function serializeSvgForCopy(svg: SVGSVGElement): string {
  const { width, height } = getSvgDimensions(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;

  stripPlantumlMetadataFromSvgTree(clone);

  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }

  clone.setAttribute('width', String(Math.ceil(width)));
  clone.setAttribute('height', String(Math.ceil(height)));
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  let serialized = new XMLSerializer().serializeToString(clone);
  serialized = serialized
    .replace(PROCESSING_INSTRUCTION_RE, '')
    .replace(PLANTUML_META_COMMENT_RE, '')
    .trim();
  return serialized;
}

function loadSvgImage(serialized: string): Promise<HTMLImageElement> {
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG load failed'));
    img.src = dataUrl;
  });
}

export async function svgElementToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const serialized = serializeSvgForCopy(svg);
  const { width, height } = getSvgDimensions(svg);
  const img = await loadSvgImage(serialized);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  ctx.scale(dpr, dpr);
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) throw new Error('PNG encode failed');
  return blob;
}

/** WebView2 / Chromium expect ClipboardItem values as Promise<Blob>. */
export async function writeBlobToClipboard(blob: Blob, mimeType: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard API unavailable');
  }

  const item = new ClipboardItem({
    [mimeType]: Promise.resolve(blob),
  });
  await navigator.clipboard.write([item]);
}

export async function copySvgElementToClipboard(svg: SVGSVGElement): Promise<void> {
  const serialized = serializeSvgForCopy(svg);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });

  try {
    await writeBlobToClipboard(svgBlob, 'image/svg+xml');
    return;
  } catch {
    /* Some hosts only accept text/plain for SVG payload */
  }

  await navigator.clipboard.writeText(serialized);
}

export async function copySvgAsImageToClipboard(svg: SVGSVGElement): Promise<void> {
  const pngBlob = await svgElementToPngBlob(svg);
  try {
    await writeBlobToClipboard(pngBlob, 'image/png');
    return;
  } catch {
    await copySvgElementToClipboard(svg);
  }
}
