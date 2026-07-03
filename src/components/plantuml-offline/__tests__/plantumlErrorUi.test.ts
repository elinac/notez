import { describe, it, expect } from 'vitest';
import {
  parsePlantUmlErrorLine,
  formatPlantUmlErrorHtml,
  registerPlantUmlFixPayload,
  consumePlantUmlFixPayload,
  type PlantUmlFixPayload,
} from '../plantumlErrorUi';

describe('parsePlantUmlErrorLine', () => {
  it('parses Rust engine format', () => {
    expect(parsePlantUmlErrorLine('第 2 行: 不支持类图关键字')).toBe(2);
  });

  it('parses JAR stderr format with standalone line number', () => {
    const msg = 'PlantUML 退出码 Some(200): ERROR\n3\nSyntax Error? (Assumed diagram type: sequence)';
    expect(parsePlantUmlErrorLine(msg)).toBe(3);
  });

  it('parses English line format', () => {
    expect(parsePlantUmlErrorLine('Syntax error at line 5')).toBe(5);
  });

  it('returns undefined when no line found', () => {
    expect(parsePlantUmlErrorLine('PlantUML 无输出')).toBeUndefined();
  });
});

describe('formatPlantUmlErrorHtml', () => {
  it('includes line badge, fix button, and highlighted source row', () => {
    const html = formatPlantUmlErrorHtml('第 3 行: 语法错误', '@startuml\na->b\nbad\n@enduml');
    expect(html).toContain('plantuml-error');
    expect(html).toContain('plantuml-error__line-badge');
    expect(html).toContain('第 3 行');
    expect(html).toContain('plantuml-ai-fix-btn');
    expect(html).toContain('AI 修复');
    expect(html).toContain('plantuml-error__source-row--err');
    expect(html).toContain('plantuml-error__line-text');
  });

  it('shows unknown badge when line not found', () => {
    const html = formatPlantUmlErrorHtml('unknown error', '@startuml\nx\n@enduml');
    expect(html).toContain('plantuml-error__line-badge--unknown');
    expect(html).toContain('plantuml-ai-fix-btn');
  });

  it('summarizes JAR error without redundant exit code in summary', () => {
    const msg = 'PlantUML 退出码 Some(200): ERROR\n3\nSyntax Error? (Assumed diagram type: sequence)';
    const html = formatPlantUmlErrorHtml(msg, '@startuml\nx\n@enduml');
    expect(html).toContain('plantuml-error__summary');
    expect(html).toContain('Syntax Error?');
    expect(html).not.toContain('退出码');
    const summaryMatch = html.match(/<p class="plantuml-error__summary">([^<]*)<\/p>/);
    expect(summaryMatch?.[1]).not.toMatch(/^\s*3\s*$/);
  });

  it('collapses source by default and truncates long source around error line', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const source = `@startuml\n${lines.join('\n')}\n@enduml`;
    const html = formatPlantUmlErrorHtml('第 10 行: 语法错误', source);
    expect(html).not.toContain('open>');
    expect(html).toContain('plantuml-error__source-truncated');
    expect(html).toContain('plantuml-error__source-row--err');
    expect(html).toContain('>10<');
    expect(html).not.toContain('>20<');
  });
});

describe('fix payload store', () => {
  it('registers and consumes payload by id', () => {
    const payload: PlantUmlFixPayload = {
      source: '@startuml\nx\n@enduml',
      errorMessage: 'err',
      errorLine: 1,
    };
    const id = registerPlantUmlFixPayload(payload);
    expect(consumePlantUmlFixPayload(id)).toEqual(payload);
    expect(consumePlantUmlFixPayload(id)).toBeUndefined();
  });
});
