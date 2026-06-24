/**
 * 内联 SVG 插入 HTML 后，`fill="url(#id)"` 等会按「整份 HTML 文档」解析片段标识符，
 * 可能命中其它 <svg> 或错误节点，导致渐变/裁剪失效（方框无填充）。
 * 在每次写入 innerHTML 前为当前 SVG 内所有 id 与引用加上唯一前缀。
 *
 * @see https://www.w3.org/TR/SVG2/linking.html#processingURL-absolute
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeDocumentScopePrefix(): string {
  const part =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `pu${part}_`;
}

/**
 * 对单块 PlantUML/Graphviz 输出的 SVG 字符串做 id 隔离；非 SVG 片段原样返回。
 */
export function scopeSvgIdsForHtmlDocument(markup: string): string {
  const raw = markup.trim();
  if (!raw.includes('<svg') || typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return markup;
  }

  let svgSlice = raw;
  const lower = raw.toLowerCase();
  const idx = lower.indexOf('<svg');
  if (idx > 0) {
    svgSlice = raw.slice(idx);
  }

  try {
    const doc = new DOMParser().parseFromString(svgSlice, 'image/svg+xml');
    if (doc.querySelector('parsererror')) {
      return markup;
    }

    const root = doc.documentElement;
    if (!root || root.localName.toLowerCase() !== 'svg') {
      return markup;
    }

    const prefix = makeDocumentScopePrefix();
    const withId = root.querySelectorAll('[id]');
    const idMap = new Map<string, string>();

    withId.forEach((el) => {
      const old = el.getAttribute('id');
      if (!old) return;
      if (!idMap.has(old)) {
        idMap.set(old, `${prefix}${old}`);
      }
    });

    withId.forEach((el) => {
      const old = el.getAttribute('id');
      if (!old) return;
      const neu = idMap.get(old);
      if (neu) el.setAttribute('id', neu);
    });

    let out = new XMLSerializer().serializeToString(root);

    const pairs = [...idMap.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [oldId, newId] of pairs) {
      const e = escapeRegExp(oldId);
      out = out.replace(new RegExp(`url\\(\\s*#${e}\\s*\\)`, 'g'), `url(#${newId})`);
      out = out.replace(new RegExp(`href="#${e}"`, 'g'), `href="#${newId}"`);
      out = out.replace(new RegExp(`xlink:href="#${e}"`, 'g'), `xlink:href="#${newId}"`);
    }

    return idx > 0 ? raw.slice(0, idx) + out : out;
  } catch {
    return markup;
  }
}
