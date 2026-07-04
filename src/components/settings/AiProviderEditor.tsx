import { useState } from 'react';
import { Wifi, CheckCircle, XCircle, ChevronDown, RefreshCw } from 'lucide-react';
import type { AiProviderConfig, AiProvider, ProxyMode } from '../../store/useSettingsStore';

const PROVIDER_PRESETS: Record<AiProvider, Partial<AiProviderConfig>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
  custom: { baseUrl: '', model: '' },
};

interface TestState { id: string; status: 'testing' | 'ok' | 'fail'; message: string; }

interface Props {
  config: AiProviderConfig;
  isNew: boolean;
  onSave: (cfg: AiProviderConfig) => void;
  onCancel: () => void;
  onTest: (cfg: AiProviderConfig) => void;
  testState: TestState | null;
}

export function AiProviderEditor({ config, isNew, onSave, onCancel, onTest, testState }: Props) {
  const [editing, setEditing] = useState(config);

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const handleProviderChange = (provider: AiProvider) => {
    const preset = PROVIDER_PRESETS[provider];
    setEditing({ ...editing, provider, ...preset });
  };

  const handleFetchModels = async () => {
    if (!editing.baseUrl) return;
    setFetchingModels(true);
    try {
      let models: string[] = [];
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ id: string; name?: string }[]>('ai_list_models', {
          baseUrl: editing.baseUrl,
          apiKey: editing.apiKey,
          provider: editing.provider,
          proxyMode: editing.proxyMode,
          proxyUrl: editing.proxyUrl,
        });
        models = result.map((m) => m.id);
      } else {
        const url = `${editing.baseUrl.replace(/\/+$/, '')}/models`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (editing.apiKey) {
          if (editing.provider === 'anthropic') {
            headers['x-api-key'] = editing.apiKey;
            headers['anthropic-version'] = '2023-06-01';
          } else {
            headers['Authorization'] = `Bearer ${editing.apiKey}`;
          }
        }
        const resp = await fetch(url, { headers });
        if (resp.ok) {
          const json = await resp.json();
          const data = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
          models = data.map((m: { id?: string }) => m.id).filter(Boolean) as string[];
        }
      }
      setFetchedModels(models.sort());
    } catch (err) {
      console.error('Failed to fetch models:', err);
      setFetchedModels([]);
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl w-80 p-4">
        <h3 className="text-sm font-semibold mb-3">{isNew ? '添加服务商' : '编辑服务商'}</h3>
        <div className="space-y-2.5 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">类型</label>
            <div className="relative">
              <select value={editing.provider} onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                className="w-full px-2 py-1.5 border rounded text-sm appearance-none pr-6">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="custom">自定义</option>
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">名称</label>
            <input className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400"
              value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="例如: My OpenAI" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL</label>
            <input className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400 font-mono"
              value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">API Key</label>
            <input type="password" className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400 font-mono"
              value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              placeholder="sk-..." />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">代理设置</label>
            <div className="flex flex-col gap-1.5">
              {(['none', 'system', 'custom'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="proxyMode"
                    checked={editing.proxyMode === mode}
                    onChange={() => setEditing({ ...editing, proxyMode: mode as ProxyMode, ...(mode !== 'custom' ? { proxyUrl: undefined } : {}) })}
                    className="w-3 h-3"
                  />
                  {mode === 'none' ? '无代理' : mode === 'system' ? '系统代理' : '自定义代理'}
                </label>
              ))}
            </div>
            {editing.proxyMode === 'custom' && (
              <input
                className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400 font-mono mt-1.5"
                value={editing.proxyUrl ?? ''}
                onChange={(e) => setEditing({ ...editing, proxyUrl: e.target.value })}
                placeholder="http://127.0.0.1:7890 or socks5://..."
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">模型</label>
            <div className="flex gap-1.5">
              <div className="flex-1 relative">
                <input
                  className="w-full px-2 py-1.5 border rounded text-sm outline-none focus:border-blue-400"
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  placeholder={editing.provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini'}
                  list={`models-${editing.id}`}
                />
                {fetchedModels.length > 0 && (
                  <datalist id={`models-${editing.id}`}>
                    {fetchedModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                )}
              </div>
              <button
                onClick={handleFetchModels}
                disabled={fetchingModels || !editing.baseUrl}
                className="px-2 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-40 flex-shrink-0 flex items-center gap-1"
                title="从服务商拉取可用模型列表"
              >
                {fetchingModels ? (
                  <span className="inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCw size={11} />
                )}
                拉取
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onTest(editing)} className="px-3 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200 flex items-center gap-1">
            <Wifi size={11} /> 测试
          </button>
          <div className="flex-1" />
          <button onClick={onCancel} className="px-3 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200">取消</button>
          <button onClick={() => onSave(editing)} className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">保存</button>
        </div>
        {testState && (
          <div className={`mt-2 text-xs flex items-center gap-1 ${testState.status === 'ok' ? 'text-green-600' : testState.status === 'fail' ? 'text-red-500' : 'text-gray-400'}`}>
            {testState.status === 'ok' ? <CheckCircle size={11} /> : testState.status === 'fail' ? <XCircle size={11} /> : null}
            {testState.message}
          </div>
        )}
      </div>
    </div>
  );
}
