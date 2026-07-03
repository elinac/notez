/**
 * 复现 WYSIWYG 图块「复制图片」管线（JAR PlantUML SVG）。
 * 用法: node scripts/debug-diagram-copy.mjs [seq|comp]
 * 输出: debug-copy-<kind>-*.svg / debug-copy-<kind>-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const kind = process.argv[2] === 'comp' ? 'comp' : 'seq';
const jarFile = path.resolve(kind === 'comp' ? 'tmp-comp.svg' : 'tmp-seq.svg');
const outDir = process.cwd();

const SVG_HOST_STYLE =
  'max-width:100%;height:auto;color:#1c1c1c;color-scheme:light;forced-color-adjust:none;-webkit-print-color-adjust:exact;print-color-adjust:exact';

function styleSvgMarkup(svg, backend = 'jar') {
  const cls =
    backend === 'rust'
      ? 'plantuml-output plantuml-svg plantuml-rust'
      : 'plantuml-output plantuml-svg plantuml-jar';
  const svgOnly = svg
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  const win = new JSDOM().window;
  const doc = new win.DOMParser().parseFromString(svgOnly, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('DOMParser parsererror');
  }
  const root = doc.documentElement;
  root.removeAttribute('width');
  root.removeAttribute('height');
  const prevStyle = (root.getAttribute('style') || '').trim();
  root.setAttribute(
    'style',
    prevStyle ? `${prevStyle.replace(/;?\s*$/, '')};${SVG_HOST_STYLE}` : SVG_HOST_STYLE
  );
  const prevClass = root.getAttribute('class') || '';
  root.setAttribute('class', prevClass ? `${prevClass} ${cls}` : cls);
  stripPlantumlMetadataNodes(root);
  return new win.XMLSerializer().serializeToString(root);
}

function stripPlantumlMetadataNodes(root) {
  const nodes = [...root.childNodes];
  for (const child of nodes) {
    if (child.nodeType === 7) {
      child.parentNode?.removeChild(child);
      continue;
    }
    if (child.nodeType === 8) {
      const data = (child.data || '').trim();
      if (/^\?plantuml/i.test(data)) {
        child.parentNode?.removeChild(child);
        continue;
      }
    }
    if (child.nodeType === 1) stripPlantumlMetadataNodes(child);
  }
}

function wrapDiagramZoomContent(win, contentEl) {
  const viewport = win.document.createElement('div');
  viewport.className = 'diagram-zoom-viewport';
  const inner = win.document.createElement('div');
  inner.className = 'diagram-zoom-content';
  inner.dataset.diagramZoomContent = '';
  inner.appendChild(contentEl);
  viewport.appendChild(inner);
  return viewport;
}

function buildPreviewDom(styledSvg) {
  const win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  const wrapper = win.document.createElement('div');
  wrapper.className = 'diagram-preview diagram-plantuml diagram-color-fix p-2';
  wrapper.dataset.diagramZoomRoot = '';

  const content = win.document.createElement('div');
  content.innerHTML = styledSvg;
  wrapper.appendChild(wrapDiagramZoomContent(win, content));
  win.document.body.appendChild(wrapper);
  return { win, wrapper };
}

function parseSvgLength(value) {
  if (!value) return null;
  const n = Number.parseFloat(String(value).replace(/[a-z%]+$/i, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getSvgDimensions(svg) {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { width: vb.width, height: vb.height };
  }
  const attrW = parseSvgLength(svg.getAttribute('width'));
  const attrH = parseSvgLength(svg.getAttribute('height'));
  if (attrW && attrH) return { width: attrW, height: attrH };
  return { width: 800, height: 600 };
}

const PI_RE = /<\?[\s\S]*?\?>/g;
const PLANTUML_META_COMMENT_RE = /<!--\?plantuml[\s\S]*?\?-->/gi;

function serializeSvgForCopy(svg, win) {
  const { width, height } = getSvgDimensions(svg);
  const clone = svg.cloneNode(true);
  stripPlantumlMetadataNodes(clone);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.ceil(width)));
  clone.setAttribute('height', String(Math.ceil(height)));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  let serialized = new win.XMLSerializer().serializeToString(clone);
  serialized = serialized.replace(PI_RE, '').replace(PLANTUML_META_COMMENT_RE, '').trim();
  return { serialized, width, height };
}

function listSvgs(root) {
  return [...root.querySelectorAll('svg')].map((svg, i) => ({
    index: i,
    className: svg.getAttribute('class'),
    viewBox: svg.getAttribute('viewBox'),
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
    outerLen: svg.outerHTML.length,
  }));
}

function walkComments(svg) {
  const comments = [];
  function walk(el) {
    for (const c of el.childNodes) {
      if (c.nodeType === 8) comments.push(c.data.slice(0, 80));
      if (c.nodeType === 1) walk(c);
    }
  }
  walk(svg);
  return comments;
}

async function main() {
  if (!fs.existsSync(jarFile)) {
    console.error('缺少 JAR SVG 样本:', jarFile);
    process.exit(1);
  }

  const rawJar = fs.readFileSync(jarFile, 'utf8');
  const styled = styleSvgMarkup(rawJar, 'jar');
  const { win, wrapper } = buildPreviewDom(styled);

  const report = {
    kind,
    jarFile,
    rawLen: rawJar.length,
    styledLen: styled.length,
    allSvgsInRoot: listSvgs(wrapper),
    firstQuerySelectorSvg: null,
    plantumlSvgQuery: null,
    commentsInFirstSvg: [],
    serialize: {},
    dataUrl: {},
    imageLoad: null,
    errors: [],
  };

  const svgFirst = wrapper.querySelector('svg');
  const svgPlantuml = wrapper.querySelector('svg.plantuml-svg, svg.plantuml-output');

  report.firstQuerySelectorSvg = svgFirst
    ? {
        className: svgFirst.getAttribute('class'),
        viewBox: svgFirst.getAttribute('viewBox'),
      }
    : null;
  report.plantumlSvgQuery = svgPlantuml
    ? {
        className: svgPlantuml.getAttribute('class'),
        viewBox: svgPlantuml.getAttribute('viewBox'),
        sameAsFirst: svgPlantuml === svgFirst,
      }
    : null;

  if (!svgFirst) {
    report.errors.push('root.querySelector(svg) 未找到');
  } else {
    report.commentsInFirstSvg = walkComments(svgFirst);
    try {
      const { serialized, width, height } = serializeSvgForCopy(svgFirst, win);
      report.serialize = {
        width,
        height,
        len: serialized.length,
        hasPlantumlSrcComment: serialized.includes('plantuml-src'),
        hasPlantumlPi: /<\?plantuml/i.test(serialized),
        head: serialized.slice(0, 200),
        tail: serialized.slice(-120),
      };
      fs.writeFileSync(path.join(outDir, `debug-copy-${kind}-serialized.svg`), serialized, 'utf8');

      const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
      report.dataUrl = { len: dataUrl.length, encodeLen: encodeURIComponent(serialized).length };

      await new Promise((resolve) => {
        const img = new win.Image();
        img.onload = () => {
          report.imageLoad = { ok: true, width: img.width, height: img.height };
          resolve();
        };
        img.onerror = () => {
          report.imageLoad = { ok: false };
          report.errors.push('Image.onload 失败 — 栅格化将失败');
          resolve();
        };
        img.src = dataUrl;
        setTimeout(() => {
          if (!report.imageLoad) {
            report.imageLoad = { ok: false, timeout: true };
            report.errors.push('Image 加载超时');
            resolve();
          }
        }, 3000);
      });
    } catch (e) {
      report.errors.push(String(e));
    }
  }

  const reportPath = path.join(outDir, `debug-copy-${kind}-report.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('\n写入:', reportPath);
  console.log('序列化 SVG:', path.join(outDir, `debug-copy-${kind}-serialized.svg`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
