import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMProviderConfig, ChatMessage } from './types.js';
import { ANALYZE_SYSTEM_PROMPT } from './types.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private timeoutMs: number;
  private maxTokens: number;

  constructor(config: LLMProviderConfig) {
    this.timeoutMs = (config.timeout || 300) * 1000;
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.CLAUDE_API_KEY,
      baseURL: config.baseUrl || undefined,
      timeout: this.timeoutMs,
    });
    this.model = config.model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 8192;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role !== 'system');

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemMsg?.content || '你是一个有帮助的助手。',
        messages: userMsgs.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        })),
      });

      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock?.text || '';
    } catch (err: any) {
      if (err?.name === 'APITimeoutError' || err?.status === 408) {
        throw new Error(`Claude 请求超时（${this.timeoutMs / 1000}秒）`);
      }
      throw err;
    }
  }

  async analyze(prompt: string): Promise<string> {
    return this.chat([
      { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]);
  }
}
