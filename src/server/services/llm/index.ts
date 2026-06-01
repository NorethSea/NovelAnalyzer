import { OpenAIProvider } from './openai.js';
import { ClaudeProvider } from './claude.js';
import { OllamaProvider } from './ollama.js';
import type { LLMProvider, ChatMessage, LLMProviderConfig } from './types.js';
import { RateLimiter } from './rateLimiter.js';
import { llmConfigDb } from '../../db/index.js';

class RateLimitedProvider implements LLMProvider {
  constructor(private inner: LLMProvider, private rateLimiter: RateLimiter) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    await this.rateLimiter.waitIfNeeded();
    return this.inner.chat(messages);
  }

  async analyze(prompt: string): Promise<string> {
    await this.rateLimiter.waitIfNeeded();
    return this.inner.analyze(prompt);
  }
}

const sharedRateLimiter = new RateLimiter(0);

function buildProvider(providerName: string, config: LLMProviderConfig): LLMProvider {
  switch (providerName) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'claude':
      return new ClaudeProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`不支持的LLM提供商: ${providerName}`);
  }
}

let activeProvider: LLMProvider | null = null;
let activeConfigId: number | null = null;

export async function getLLMProvider(): Promise<LLMProvider> {
  const config = await llmConfigDb.getActive();
  if (!config) {
    throw new Error('未配置LLM，请先在设置页面配置LLM API');
  }

  const providerConfig: LLMProviderConfig = {
    apiKey: config.api_key || undefined,
    baseUrl: config.base_url || undefined,
    model: config.model,
    timeout: config.timeout || 300,
    maxTokens: config.max_tokens || undefined,
  };

  if (activeProvider && activeConfigId === config.id) {
    sharedRateLimiter.updateLimit(config.rpm_limit || 0);
    return activeProvider;
  }

  let provider: LLMProvider = buildProvider(config.provider, providerConfig);

  const rpmLimit = config.rpm_limit || 0;
  if (rpmLimit > 0) {
    sharedRateLimiter.updateLimit(rpmLimit);
    provider = new RateLimitedProvider(provider, sharedRateLimiter);
  } else {
    sharedRateLimiter.updateLimit(0);
  }

  activeProvider = provider;
  activeConfigId = config.id;
  return activeProvider;
}

export function resetProvider() {
  activeProvider = null;
  activeConfigId = null;
}

export function getRateLimiterStats() {
  return sharedRateLimiter.getStats();
}

export type { LLMProvider } from './types.js';
