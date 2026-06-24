import { describe, it, expect } from 'vitest';
import { scopeSvgIdsForHtmlDocument } from '../scopeSvgIdsForHtmlDocument';

describe('scopeSvgIdsForHtmlDocument', () => {
  it('重写 gradient id 并同步 fill 中的 url(#id)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g1i5u5r8zo6ia41"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
  <rect fill="url(#g1i5u5r8zo6ia41)" width="10" height="10"/>
</svg>`;
    const out = scopeSvgIdsForHtmlDocument(svg);
    expect(out).not.toContain('id="g1i5u5r8zo6ia41"');
    expect(out).not.toContain('url(#g1i5u5r8zo6ia41)');
    expect(out).toMatch(/id="pu[^"]+g1i5u5r8zo6ia41"/);
    expect(out).toMatch(/url\(#pu[^)]+\)/);
  });

  it('非 SVG 字符串原样返回', () => {
    const html = '<div class="plantuml-error">x</div>';
    expect(scopeSvgIdsForHtmlDocument(html)).toBe(html);
  });

  it('两次调用产生不同前缀（降低同页多图 id 碰撞概率）', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"/></defs><rect fill="url(#a)"/></svg>';
    const a = scopeSvgIdsForHtmlDocument(svg);
    const b = scopeSvgIdsForHtmlDocument(svg);
    expect(a).not.toBe(b);
  });
});
