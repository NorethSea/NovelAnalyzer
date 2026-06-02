import type { LLMProvider, LLMProviderConfig, ChatMessage } from './types.js';
import { ANALYZE_SYSTEM_PROMPT } from './types.js';
import { tokenUsageDb } from '../../db/index.js';

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private timeout: number;
  private maxTokens: number | undefined;

  constructor(config: LLMProviderConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseURL = (config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = config.model || process.env.OPENAI_MODEL || 'gpt-4o';
    this.timeout = (config.timeout || 300) * 1000;
    this.maxTokens = config.maxTokens;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const url = `${this.baseURL}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.7,
    };
    if (this.maxTokens) body.max_tokens = this.maxTokens;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`OpenAI 请求超时（${this.timeout / 1000}秒）`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`LLM API ${response.status}: ${responseText.substring(0, 200)}`);
    }

    if (!responseText || responseText.trim().length === 0) {
      throw new Error('LLM API 返回空响应');
    }

    const data = JSON.parse(responseText);
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`LLM API 无内容返回`);
    }

    if (data.usage) {
      tokenUsageDb.record({
        model: this.model,
        provider: 'openai',
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
        total_tokens: data.usage.total_tokens || 0,
      }).catch(err => console.error('[TokenUsage] 记录失败:', err));
    }

    return content;
  }

  async analyze(prompt: string): Promise<string> {
    return this.chat([
      { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]);
  }
}
