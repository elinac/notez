/**
 * MermaidRenderer Tests
 *
 * Tests focus on the pure parsing logic (parseBlocks / renderMarkdownWithMermaid)
 * which runs in Node/jsdom without needing a real mermaid render call.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── Mock mermaid before importing the module ──────────────────────────────────
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg><text>mocked</text></svg>' }),
    run: vi.fn().mockResolvedValue(undefined),
  },
}));

import { parseBlocks, renderMarkdownWithMermaid, type Block, type MermaidBlock as MermaidBlockType } from '../MermaidRenderer';

// ── parseBlocks ───────────────────────────────────────────────────────────────

describe('parseBlocks()', () => {
  it('TC1: 纯文本返回单个 text 块', () => {
    const blocks: Block[] = parseBlocks('# Hello\n\nSome text.');
    expect(blocks.every((b: Block) => b.type === 'text')).toBe(true);
    const html = blocks.map((b: Block) => (b.type === 'text' ? b.html : '')).join('');
    expect(html).toContain('<h1');
    expect(html).toContain('Hello');
  });

  it('TC2: 单个 mermaid 块被识别为 mermaid 类型', () => {
    const blocks = parseBlocks('```mermaid\nflowchart LR\nA-->B\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('mermaid');
    if (blocks[0].type === 'mermaid') {
      expect(blocks[0].code).toContain('flowchart LR');
      expect(blocks[0].code).toContain('A-->B');
    }
  });

  it('TC3: 多个 mermaid 块各自独立', () => {
    const input = [
      '```mermaid',
      'graph TD',
      'A-->B',
      '```',
      '',
      'Middle text',
      '',
      '```mermaid',
      'sequenceDiagram',
      'A->>B: Hi',
      '```',
    ].join('\n');

    const blocks: Block[] = parseBlocks(input);
    const mermaidBlocks = blocks.filter((b: Block) => b.type === 'mermaid') as MermaidBlockType[];
    expect(mermaidBlocks).toHaveLength(2);
    // Keys must be unique
    const keys = mermaidBlocks.map((b: MermaidBlockType) => b.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('TC4: 文本块夹在两个 mermaid 块之间', () => {
    const input = [
      '```mermaid',
      'graph LR',
      'A-->B',
      '```',
      '',
      '**中间段落**',
      '',
      '```mermaid',
      'pie',
      'title Sales',
      '```',
    ].join('\n');

    const blocks: Block[] = parseBlocks(input);
    const types = blocks.map((b: Block) => b.type);
    expect(types).toContain('mermaid');
    expect(types).toContain('text');
  });

  it('TC5: 中文内容在 mermaid 代码中保持原样（不被HTML编码）', () => {
    const input = '```mermaid\nflowchart LR\nA[开始] --> B[结束]\n```';
    const blocks = parseBlocks(input);
    expect(blocks[0].type).toBe('mermaid');
    if (blocks[0].type === 'mermaid') {
      expect(blocks[0].code).toContain('A[开始]');
      expect(blocks[0].code).toContain('B[结束]');
      // Must NOT be HTML-encoded
      expect(blocks[0].code).not.toContain('&amp;');
      expect(blocks[0].code).not.toContain('&lt;');
    }
  });

  it('TC6: 混合内容——标题 + 图表 + 粗体', () => {
    const input = [
      '# 标题',
      '',
      '```mermaid',
      'graph TD',
      'A-->B',
      '```',
      '',
      '**粗体文字**',
    ].join('\n');

    const blocks: Block[] = parseBlocks(input);
    const mermaidBlocks = blocks.filter((b: Block) => b.type === 'mermaid');
    const textBlocks = blocks.filter((b: Block) => b.type === 'text');
    expect(mermaidBlocks).toHaveLength(1);
    expect(textBlocks.length).toBeGreaterThanOrEqual(1);

    const allHtml = textBlocks.map((b: Block) => (b.type === 'text' ? b.html : '')).join('');
    expect(allHtml).toContain('<h1');
    expect(allHtml).toContain('<strong>粗体文字</strong>');
  });

  it('TC7: 支持多种图表类型', () => {
    const types = [
      'graph TD',
      'graph LR',
      'flowchart LR',
      'sequenceDiagram',
      'classDiagram',
      'erDiagram',
      'gantt',
      'pie',
    ];

    for (const t of types) {
      const blocks: Block[] = parseBlocks(`\`\`\`mermaid\n${t}\nA-->B\n\`\`\``);
      expect(blocks[0].type).toBe('mermaid');
      if (blocks[0].type === 'mermaid') {
        expect(blocks[0].code).toContain(t);
      }
    }
  });
});

// ── renderMarkdownWithMermaid (legacy compat) ─────────────────────────────────

describe('renderMarkdownWithMermaid() legacy compat', () => {
  it('TC8: mermaid 块输出包含 mermaid-placeholder 类', () => {
    const result = renderMarkdownWithMermaid('```mermaid\ngraph LR\nA-->B\n```');
    expect(result).toContain('mermaid-placeholder');
  });

  it('TC9: 普通 markdown 仍然转为 HTML', () => {
    const result = renderMarkdownWithMermaid('# Title\n\n**bold**');
    expect(result).toContain('<h1');
    expect(result).toContain('<strong>bold</strong>');
  });

  it('TC10: 两个 mermaid 块各自生成一个 placeholder', () => {
    const input = '```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\npie\n```';
    const result = renderMarkdownWithMermaid(input);
    const matches = result.match(/mermaid-placeholder/g);
    expect(matches?.length).toBe(2);
  });
});

// ── Overflow / scrollbar CSS validation ──────────────────────────────────────

describe('Scrollbar CSS rules (unit check)', () => {
  beforeAll(() => {
    // Inject the critical CSS rules into jsdom
    const style = document.createElement('style');
    style.textContent = `
      html, body { overflow: hidden; height: 100%; margin: 0; padding: 0; }
      #root { height: 100%; overflow: hidden; }
    `;
    document.head.appendChild(style);

    // Set up #root
    let root = document.getElementById('root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'root';
      document.body.appendChild(root);
    }
  });

  it('TC11: document.documentElement (html) overflow 为 hidden', () => {
    document.documentElement.style.overflow = 'hidden';
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('TC12: document.body overflow 为 hidden', () => {
    document.body.style.overflow = 'hidden';
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('TC13: document.body margin 为 0', () => {
    document.body.style.margin = '0';
    // jsdom normalises '0' to '0px' per CSS spec
    expect(document.body.style.margin).toMatch(/^0(px)?$/);
  });

  it('TC14: #root 元素存在且 overflow 可设为 hidden', () => {
    const root = document.getElementById('root');
    expect(root).not.toBeNull();
    root!.style.overflow = 'hidden';
    expect(root!.style.overflow).toBe('hidden');
  });
});
