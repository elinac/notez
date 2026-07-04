/**
 * renderPlantUMLOffline 集成测试：mock Tauri invoke（不拉起真实 JVM / WASM）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PLANTUML_THEME } from '../../constants/plantumlThemes';
import { useSettingsStore } from '../../store/useSettingsStore';
import { plantUMLToDot } from '../plantuml-offline/PlantUMLParser';
import {
  applyPlantUmlTheme,
  clearPlantUmlSvgCache,
  renderPlantUMLOffline,
} from '../plantuml-offline/PlantUMLOfflineRenderer';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

const encoder = new TextEncoder();

function mockInvokeOk(svg: string) {
  return { svgBytes: [...encoder.encode(svg)], warnings: [] as string[] };
}

describe('applyPlantUmlTheme', () => {
  it('在 @startuml 下一行插入 !theme', () => {
    expect(applyPlantUmlTheme('@startuml\nx\n@enduml', 'mars')).toBe(
      '@startuml\n!theme mars\nx\n@enduml'
    );
  });

  it('图源已有行首 !theme 时不注入', () => {
    const s = '@startuml\n!theme plain\nx\n@enduml';
    expect(applyPlantUmlTheme(s, 'bluegray')).toBe(s);
  });
});

describe('PlantUML Real Render (mock invoke)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    clearPlantUmlSvgCache();
    useSettingsStore.setState({
      plantUmlTheme: DEFAULT_PLANTUML_THEME,
      plantUmlBackend: 'jar',
    });
  });

  it('REAL-1: invoke 成功返回 SVG 字节时得到带 plantuml-jar 的内联 SVG', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));

    const src = '@startuml\nBob -> Alice : hello\n@enduml';
    const expectedSource = `@startuml\n!theme ${DEFAULT_PLANTUML_THEME}\nBob -> Alice : hello\n@enduml`;
    const result = await renderPlantUMLOffline(src);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.html.trim()).toMatch(/^<svg/);
    expect(result.html).toContain('plantuml-jar');
    expect(result.html).toContain('1c1c1c');
    expect(result.html).not.toContain('plantuml-error');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('render_plantuml_local', {
      source: expectedSource,
      format: 'svg',
      backend: 'jar',
    });
  });

  it('REAL-1a: 仅移除根 svg 的 width/height，保留子元素上的 width（避免误伤 Graphviz 内嵌图形）', async () => {
    const svg =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"><image width="48" height="32" href="data:,"/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));

    const result = await renderPlantUMLOffline('@startuml\na->b\n@enduml');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');

    expect(result.html).toContain('width="48"');
    expect(result.html).toContain('height="32"');
    expect(result.html).not.toMatch(/<svg[^>]*\swidth=/i);
    expect(result.html).not.toMatch(/<svg[^>]*\sheight=/i);
  });

  it('REAL-1d: 相同图源第二次渲染命中内存缓存，不再 invoke', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));

    const src = '@startuml\nBob -> Alice : hello\n@enduml';
    await renderPlantUMLOffline(src);
    await renderPlantUMLOffline(src);

    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
  });

  it('REAL-1b: 图源含 !theme 时不再注入', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));

    const src = '@startuml\n!theme plain\na -> b\n@enduml';
    await renderPlantUMLOffline(src);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('render_plantuml_local', {
      source: src,
      format: 'svg',
      backend: 'jar',
    });
  });

  it('REAL-1c: 设置中的 theme 传入 invoke', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));
    useSettingsStore.setState({ plantUmlTheme: 'cerulean' });

    const src = '@startuml\nx\n@enduml';
    await renderPlantUMLOffline(src);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('render_plantuml_local', {
      source: '@startuml\n!theme cerulean\nx\n@enduml',
      format: 'svg',
      backend: 'jar',
    });
  });

  it('REAL-1e: themeOverride 优先于 store（切换主题时与 UI 帧一致）', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));
    useSettingsStore.setState({ plantUmlTheme: 'mars' });

    const src = '@startuml\nx\n@enduml';
    await renderPlantUMLOffline(src, 'cerulean');

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('render_plantuml_local', {
      source: '@startuml\n!theme cerulean\nx\n@enduml',
      format: 'svg',
      backend: 'jar',
    });
  });

  it('REAL-1f: Rust 后端时 invoke 传 backend rust 且根节点带 plantuml-rust', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));
    useSettingsStore.setState({ plantUmlBackend: 'rust' });

    const src = '@startuml\nBob -> Alice : hello\n@enduml';
    const expectedSource = `@startuml\n!theme ${DEFAULT_PLANTUML_THEME}\nBob -> Alice : hello\n@enduml`;
    const result = await renderPlantUMLOffline(src);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.html.trim()).toMatch(/^<svg/);
    expect(result.html).toContain('plantuml-rust');
    expect(result.html).not.toContain('plantuml-jar');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('render_plantuml_local', {
      source: expectedSource,
      format: 'svg',
      backend: 'rust',
    });
  });

  it('REAL-1g: 同一图源切换后端后缓存不命中，invoke 各一次', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk(svg));

    const src = '@startuml\na -> b\n@enduml';
    await renderPlantUMLOffline(src);
    useSettingsStore.setState({ plantUmlBackend: 'rust' });
    await renderPlantUMLOffline(src);

    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
  });

  it('REAL-1h: invoke 返回不支持的 backend 时返回 ok:false RenderResult', async () => {
    vi.mocked(invoke).mockRejectedValue(
      new Error('不支持的 PlantUML 后端: wasm（仅支持 jar / rust）')
    );
    const src = '@startuml\nx\n@enduml';
    const result = await renderPlantUMLOffline(src);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('不支持的 PlantUML 后端');
    expect(result.source).toBe(src);
  });

  it('REAL-1i: Rust 路径解析失败时 invoke 错误（第 n 行）进入 ok:false RenderResult', async () => {
    const msg = '第 2 行: 不支持类图/组件等非序列图关键字（Rust 引擎当前仅支持序列图子集）';
    vi.mocked(invoke).mockRejectedValue(new Error(msg));
    useSettingsStore.setState({ plantUmlBackend: 'rust' });
    const src = '@startuml\nclass X\n@enduml';
    const result = await renderPlantUMLOffline(src);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('第 2 行');
    expect(result.line).toBe(2);
    expect(result.source).toBe(src);
  });

  it('REAL-2: invoke 抛错时返回 ok:false RenderResult', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('PlantUML 退出码 Some(1): syntax error'));

    const src = '@startuml\nbad\n@enduml';
    const result = await renderPlantUMLOffline(src);

    expect(result).toEqual({
      ok: false,
      source: src,
      error: 'PlantUML 退出码 Some(1): syntax error',
      line: undefined,
    });
  });

  it('REAL-2b: JAR 错误含行号时 line 字段为解析结果', async () => {
    const msg = 'PlantUML 退出码 Some(200): ERROR\n3\nSyntax Error?';
    vi.mocked(invoke).mockRejectedValue(new Error(msg));
    const src = '@startuml\npackage"X"\n@enduml';
    const result = await renderPlantUMLOffline(src);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.line).toBe(3);
    expect(result.source).toBe(src);
    expect(result.error).toContain('Syntax Error?');
  });

  it('REAL-3: 输出非 SVG 时返回 ok:false RenderResult', async () => {
    vi.mocked(invoke).mockResolvedValue(mockInvokeOk('not svg at all'));

    const src = '@startuml\na->b\n@enduml';
    const result = await renderPlantUMLOffline(src);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('输出非 SVG');
    expect(result.source).toBe(src);
  });

  it('REAL-4: plantUMLToDot 多时序图仍产生预期 DOT（解析单测，不经 invoke）', async () => {
    const src = `@startuml
participant CloudService
participant SyncModule
CloudService -> SyncModule : 传递数据
(续行说明)
alt ok
SyncModule -> SyncModule : x
end
@enduml`;
    const { type, dot } = plantUMLToDot(src);
    expect(type).toBe('sequence');
    expect(dot).toContain('SequenceDiagram');
    expect(dot).not.toContain('doublecircle');
  });
});
