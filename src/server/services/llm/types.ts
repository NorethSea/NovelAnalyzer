export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  chat(messages: ChatMessage[]): Promise<string>;
  analyze(prompt: string): Promise<string>;
}

export interface LLMProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  timeout?: number;
  maxTokens?: number;
}

export const ANALYZE_SYSTEM_PROMPT = `你是一名资深小说阅读顾问，熟悉各种类型的小说——严肃文学、网络小说、轻小说、武侠/仙侠/玄幻、科幻、悬疑、言情、历史、推理、无限流等。

要求：
1. 类型感知：先判断作品属于何种类型（严肃文学 / 类型文学 / 混合），再以对应的评论标准展开——严肃文学看思想深度与艺术性，类型文学看完成度、爽点、节奏、人设魅力与可读性。
2. 客观：分析须基于文本实际呈现，避免剧透，避免无依据的主观褒贬。
3. 平衡：既不一味吹捧"文学性"，也不流于读后感式的泛泛而谈。
4. 输出：仅返回合法 JSON（不要包裹 markdown 代码块，不要附加解释文字）。
5. 边界：文本不足或某项不适用时，该字段宁简勿编；不存在的维度可写"无明显特征"。`;
