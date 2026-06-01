import { getLLMProvider } from './llm/index.js';
import { novelDb, analysisDb, preferenceDb, recommendationDb, llmConfigDb } from '../db/index.js';
import type { Novel, Analysis } from '../types/index.js';
import { extractJsonObject, truncateString } from '../utils/text.js';

export interface RecommendationResult {
  novelId: number;
  category: 'recommended' | 'not_recommended';
  reason: string;
  score: number;
}

const MAX_PREFERRED = 5;
const FIELD_MAX = 400;

export const DEFAULT_PROMPT_RECOMMEND = `你是一名小说推荐专家，兼顾严肃文学读者与类型文学爱好者。基于用户已标记喜欢的小说的分析特征，判断候选小说是否值得推荐。

用户偏好（喜欢的小说的分析特征）：
{preferences}

候选小说：《{candidateTitle}》
候选分析：
{candidateAnalysis}

判断维度（按重要性，结合作品类型综合权衡）：
1. 题材类型与设定：玄幻/言情/悬疑/科幻/历史/严肃文学等大类是否匹配。
2. 核心卖点（主题/爽点/情感基调）：是否契合用户偏好。
3. 写作风格与可读性：语言质感、节奏控制是否对味。
4. 人物塑造与代入感：人设魅力、CP 感、共情点是否一致。
5. 整体质量与完成度（严肃文学看思想深度，类型文学看爽点密度与不烂尾）。

请返回 JSON：
{
  "category": "recommended" | "not_recommended",
  "reason": "约 150-200 字，列出主要匹配点或冲突点",
  "score": 0.0-1.0 的相似度评分（与用户偏好的总体相似度；与 category 相关但不等同——例如相似但用户已读腻，或质量差距大，可不推荐）
}

严格 JSON，无 markdown 包裹，无解释文字。
若候选分析信息明显不足，将 score 设为 0.3，category 设为 "not_recommended"，并在 reason 中说明"信息不足"。`;

export async function generateRecommendations(
  onProgress?: (current: string) => void
): Promise<RecommendationResult[]> {
  const preferredIds = await preferenceDb.getPreferredNovelIds();
  if (preferredIds.length === 0) {
    throw new Error('请先标记至少一本喜欢的小说作为推荐依据');
  }

  const completedNovels = await novelDb.getByStatus('completed');
  const allAnalyses = await analysisDb.getByNovelIds(completedNovels.map(n => n.id));
  const novelById = new Map(completedNovels.map(n => [n.id, n]));

  const preferredAnalyses: { novel: Novel; analysis: Analysis }[] = [];
  for (const id of preferredIds.slice(0, MAX_PREFERRED)) {
    const novel = novelById.get(id) || await novelDb.getById(id);
    const analysis = allAnalyses.get(id) || await analysisDb.getByNovelId(id);
    if (novel && analysis) {
      preferredAnalyses.push({ novel, analysis });
    }
  }

  if (preferredAnalyses.length === 0) {
    throw new Error('喜欢的小说需要有分析结果才能生成推荐');
  }

  const preferredSet = new Set(preferredIds);
  const candidateNovels = completedNovels.filter(n => !preferredSet.has(n.id));

  const results: RecommendationResult[] = [];

  for (const candidate of candidateNovels) {
    const candidateAnalysis = allAnalyses.get(candidate.id);
    if (!candidateAnalysis) continue;
    onProgress?.(candidate.title);

    try {
      const result = await analyzeRecommendation(preferredAnalyses, candidate, candidateAnalysis);
      results.push(result);

      await recommendationDb.create({
        novel_id: candidate.id,
        category: result.category,
        reason: result.reason,
        score: result.score,
      });
    } catch (error) {
      console.error(`推荐分析失败: ${candidate.title}`, error);
    }
  }

  return results;
}

function compactAnalysis(a: Analysis): string {
  const summary = a.overall_summary
    || [a.theme, a.writing_style, a.literary_value].filter(Boolean).join('；')
    || '（无）';
  return [
    `主题: ${truncateString(a.theme, FIELD_MAX)}`,
    `情节: ${truncateString(a.plot, FIELD_MAX)}`,
    `人物: ${truncateString(a.characters, FIELD_MAX)}`,
    `写作风格: ${truncateString(a.writing_style, FIELD_MAX)}`,
    `情感: ${truncateString(a.emotion, FIELD_MAX)}`,
    `氛围: ${truncateString(a.atmosphere, FIELD_MAX)}`,
    `文学价值: ${truncateString(a.literary_value, FIELD_MAX)}`,
    `叙事技巧: ${truncateString(a.narrative_technique, FIELD_MAX)}`,
    `象征意义: ${truncateString(a.symbolism, FIELD_MAX)}`,
    `综合总结: ${truncateString(summary, FIELD_MAX)}`,
  ].join('\n');
}

async function analyzeRecommendation(
  preferredAnalyses: { novel: Novel; analysis: Analysis }[],
  candidate: Novel,
  candidateAnalysis: Analysis
): Promise<RecommendationResult> {
  const llm = await getLLMProvider();
  const config = await llmConfigDb.getOrCreateDefault();

  const preferencesText = preferredAnalyses.map((pa, i) =>
    `\n=== 喜欢的小说 ${i + 1}: ${pa.novel.title} ===\n${compactAnalysis(pa.analysis)}`
  ).join('\n');

  const candidateText = compactAnalysis(candidateAnalysis);

  const template = config.prompt_recommend || DEFAULT_PROMPT_RECOMMEND;
  const prompt = template
    .replace(/{preferences}/g, preferencesText)
    .replace(/{candidateTitle}/g, candidate.title)
    .replace(/{candidateAnalysis}/g, candidateText);

  const response = await llm.analyze(prompt);

  const parsed = extractJsonObject<{ category?: string; reason?: string; score?: number }>(response);

  if (!parsed) {
    return {
      novelId: candidate.id,
      category: 'not_recommended',
      reason: '无法解析推荐结果',
      score: 0.5,
    };
  }

  return {
    novelId: candidate.id,
    category: parsed.category === 'recommended' ? 'recommended' : 'not_recommended',
    reason: typeof parsed.reason === 'string' ? parsed.reason : '无法分析',
    score: typeof parsed.score === 'number' && parsed.score >= 0 && parsed.score <= 1
      ? parsed.score
      : 0.5,
  };
}
