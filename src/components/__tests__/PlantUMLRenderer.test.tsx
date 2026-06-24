import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { renderMarkdownWithPlantUML, encodePlantUML, PlantUMLRenderer } from '../PlantUMLRenderer';
import { renderPlantUMLOffline } from '../plantuml-offline/PlantUMLOfflineRenderer';
import { useSettingsStore } from '../../store/useSettingsStore';

// Mock the offline renderer - no WASM in unit tests
vi.mock('../plantuml-offline/PlantUMLOfflineRenderer', () => ({
  renderPlantUMLOffline: vi.fn().mockResolvedValue('<svg>mocked plantuml</svg>'),
}));

describe('PlantUMLRenderer', () => {
  describe('组件：previewDocumentId', () => {
    beforeEach(() => {
      vi.mocked(renderPlantUMLOffline).mockClear();
      useSettingsStore.setState({ plantUmlTheme: 'bluegray' });
    });

    it('相同 content 但 previewDocumentId 变化时仍再次调用离线渲染（避免换标签/文件后漏刷）', async () => {
      const md = '```plantuml\nAlice -> Bob : hi\n```';
      const { rerender } = render(
        <PlantUMLRenderer content={md} previewDocumentId="tab-a" />
      );
      await waitFor(() => expect(vi.mocked(renderPlantUMLOffline)).toHaveBeenCalledTimes(1));
      rerender(<PlantUMLRenderer content={md} previewDocumentId="tab-b" />);
      await waitFor(() => expect(vi.mocked(renderPlantUMLOffline)).toHaveBeenCalledTimes(2));
    });
  });

  // 测试用例 1: PlantUML 编码函数
  describe('encodePlantUML', () => {
    it('TC1: 应正确编码 PlantUML 文本', () => {
      const input = 'A --> B';
      const result = encodePlantUML(input);
      // PlantUML 使用特定编码，我们验证它不为空且与输入不同
      expect(result).toBeTruthy();
      expect(result).not.toBe(input);
      expect(typeof result).toBe('string');
    });

    it('TC2: 应处理包含特殊字符的 PlantUML', () => {
      const input = 'class Car {\n  +String model\n}';
      const result = encodePlantUML(input);
      expect(result).toBeTruthy();
      expect(result).not.toContain('\n'); // 编码后不应包含换行
    });

    it('TC3: 应处理空字符串', () => {
      const result = encodePlantUML('');
      expect(typeof result).toBe('string');
    });
  });

  // 测试用例 4: 普通 Markdown 文本
  it('TC4: 应正确渲染普通 Markdown，不修改非 PlantUML 内容', () => {
    const input = '# Hello\n\nThis is **bold** text.';
    const result = renderMarkdownWithPlantUML(input);
    expect(result).toContain('<h1');
    expect(result).toContain('Hello');
    expect(result).toContain('<strong>bold</strong>');
  });

  // 测试用例 5: 包含 PlantUML 代码块
  it('TC5: 应识别并处理 PlantUML 代码块', () => {
    const input = '```plantuml\nA --> B\n```';
    const result = renderMarkdownWithPlantUML(input);
    expect(result).toContain('plantuml-container');
    expect(result).toContain('data-plantuml-code');
    // 不再使用在线服务
    expect(result).not.toContain('plantuml.com');
  });

  // 测试用例 6: 多个 PlantUML 代码块
  it('TC6: 应处理多个 PlantUML 代码块', () => {
    const input = `
# Diagrams

\`\`\`plantuml
class A
\`\`\`

Some text

\`\`\`plantuml
class B
\`\`\`
    `;
    const result = renderMarkdownWithPlantUML(input);
    const matches = result.match(/plantuml-container/g);
    expect(matches?.length).toBe(2);
  });

  // 测试用例 7: 不同类型的 PlantUML 图表
  it('TC7: 应支持多种 PlantUML 图表类型', () => {
    const types = [
      '@startuml\nA --> B\n@enduml',
      'class Car',
      'sequence A -> B',
      'usecase (Login)',
      'activity Start',
      'component Server',
      'state Active',
      'object MyObject',
    ];
    
    types.forEach(type => {
      const input = `\`\`\`plantuml\n${type}\n\`\`\``;
      const result = renderMarkdownWithPlantUML(input);
      expect(result).toContain('plantuml-container');
      expect(result).toContain('data-plantuml-code'); // offline: data attr instead of img src
    });
  });

  // 测试用例 8: 混合 Mermaid 和 PlantUML
  it('TC8: 应正确处理混合的 Mermaid 和 PlantUML 代码块', () => {
    const input = `
# Diagrams

\`\`\`mermaid
graph TD
A-->B
\`\`\`

\`\`\`plantuml
A --> B
\`\`\`
    `;
    const result = renderMarkdownWithPlantUML(input);
    expect(result).toContain('mermaid-container');
    expect(result).toContain('plantuml-container');
  });

  // 测试用例 9: 空 PlantUML 代码块
  it('TC9: 应处理空的 PlantUML 代码块', () => {
    const input = '```plantuml\n\n```';
    const result = renderMarkdownWithPlantUML(input);
    expect(result).toContain('plantuml-container');
  });

  // 测试用例 10: 混合内容（Markdown + PlantUML）
  it('TC10: 应正确渲染混合内容', () => {
    const input = `
# My Document

Here is a diagram:

\`\`\`plantuml
A[Start] --> B[End]
\`\`\`

And some **bold** text after.
    `;
    const result = renderMarkdownWithPlantUML(input);
    expect(result).toContain('<h1');
    expect(result).toContain('plantuml-container');
    expect(result).toContain('<strong>bold</strong>');
  });
});
