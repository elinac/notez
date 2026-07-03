/**
 * AI Service — OpenAI-compatible streaming API client
 * Works with OpenAI, Ollama (/v1 endpoint), and any custom OpenAI-compatible provider.
 */
import type { AiProviderConfig } from '../store/useSettingsStore';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: Error) => void;
}

/**
 * Send a streaming chat completion request.
 * Calls onToken for each streamed chunk, onDone when finished.
 */
export async function streamChat(
  config: AiProviderConfig,
  messages: ChatMessage[],
  { onToken, onDone, onError }: StreamCallbacks
): Promise<void> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Ollama with key "ollama" doesn't need Authorization, but sending it is harmless
  if (config.apiKey && config.apiKey !== 'ollama') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
      }),
    });
  } catch (err) {
    onError(new Error(`网络请求失败: ${String(err)}`));
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    onError(new Error(`API 错误 ${response.status}: ${text}`));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError(new Error('响应体为空'));
    return;
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep last incomplete line in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            fullText += delta;
            onToken(delta);
          }
        } catch {
          // Ignore malformed JSON chunks
        }
      }
    }
  } catch (err) {
    onError(new Error(`流读取失败: ${String(err)}`));
    return;
  }

  onDone(fullText);
}

/**
 * Test connectivity: fetch model list from provider.
 * Returns true if successful.
 */
export async function testConnection(config: AiProviderConfig): Promise<{ ok: boolean; message: string }> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/models`;
  const headers: Record<string, string> = {};
  if (config.apiKey && config.apiKey !== 'ollama') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      return { ok: true, message: '连接成功 ✓' };
    }
    return { ok: false, message: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: `连接失败: ${String(err)}` };
  }
}

// ── Built-in prompt templates ────────────────────────────────────────────────

export const AI_PROMPTS = {
  /** Continue/expand current note content */
  expand: (content: string) =>
    `你是一个专业的笔记助手。请根据以下笔记内容，继续扩展和完善，保持相同的写作风格和 Markdown 格式。只输出新增内容，不重复已有内容。\n\n已有内容：\n${content}`,

  /** Summarize current note */
  summarize: (content: string) =>
    `请用简洁的中文总结以下笔记的核心要点，以 Markdown 格式输出（使用 bullet points）：\n\n${content}`,

  /** Generate PlantUML from description */
  plantUML: (desc: string) =>
    `请根据以下描述生成一段 PlantUML 代码。只输出 PlantUML 代码块，不要其他说明：\n\n${desc}`,

  /** Generate Mermaid from description */
  mermaid: (desc: string) =>
    `请根据以下描述生成一段 Mermaid 图表代码。只输出 Mermaid 代码块，不要其他说明：\n\n${desc}`,

  /** Fix broken PlantUML source after render failure */
  plantUMLFix: (source: string, error: string, line?: number) => {
    const lineHint =
      line !== undefined ? `错误约在第 ${line} 行。` : '未能定位具体行号。';
    return `你是 PlantUML 语法修复专家。用户以下 PlantUML 代码渲染失败（${lineHint}）。

错误信息：
${error}

请：
1. 用简短中文说明错误原因（2-4 句）
2. 给出修正后的完整 PlantUML 代码，放在唯一的 \`\`\`plantuml 代码块中
3. 不要输出多个代码块，不要省略 @startuml / @enduml

待修复源码：
\`\`\`plantuml
${source}
\`\`\``;
  },

  /** Free chat with context */
  chat: (systemPrompt: string) => systemPrompt,
};
