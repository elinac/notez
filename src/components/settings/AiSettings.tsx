import { useState } from 'react';
import { Plus, Trash2, Wifi, CheckCircle, XCircle } from 'lucide-react';
import { useSettingsStore, type AiProviderConfig, type AiProvider } from '../../store/useSettingsStore';
import { testConnection } from '../aiService';
import { AiProviderEditor } from './AiProviderEditor';

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama (本地)',
  custom: '自定义',
};

function generateId() {
  return `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface TestState {
  id: string;
  status: 'testing' | 'ok' | 'fail';
  message: string;
}

export function AiSettings() {
  const {
    aiConfigs, activeAiConfigId,
    upsertAiConfig, deleteAiConfig, setActiveAiConfigId,
  } = useSettingsStore();

  const [editing, setEditing] = useState<AiProviderConfig | null>(null);
  const [testState, setTestState] = useState<TestState | null>(null);

  const handleNew = () => {
    setEditing({
      id: generateId(), name: '新服务商',
      baseUrl: '', apiKey: '', model: '', provider: 'custom',
    });
  };

  const handleTest = async (cfg: AiProviderConfig) => {
    setTestState({ id: cfg.id, status: 'testing', message: '测试中…' });
    const result = await testConnection(cfg);
    setTestState({ id: cfg.id, status: result.ok ? 'ok' : 'fail', message: result.message });
  };

  const handleSave = (cfg: AiProviderConfig) => {
    upsertAiConfig(cfg);
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-700">服务商列表</span>
        <button onClick={handleNew}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
          <Plus size={12} /> 添加
        </button>
      </div>

      <div className="space-y-2">
        {aiConfigs.map((cfg) => {
          const isActive = cfg.id === activeAiConfigId || (!activeAiConfigId && aiConfigs[0]?.id === cfg.id);
          const ts = testState?.id === cfg.id ? testState : null;
          return (
            <div key={cfg.id}
              className={`p-2.5 rounded border text-xs ${isActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <input type="radio" checked={isActive} onChange={() => setActiveAiConfigId(cfg.id)} className="w-3 h-3 flex-shrink-0" />
                  <span className="font-medium truncate">{cfg.name}</span>
                  <span className="text-gray-400 flex-shrink-0">({PROVIDER_LABELS[cfg.provider]})</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleTest(cfg)} title="测试连接" className="p-0.5 text-gray-400 hover:text-blue-600" disabled={ts?.status === 'testing'}>
                    <Wifi size={12} />
                  </button>
                  <button onClick={() => setEditing({ ...cfg })} className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 rounded">编辑</button>
                  <button onClick={() => deleteAiConfig(cfg.id)} className="p-0.5 text-gray-400 hover:text-red-500">
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

      {editing && (
        <AiProviderEditor
          config={editing}
          isNew={!aiConfigs.find((c) => c.id === editing.id)}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onTest={handleTest}
          testState={testState?.id === editing.id ? testState : null}
        />
      )}
    </div>
  );
}
