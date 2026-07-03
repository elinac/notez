/**
 * AiPanel — AI assistant sidebar panel
 * Supports streaming chat, quick actions (expand, summarize, generate diagram),
 * and PlantUML fix workflow (propose → confirm → apply → revert).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, ChevronDown, StopCircle } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppStore } from '../store/useAppStore';
import { streamChat, AI_PROMPTS, ChatMessage } from './aiService';
import {
  extractPlantUmlFromResponse,
  findPlantUmlBlockSource,
  replacePlantUmlBlock,
} from '../utils/replacePlantUmlBlock';

type PlantUmlFixStatus = 'pending' | 'applied' | 'reverted' | 'dismissed';

type PlantUmlFixMeta = {
  status: PlantUmlFixStatus;
  originalSource: string;
  proposedSource: string;
  errorMessage: string;
  errorLine?: number;
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  plantUmlFix?: PlantUmlFixMeta;
  /** When true, skip auto-append diagram code on done (fix flow). */
  isPlantUmlFix?: boolean;
}

type QuickAction = 'expand' | 'summarize' | 'plantUML' | 'mermaid';

const QUICK_ACTIONS: { id: QuickAction; label: string; desc: string }[] = [
  { id: 'expand', label: '续写笔记', desc: '根据当前内容继续扩展' },
  { id: 'summarize', label: '总结要点', desc: '提取核心要点' },
  { id: 'plantUML', label: '生成 PlantUML', desc: '从描述生成图表代码' },
  { id: 'mermaid', label: '生成 Mermaid', desc: '从描述生成流程图' },
];

function genId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function AiPanel() {
  const { getActiveConfig, aiConfigs, activeAiConfigId, setActiveAiConfigId } = useSettingsStore();
  const {
    content,
    setContent,
    plantUmlFixRequest,
    plantUmlFixRequestSeq,
    clearPlantUmlFixRequest,
  } = useAppStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [fixNotice, setFixNotice] = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef(false);
  const lastHandledFixSeqRef = useRef(0);
  const sendMessageRef = useRef<typeof sendMessage | null>(null);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, fixNotice]);

  const activeConfig = getActiveConfig();

  const appendAssistantMessage = (id: string, token: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + token, streaming: true } : m))
    );
  };

  const finalizeAssistantMessage = (id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, streaming: false } : m))
    );
  };

  const sendMessage = useCallback(
    async (
      userText: string,
      systemPrompt?: string,
      options?: { isPlantUmlFix?: boolean; fixMeta?: Omit<PlantUmlFixMeta, 'status' | 'proposedSource'> }
    ) => {
      if (!activeConfig) return;
      if (streamingRef.current) return;

      streamingRef.current = true;
      const userMsg: Message = { id: genId(), role: 'user', content: userText };
      const asstId = genId();
      const asstMsg: Message = {
        id: asstId,
        role: 'assistant',
        content: '',
        streaming: true,
        isPlantUmlFix: options?.isPlantUmlFix,
      };

      setMessages((prev) => [...prev, userMsg, asstMsg]);
      setInput('');
      setStreaming(true);
      abortRef.current = false;

      const chatMessages: ChatMessage[] = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...messages
          .filter((m) => !m.streaming)
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: userText },
      ];

      await streamChat(activeConfig, chatMessages, {
        onToken: (token) => {
          if (abortRef.current) return;
          appendAssistantMessage(asstId, token);
        },
        onDone: (fullText) => {
          finalizeAssistantMessage(asstId);
          setStreaming(false);
          streamingRef.current = false;

          if (options?.isPlantUmlFix && options.fixMeta) {
            const proposed = extractPlantUmlFromResponse(fullText);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstId
                  ? {
                      ...m,
                      plantUmlFix: proposed
                        ? {
                            status: 'pending' as const,
                            originalSource: options.fixMeta!.originalSource,
                            proposedSource: proposed,
                            errorMessage: options.fixMeta!.errorMessage,
                            errorLine: options.fixMeta!.errorLine,
                          }
                        : undefined,
                      content: proposed
                        ? fullText
                        : `${fullText}\n\n⚠️ 未能从回复中解析 PlantUML 代码块，请手动复制修复内容。`,
                    }
                  : m
              )
            );
            return;
          }

          // Auto-insert diagram code into editor (generate flow only)
          if (
            systemPrompt?.includes('PlantUML') ||
            systemPrompt?.includes('Mermaid')
          ) {
            const newContent = content + '\n\n' + fullText;
            setContent(newContent);
          }
        },
        onError: (err) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId
                ? { ...m, content: `❌ ${err.message}`, streaming: false }
                : m
            )
          );
          setStreaming(false);
          streamingRef.current = false;
        },
      });
    },
    [activeConfig, messages, content, setContent]
  );

  sendMessageRef.current = sendMessage;

  // Auto-start PlantUML fix when requested from preview error UI
  useEffect(() => {
    if (!plantUmlFixRequest || !activeConfig) return;
    if (plantUmlFixRequestSeq <= lastHandledFixSeqRef.current) return;
    if (streamingRef.current) return;

    lastHandledFixSeqRef.current = plantUmlFixRequestSeq;

    const { source, errorMessage, errorLine } = plantUmlFixRequest;
    clearPlantUmlFixRequest();
    setFixNotice(null);

    const linePart =
      errorLine !== undefined ? `第 ${errorLine} 行` : '未知行';
    const userSummary = `请修复以下 PlantUML 语法错误（${linePart}）`;

    void sendMessageRef.current?.(userSummary, AI_PROMPTS.plantUMLFix(source, errorMessage, errorLine), {
      isPlantUmlFix: true,
      fixMeta: { originalSource: source, errorMessage, errorLine },
    });
  }, [plantUmlFixRequest, plantUmlFixRequestSeq, activeConfig, clearPlantUmlFixRequest]);

  const handleApplyFix = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    const fix = msg?.plantUmlFix;
    if (!fix || fix.status !== 'pending') return;

    const updated = replacePlantUmlBlock(content, fix.originalSource, fix.proposedSource);
    if (updated === content) {
      setFixNotice('未找到匹配的 PlantUML 代码块，请手动替换。');
      return;
    }

    setContent(updated);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.plantUmlFix
          ? { ...m, plantUmlFix: { ...m.plantUmlFix, status: 'applied' } }
          : m
      )
    );
    setFixNotice('已应用修复，预览将自动刷新。');
  };

  const handleDismissFix = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.plantUmlFix
          ? { ...m, plantUmlFix: { ...m.plantUmlFix, status: 'dismissed' } }
          : m
      )
    );
    setFixNotice(null);
  };

  const handleRevertFix = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    const fix = msg?.plantUmlFix;
    if (!fix || fix.status !== 'applied') return;

    const currentBlock = findPlantUmlBlockSource(content, fix.proposedSource);
    if (currentBlock === undefined) {
      setFixNotice('源码已变更，无法自动回退，请手动恢复。');
      return;
    }

    const reverted = replacePlantUmlBlock(content, fix.proposedSource, fix.originalSource);
    if (reverted === content) {
      setFixNotice('回退失败：未找到已应用的代码块。');
      return;
    }

    setContent(reverted);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.plantUmlFix
          ? { ...m, plantUmlFix: { ...m.plantUmlFix, status: 'reverted' } }
          : m
      )
    );
    setFixNotice('已回退到修复前的 PlantUML 源码。');
  };

  const handleQuickAction = (action: QuickAction) => {
    setShowActions(false);
    if (action === 'expand') {
      sendMessage('请续写这篇笔记', AI_PROMPTS.expand(content));
    } else if (action === 'summarize') {
      sendMessage('请总结要点', AI_PROMPTS.summarize(content));
    } else if (action === 'plantUML') {
      setInput('描述你想要的 PlantUML 图表（如：用户注册流程的时序图）');
    } else if (action === 'mermaid') {
      setInput('描述你想要的 Mermaid 图表（如：项目架构流程图）');
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming || !activeConfig) return;

    const isPlantUML = text.includes('PlantUML') || text.includes('plantuml');
    const isMermaid = text.includes('Mermaid') || text.includes('mermaid') || text.includes('流程图');

    if (isPlantUML) {
      sendMessage(text, AI_PROMPTS.plantUML(text));
    } else if (isMermaid) {
      sendMessage(text, AI_PROMPTS.mermaid(text));
    } else {
      sendMessage(text);
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setStreaming(false);
    streamingRef.current = false;
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  };

  const renderFixActions = (msg: Message) => {
    const fix = msg.plantUmlFix;
    if (!fix || msg.streaming) return null;

    if (fix.status === 'pending') {
      return (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => handleApplyFix(msg.id)}
            className="px-2 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
          >
            应用修复
          </button>
          <button
            type="button"
            onClick={() => handleDismissFix(msg.id)}
            className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
          >
            放弃
          </button>
        </div>
      );
    }

    if (fix.status === 'applied') {
      return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-green-700">✓ 已应用修复</span>
          <button
            type="button"
            onClick={() => handleRevertFix(msg.id)}
            className="px-2 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
          >
            回退
          </button>
        </div>
      );
    }

    if (fix.status === 'reverted') {
      return <p className="mt-2 text-xs text-gray-500">已回退至修复前源码</p>;
    }

    return null;
  };

  if (!activeConfig && aiConfigs.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-center p-4 gap-2">
        <Sparkles size={28} className="text-gray-300" />
        <p className="text-xs text-gray-500">请先在设置中添加 AI 服务商</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-1">
          <Sparkles size={13} className="text-blue-500" />
          <span className="text-xs font-semibold text-gray-700">AI 助手</span>
        </div>
        <div className="relative">
          <select
            value={activeAiConfigId ?? aiConfigs[0]?.id ?? ''}
            onChange={(e) => setActiveAiConfigId(e.target.value)}
            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white appearance-none pr-5 max-w-[90px] truncate"
          >
            {aiConfigs.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-gray-400 text-center pt-4">
            <Sparkles size={20} className="mx-auto mb-2 text-gray-300" />
            开始对话，或使用快捷操作
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`rounded p-2 text-xs whitespace-pre-wrap break-words ${
              msg.role === 'user'
                ? 'bg-blue-50 text-blue-900 ml-4'
                : 'bg-white border border-gray-200 text-gray-800'
            }`}
          >
            {msg.content}
            {msg.streaming && (
              <span className="inline-block w-1.5 h-3 bg-blue-400 ml-0.5 animate-pulse" />
            )}
            {msg.role === 'assistant' && renderFixActions(msg)}
          </div>
        ))}
        {fixNotice && (
          <p className="text-xs text-center text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1">
            {fixNotice}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      <div className="px-2 pb-1 flex-shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowActions(!showActions)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 px-1 py-0.5 rounded transition-colors"
          >
            <Sparkles size={11} />
            快捷操作
            <ChevronDown size={10} className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
          </button>
          {showActions && (
            <div className="absolute bottom-full mb-1 left-0 bg-white border border-gray-200 rounded shadow-lg z-10 w-44">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleQuickAction(a.id)}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                >
                  <div className="font-medium">{a.label}</div>
                  <div className="text-gray-400">{a.desc}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="flex items-end gap-1 px-2 pb-2 flex-shrink-0 border-t border-gray-100 pt-1">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={activeConfig ? `使用 ${activeConfig.model}…` : '请先配置 AI 服务商'}
          disabled={!activeConfig || streaming}
          rows={2}
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 resize-none outline-none focus:border-blue-400 disabled:bg-gray-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        {streaming ? (
          <button
            onClick={handleStop}
            className="p-1.5 bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex-shrink-0"
            title="停止生成"
          >
            <StopCircle size={14} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim() || !activeConfig}
            className="p-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 transition-colors flex-shrink-0"
            title="发送 (Enter)"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
