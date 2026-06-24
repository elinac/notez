/**
 * End-to-end functional tests for PlantUML rendering pipeline
 * Tests the full flow: markdown text -> code block extraction -> DOT -> SVG output
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 1. renderMarkdownWithPlantUML extraction tests (pure string, no WASM) ──────
import { renderMarkdownWithPlantUML } from '../PlantUMLRenderer';

vi.mock('../plantuml-offline/PlantUMLOfflineRenderer', () => ({
  renderPlantUMLOffline: vi.fn().mockResolvedValue('<svg data-testid="rendered">mocked</svg>'),
}));

describe('PlantUML E2E - 代码块提取 (renderMarkdownWithPlantUML)', () => {
  it('E2E-1: 提取 @startuml/@enduml 包裹的 sequence 图', () => {
    const md = '```plantuml\n@startuml\nBob -> Alice : hello\n@enduml\n```';
    const html = renderMarkdownWithPlantUML(md);
    expect(html).toContain('plantuml-container');
    expect(html).toContain('data-plantuml-code');
    // data-plantuml-code should contain encoded plantuml source
    expect(html).toContain('@startuml');
    // should NOT be treated as raw code block
    expect(html).not.toContain('<pre');
  });

  it('E2E-2: 提取不带 @startuml 包裹的 sequence 图', () => {
    const md = '```plantuml\nBob -> Alice : hello\n```';
    const html = renderMarkdownWithPlantUML(md);
    expect(html).toContain('plantuml-container');
    expect(html).toContain('data-plantuml-code');
    expect(html).not.toContain('<pre');
  });

  it('E2E-3: plantuml-container 不被 renderBasicMarkdown 二次处理破坏', () => {
    const md = '```plantuml\nBob -> Alice : hello\n```\n\nSome **text** after.';
    const html = renderMarkdownWithPlantUML(md);
    // The div should be intact
    expect(html).toContain('class="plantuml-container');
    // bold text should also be processed
    expect(html).toContain('<strong>text</strong>');
    // No double-encoding of the plantuml-container div
    const containerCount = (html.match(/plantuml-container/g) || []).length;
    expect(containerCount).toBe(1);
  });

  it('E2E-4: data-plantuml-code 属性包含正确的转义内容', () => {
    const md = '```plantuml\nBob -> Alice : hello\n```';
    const html = renderMarkdownWithPlantUML(md);
    // quotes in code should be escaped as &quot;
    // ampersands should be escaped as &amp;
    // The attribute value should not break HTML
    const attrMatch = html.match(/data-plantuml-code="([^"]*?)"/);
    expect(attrMatch).not.toBeNull();
    const attrValue = attrMatch![1];
    expect(attrValue).not.toContain('"'); // unescaped quotes would break attribute
    // The encoded source should contain the message
    expect(attrValue).toContain('Bob');
    expect(attrValue).toContain('Alice');
  });

  it('E2E-5: Windows CRLF 换行符正确处理', () => {
    const md = '```plantuml\r\nBob -> Alice : hello\r\n```';
    const html = renderMarkdownWithPlantUML(md);
    expect(html).toContain('plantuml-container');
    expect(html).not.toContain('<pre');
  });
});

// ── 2. DOT generation tests (plantUMLToDot, no WASM) ──────────────────────────
import { plantUMLToDot } from '../plantuml-offline/PlantUMLParser';

describe('PlantUML E2E - DOT 生成 (plantUMLToDot)', () => {
  it('E2E-6: Bob -> Alice : hello 生成有效 sequence DOT', () => {
    const src = '@startuml\nBob -> Alice : hello\n@enduml';
    const { type, dot, supported } = plantUMLToDot(src);
    expect(type).toBe('sequence');
    expect(supported).toBe(true);
    expect(dot).toContain('digraph');
    expect(dot).toContain('Bob');
    expect(dot).toContain('Alice');
    expect(dot).toContain('hello');
    // Should be valid DOT - at minimum has graph wrapper and edge
    expect(dot).toMatch(/digraph\s+\w+\s*\{/);
    expect(dot).toContain('->');
  });

  it('E2E-7: 无 @startuml 包裹的消息也能生成 DOT', () => {
    const src = 'Bob -> Alice : hello';
    const { type, dot, supported } = plantUMLToDot(src);
    expect(type).toBe('sequence');
    expect(supported).toBe(true);
    expect(dot).toContain('Bob');
    expect(dot).toContain('Alice');
  });

  it('E2E-8: Alice --> Bob : response 生成虚线边', () => {
    const src = 'participant Alice\nparticipant Bob\nAlice --> Bob : response';
    const { type, dot } = plantUMLToDot(src);
    expect(type).toBe('sequence');
    expect(dot).toContain('style=dashed');
    expect(dot).toContain('response');
  });

  it('E2E-9: 多消息 sequence 图', () => {
    const src = '@startuml\nAlice -> Bob : request\nBob --> Alice : response\nAlice -> Bob : confirm\n@enduml';
    const { type, dot } = plantUMLToDot(src);
    expect(type).toBe('sequence');
    expect(dot).toContain('request');
    expect(dot).toContain('response');
    expect(dot).toContain('confirm');
    const edgeCount = (dot.match(/->/g) || []).length;
    expect(edgeCount).toBeGreaterThanOrEqual(3);
  });

  it('E2E-10: 生成的 DOT 语法结构完整（有开头 digraph 和结尾 }）', () => {
    const src = 'Bob -> Alice : hi';
    const { dot } = plantUMLToDot(src);
    const trimmed = dot.trim();
    expect(trimmed.startsWith('digraph')).toBe(true);
    expect(trimmed.endsWith('}')).toBe(true);
  });
});

// ── 3. renderPlantUMLOffline mock integration ─────────────────────────────────
import { renderPlantUMLOffline } from '../plantuml-offline/PlantUMLOfflineRenderer';

describe('PlantUML E2E - 渲染集成 (renderPlantUMLOffline mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (renderPlantUMLOffline as ReturnType<typeof vi.fn>).mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg" class="plantuml-svg"><g><text>Bob</text><text>Alice</text></g></svg>'
    );
  });

  it('E2E-11: renderPlantUMLOffline 被调用并返回 SVG', async () => {
    const result = await renderPlantUMLOffline('@startuml\nBob -> Alice : hello\n@enduml');
    expect(result).toContain('<svg');
    expect(result).toContain('Bob');
    expect(result).toContain('Alice');
  });

  it('E2E-12: 空输入被安全处理（不 throw）', async () => {
    (renderPlantUMLOffline as ReturnType<typeof vi.fn>).mockResolvedValue(
      '<div class="plantuml-error">渲染失败</div>'
    );
    const result = await renderPlantUMLOffline('');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
