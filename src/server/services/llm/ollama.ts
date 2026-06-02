import type { LLMProvider, LLMProviderConfig, ChatMessage } from './types.js';
import { ANALYZE_SYSTEM_PROMPT } from './types.js';
import { tokenUsageDb } from '../../db/index.js';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private timeout: number;

  constructor(config: LLMProviderConfig) {
    this.baseUrl = (config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = config.model || process.env.OLLAMA_MODEL || 'llama3';
    this.timeout = (config.timeout || 300) * 1000;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const promptTokens = data.prompt_eval_count || 0;
      const completionTokens = data.eval_count || 0;
      if (promptTokens > 0 || completionTokens > 0) {
        tokenUsageDb.record({
          model: this.model,
          provider: 'ollama',
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        }).catch(err => console.error('[TokenUsage] 记录失败:', err));
      }
      return data.message?.content || '';
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const timeoutSec = this.timeout / 1000;
        throw new Error(`Ollama 请求超时（${timeoutSec}秒），请尝试：1. 增大超时时间 2. 减小分块大小 3. 使用更快的模型`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async analyze(prompt: string): Promise<string> {
    return this.chat([
      { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]);
  }
}
