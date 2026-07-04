/**
 * PlantUML 离线渲染：Tauri 下经 invoke 走 JAR（默认）或实验性 Rust 引擎。
 * 失败时返回 RenderResult 的 ok: false 分支（结构化错误，不再生成错误 HTML）。
 */
import { effectivePlantUmlBackend } from '../../constants/buildFlags';
import { DEFAULT_PLANTUML_THEME } from '../../constants/plantumlThemes';
import {
  useSettingsStore,
  type PlantUmlBackend,
} from '../../store/useSettingsStore';
import { parsePlantUmlErrorLine } from './plantumlErrorUi';

function ensurePlantUMLWrapper(source: string): string {
  const t = source.trim();
  if (!/@start\w+/i.test(t)) {
    return `@startuml\n${t}\n@enduml`;
  }
  return source;
}

/** 图源已含行首 `!theme` 时不注入；否则在 `@start…` 下一行插入 `!theme` */
export function applyPlantUmlTheme(wrappedSource: string, theme: string): string {
  if (/^[ \t]*!theme\s+/m.test(wrappedSource)) {
    return wrappedSource;
  }
  const name = (theme || DEFAULT_PLANTUML_THEME).trim() || DEFAULT_PLANTUML_THEME;
  const lines = wrappedSource.split(/\r?\n/);
  const idx = lines.findIndex((line) => /^@start\w+/i.test(line.trim()));
  if (idx === -1) {
    return wrappedSource;
  }
  const next = [...lines];
  next.splice(idx + 1, 0, `!theme ${name}`);
  return next.join('\n');
}

function toDisplayMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** 与根 svg 内联 style 同步：避免预览区继承 :root 暗色 color 导致 currentColor / fill:inherit 错乱 */
const SVG_HOST_STYLE =
  'max-width:100%;height:auto;color:#1c1c1c;color-scheme:light;forced-color-adjust:none;-webkit-print-color-adjust:exact;print-color-adjust:exact';

/** 旧版字符串替换：只删「首个」width/height，易误伤子元素（如 <image width="…">），仅作解析失败时的兜底 */
function legacyStyleSvgMarkup(svgOnly: string, cls: string): string {
  return svgOnly
    .replace(/<svg /i, `<svg style="${SVG_HOST_STYLE}" class="${cls}" `)
    .replace(/width="[^"]*"/, '')
    .replace(/height="[^"]*"/, '');
}

function svgRootClassForBackend(backend: PlantUmlBackend): string {
  return backend === 'rust'
    ? 'plantuml-output plantuml-svg plantuml-rust'
    : 'plantuml-output plantuml-svg plantuml-jar';
}

/** 去掉 JAR 输出的 plantuml / plantuml-src 元数据，避免 innerHTML 注入后变成非法注释。 */
function stripPlantumlMetadataNodes(root: ParentNode): void {
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
      stripPlantumlMetadataNodes(child as Element);
    }
  }
}

function styleSvgMarkup(svg: string, backend: PlantUmlBackend): string {
  const svgOnly = svg
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  const cls = svgRootClassForBackend(backend);

  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return legacyStyleSvgMarkup(svgOnly, cls);
  }

  try {
    const doc = new DOMParser().parseFromString(svgOnly, 'image/svg+xml');
    if (doc.querySelector('parsererror')) {
      return legacyStyleSvgMarkup(svgOnly, cls);
    }

    const root = doc.documentElement;
    if (!root || root.localName.toLowerCase() !== 'svg') {
      return legacyStyleSvgMarkup(svgOnly, cls);
    }

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

    return new XMLSerializer().serializeToString(root);
  } catch {
    return legacyStyleSvgMarkup(svgOnly, cls);
  }
}

/** 后处理 SVG（styleSvgMarkup）规则变更时递增，避免会话内缓存长期返回旧字符串（如缺少根节点 color 修复） */
const PLANTUML_SVG_STYLE_REVISION = 2;

/** 成功渲染的 SVG 内存缓存：再次打开同一图源（同主题）时跳过 JVM，避免每次冷启动 */
const SVG_CACHE_MAX = 48;
const svgResultCache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const v = svgResultCache.get(key);
  if (v === undefined) return undefined;
  svgResultCache.delete(key);
  svgResultCache.set(key, v);
  return v;
}

function cacheSet(key: string, svg: string) {
  svgResultCache.delete(key);
  svgResultCache.set(key, svg);
  while (svgResultCache.size > SVG_CACHE_MAX) {
    const oldest = svgResultCache.keys().next().value;
    if (oldest === undefined) break;
    svgResultCache.delete(oldest);
  }
}

/** 单测或需要强制重渲时清空（例如验证 invoke 次数、串行队列状态） */
export function clearPlantUmlSvgCache() {
  svgResultCache.clear();
  inFlightByKey.clear();
  bundledJarSerial = Promise.resolve();
}

function buildPlantUmlSourceAndCacheKey(
  rawSource: string,
  themeOverride?: string
): {
  cacheKey: string;
  sourceForInvoke: string;
  backend: PlantUmlBackend;
} {
  const wrapped = ensurePlantUMLWrapper(rawSource);
  const theme = (
    themeOverride ??
    useSettingsStore.getState().plantUmlTheme ??
    DEFAULT_PLANTUML_THEME
  ).trim() || DEFAULT_PLANTUML_THEME;
  const backend = effectivePlantUmlBackend(useSettingsStore.getState().plantUmlBackend);
  const sourceForInvoke = applyPlantUmlTheme(wrapped, theme);
  const cacheKey = `${backend}\0${theme}\0${sourceForInvoke}\0post${PLANTUML_SVG_STYLE_REVISION}`;
  return { cacheKey, sourceForInvoke, backend };
}

/** Tauri `render_plantuml_local` 成功载荷（camelCase，与 Rust `rename_all` 一致） */
type PlantumlLocalRenderResult = {
  svgBytes: number[];
  warnings?: string[];
};

/** 单次 invoke：Tauri WebView 中调用随包 PlantUML（JAR 或 Rust 后端） */
async function tryRenderBundledPlantumlOnce(
  sourceForInvoke: string,
  backend: PlantUmlBackend
): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('无法在服务端或非浏览器环境渲染 PlantUML');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<PlantumlLocalRenderResult>('render_plantuml_local', {
    source: sourceForInvoke,
    format: 'svg',
    backend,
  });
  for (const w of result.warnings ?? []) {
    console.warn('[PlantUML]', w);
  }
  const bytes = result.svgBytes;
  const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  if (!text.includes('<svg')) {
    const preview = text.slice(0, 500);
    throw new Error(`PlantUML 输出非 SVG（预览）: ${preview}`);
  }
  return styleSvgMarkup(text, backend);
}

/** 全局串行：避免多图同时冷启动多个 JVM（极低效且拖慢整机） */
let bundledJarSerial: Promise<void> = Promise.resolve();

/** 同 key 并发只跑一次 invoke（例如 Strict Mode 双 effect） */
const inFlightByKey = new Map<string, Promise<string>>();

async function tryRenderBundledPlantuml(
  source: string,
  themeOverride?: string
): Promise<string> {
  const { cacheKey, sourceForInvoke, backend } = buildPlantUmlSourceAndCacheKey(
    source,
    themeOverride
  );
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) {
    return hit;
  }

  const existing = inFlightByKey.get(cacheKey);
  if (existing !== undefined) {
    return existing;
  }

  const promise = (async () => {
    try {
      let resolved!: string;
      const run = bundledJarSerial.then(async () => {
        resolved = await tryRenderBundledPlantumlOnce(
          sourceForInvoke,
          backend
        );
      });
      bundledJarSerial = run.then(
        () => undefined,
        () => undefined
      );
      await run;
      cacheSet(cacheKey, resolved);
      return resolved;
    } finally {
      inFlightByKey.delete(cacheKey);
    }
  })();

  inFlightByKey.set(cacheKey, promise);
  return promise;
}

/**
 * 渲染单个 PlantUML 代码块 → 成功时内联 SVG，失败时结构化错误信息
 *
 * @param themeOverride 传入时使用该主题生成/缓存（与 UI 当前帧一致，避免切换主题时与 store 读取出错序）
 */
export type RenderResult =
  | { ok: true; html: string }
  | { ok: false; source: string; error: string; line?: number };

export async function renderPlantUMLOffline(
  source: string,
  themeOverride?: string
): Promise<RenderResult> {
  try {
    const html = await tryRenderBundledPlantuml(source, themeOverride);
    return { ok: true, html };
  } catch (error) {
    console.error('[PlantUML] offline render error:', error);
    const message = toDisplayMessage(error);
    return {
      ok: false,
      source,
      error: message,
      line: parsePlantUmlErrorLine(message),
    };
  }
}
