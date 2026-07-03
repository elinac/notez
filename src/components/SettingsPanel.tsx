/**
 * SettingsPanel — AI provider configuration UI
 * Users can add/edit/delete providers and test connections.
 */
import { useState } from 'react';
import { Plus, Trash2, Wifi, CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import { SHOW_PLANTUML_BACKEND_SWITCH } from '../constants/buildFlags';
import { DEFAULT_PLANTUML_THEME, PLANTUML_THEME_OPTIONS } from '../constants/plantumlThemes';
import {
  EDITOR_COLOR_MODE_OPTIONS,
  EDITOR_THEME_OPTIONS,
} from '../constants/editorThemes';
import { CODE_BLOCK_THEME_OPTIONS } from '../constants/codeBlockThemes';
import { useSettingsStore, AiProviderConfig, AiProvider } from '../store/useSettingsStore';
import { testConnection } from './aiService';

function generateId() {
  return `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const PROVIDER_PRESETS: Record<AiProvider, Partial<AiProviderConfig>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ollama: { baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'llama3.2' },
  custom: { baseUrl: '', model: '' },
};

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama (本地)',
  custom: '自定义',
};

interface TestState {
  id: string;
  status: 'testing' | 'ok' | 'fail';
  message: string;
}

function SettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  wrapperClassName = 'mb-2',
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  wrapperClassName?: string;
}) {
  return (
    <>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className={`relative ${wrapperClassName}`}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs appearance-none pr-6 bg-white"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </>
  );
}

function PlantUmlBackendSwitch() {
  const { plantUmlBackend, setPlantUmlBackend } = useSettingsStore();
  return (
    <>
      <label className="block text-xs text-gray-500 mb-1">渲染引擎</label>
      <div className="relative mb-2">
        <select
          value={plantUmlBackend}
          onChange={(e) =>
            setPlantUmlBackend(e.target.value === 'rust' ? 'rust' : 'jar')
          }
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs appearance-none pr-6 bg-white"
        >
          <option value="jar">JAR（随包 JVM，默认）</option>
          <option value="rust">Rust（实验性，序列图子集）</option>
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
      <p className="text-[10px] text-gray-400 mb-2 leading-snug">
        Rust 引擎不支持全部语法且不会自动回退到 JAR；出错时请切回 JAR 或查阅文档中的子集说明。
      </p>
    </>
  );
}

export function SettingsPanel() {
  const {
    aiConfigs,
    activeAiConfigId,
    plantUmlTheme,
    editorColorMode,
    editorThemeId,
    codeBlockThemeId,
    upsertAiConfig,
    deleteAiConfig,
    setActiveAiConfigId,
    setPlantUmlTheme,
    setEditorColorMode,
    setEditorThemeId,
    setCodeBlockThemeId,
  } = useSettingsStore();

  const [editing, setEditing] = useState<AiProviderConfig | null>(null);
  const [testState, setTestState] = useState<TestState | null>(null);

  const handleNew = () => {
    setEditing({
      id: generateId(),
      name: '新服务商',
      baseUrl: '',
      apiKey: '',
      model: '',
      provider: 'custom',
    });
  };

  const handleEdit = (cfg: AiProviderConfig) => setEditing({ ...cfg });

  const handleProviderChange = (provider: AiProvider) => {
    if (!editing) return;
    const preset = PROVIDER_PRESETS[provider];
    setEditing({ ...editing, provider, ...preset });
  };

  const handleSave = () => {
    if (!editing) return;
    upsertAiConfig(editing);
    setEditing(null);
  };

  const handleTest = async (cfg: AiProviderConfig) => {
    setTestState({ id: cfg.id, status: 'testing', message: '测试中…' });
    const result = await testConnection(cfg);
    setTestState({ id: cfg.id, status: result.ok ? 'ok' : 'fail', message: result.message });
  };

  const plantUmlThemeSelectValue = PLANTUML_THEME_OPTIONS.some((o) => o.value === plantUmlTheme)
    ? plantUmlTheme
    : DEFAULT_PLANTUML_THEME;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-700">AI 服务商</span>
        <button
          onClick={handleNew}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          <Plus size={12} />
          添加
        </button>
      </div>

      {/* Config list */}
      <div className="flex-1 overflow-y-auto py-1">
        {aiConfigs.map((cfg) => {
          const isActive = cfg.id === activeAiConfigId || (!activeAiConfigId && aiConfigs[0]?.id === cfg.id);
          const ts = testState?.id === cfg.id ? testState : null;

          return (
            <div
              key={cfg.id}
              className={`mx-2 my-1 p-2 rounded border text-xs ${
                isActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <input
                    type="radio"
                    checked={isActive}
                    onChange={() => setActiveAiConfigId(cfg.id)}
                    className="w-3 h-3 flex-shrink-0"
                  />
                  <span className="font-medium truncate">{cfg.name}</span>
                  <span className="text-gray-400 flex-shrink-0">({PROVIDER_LABELS[cfg.provider]})</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleTest(cfg)}
                    title="测试连接"
                    className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors"
                    disabled={ts?.status === 'testing'}
                  >
                    <Wifi size={12} />
                  </button>
                  <button
                    onClick={() => handleEdit(cfg)}
                    className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 rounded transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => deleteAiConfig(cfg.id)}
                    className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="text-gray-400 truncate">{cfg.baseUrl}</div>
              <div className="text-gray-400">模型: {cfg.model || '未设置'}</div>

              {ts && (
                <div className={`flex items-center gap-1 mt-1 ${ts.status === 'ok' ? 'text-green-600' : ts.status === 'fail' ? 'text-red-500' : 'text-gray-400'}`}>
                  {ts.status === 'ok' ? <CheckCircle size={10} /> : ts.status === 'fail' ? <XCircle size={10} /> : null}
                  {ts.message}
                </div>
              )}
            </div>
          );
        })}

        {aiConfigs.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-6">暂无服务商，点击「添加」</div>
        )}
      </div>

      {/* Editor theme */}
      <div className="flex-shrink-0 border-t border-gray-200 px-3 py-2 bg-gray-50">
        <div className="text-xs font-semibold text-gray-700 mb-1.5">编辑器</div>
        <p className="text-[10px] text-gray-400 mb-2 leading-snug">
          文档主题主要作用于全屏（WYSIWYG）模式；源码模式按外观模式切换浅色/深色。
        </p>

        <SettingsSelect
          label="外观模式"
          value={editorColorMode}
          options={EDITOR_COLOR_MODE_OPTIONS}
          onChange={setEditorColorMode}
        />

        <SettingsSelect
          label="文档主题"
          value={editorThemeId}
          options={EDITOR_THEME_OPTIONS}
          onChange={setEditorThemeId}
        />

        <SettingsSelect
          label="代码块语法高亮"
          value={codeBlockThemeId}
          options={CODE_BLOCK_THEME_OPTIONS}
          onChange={setCodeBlockThemeId}
          wrapperClassName=""
        />
        <p className="text-[10px] text-gray-400 mt-2 leading-snug">
          代码块语法主题与编辑器明/暗独立，可自由组合。
        </p>
      </div>

      {/* PlantUML theme */}
      <div className="flex-shrink-0 border-t border-gray-200 px-3 py-2 bg-gray-50">
        <div className="text-xs font-semibold text-gray-700 mb-1.5">PlantUML</div>
        {SHOW_PLANTUML_BACKEND_SWITCH && <PlantUmlBackendSwitch />}
        <SettingsSelect
          label="图表主题（图源中已写 !theme 时优先生效）"
          value={plantUmlThemeSelectValue}
          options={PLANTUML_THEME_OPTIONS}
          onChange={setPlantUmlTheme}
          wrapperClassName=""
        />
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-80 p-4">
            <h3 className="text-sm font-semibold mb-3">
              {aiConfigs.find((c) => c.id === editing.id) ? '编辑服务商' : '添加服务商'}
            </h3>

            <div className="space-y-2.5 text-sm">
              {/* Provider type */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">类型</label>
                <div className="relative">
                  <select
                    value={editing.provider}
                    onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                    className="w-full px-2 py-1.5 border rounded text-sm appearance-none pr-6"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="ollama">Ollama (本地)</option>
                    <option value="custom">自定义</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">名称</label>
                <input
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如: My OpenAI"
                />
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Base URL</label>
                <input
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400 font-mono"
                  value={editing.baseUrl}
                  onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  API Key
                  {editing.provider === 'ollama' && (
                    <span className="ml-1 text-gray-400">（Ollama 可留空或填 "ollama"）</span>
                  )}
                </label>
                <input
                  type="password"
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400 font-mono"
                  value={editing.apiKey}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  placeholder={editing.provider === 'ollama' ? 'ollama' : 'sk-...'}
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">模型</label>
                <input
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400"
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  placeholder={editing.provider === 'ollama' ? 'llama3.2' : 'gpt-4o-mini'}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => handleTest(editing)}
                className="px-3 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200 flex items-center gap-1"
              >
                <Wifi size={11} /> 测试
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                保存
              </button>
            </div>

            {/* Test result in modal */}
            {testState && testState.id === editing.id && (
              <div className={`mt-2 text-xs flex items-center gap-1 ${testState.status === 'ok' ? 'text-green-600' : testState.status === 'fail' ? 'text-red-500' : 'text-gray-400'}`}>
                {testState.status === 'ok' ? <CheckCircle size={11} /> : testState.status === 'fail' ? <XCircle size={11} /> : null}
                {testState.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
