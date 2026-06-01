import fsp from 'fs/promises';
import { EventEmitter } from 'events';
import { parseFile, extractTitle, extractAuthor } from './parser.js';
import { getLLMProvider } from './llm/index.js';
import { novelDb, analysisDb, chunkAnalysisDb, llmConfigDb, runInTransaction } from '../db/index.js';
import { extractJsonObject } from '../utils/text.js';
import type { Novel } from '../types/index.js';

export interface AnalyzeProgress {
  novelId: number;
  title: string;
  status: 'analyzing' | 'completed' | 'error';
  currentChunk?: number;
  totalChunks?: number;
  error?: string;
}

type ProgressCallback = (progress: AnalyzeProgress) => void;

class ProgressBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  on(cb: ProgressCallback) { this.emitter.on('progress', cb); }
  off(cb: ProgressCallback) { this.emitter.off('progress', cb); }
  emit(p: AnalyzeProgress) { this.emitter.emit('progress', p); }
  listenerCount() { return this.emitter.listenerCount('progress'); }
}

export const analyzerEvents = new ProgressBus();

const activeAnalyses = new Set<number>();

export async function analyzeNovel(novelId: number, onProgress?: ProgressCallback): Promise<void> {
  if (activeAnalyses.has(novelId)) {
    throw new Error('该小说正在分析中');
  }
  activeAnalyses.add(novelId);

  const off = onProgress ? (cb: ProgressCallback) => analyzerEvents.off(cb) : null;
  if (onProgress) analyzerEvents.on(onProgress);

  try {
    const novel = await novelDb.getById(novelId);
    if (!novel) throw new Error('小说不存在');

    const config = await llmConfigDb.getOrCreateDefault();
    const chunkSize = config.chunk_size || 200000;
    const overlapRatio = config.overlap_ratio || 0.1;

    const started = await novelDb.tryStartAnalyzing(novelId);
    if (!started) {
      throw new Error('该小说状态不允许分析（可能正在分析中）');
    }

    const emit = (progress: AnalyzeProgress) => analyzerEvents.emit(progress);

    try {
      emit({ novelId, title: novel.title, status: 'analyzing' });

      const content = await parseFile(novel.file_path);

      await chunkAnalysisDb.deleteByNovelId(novelId);

      const chunks = splitContent(content, chunkSize, overlapRatio);

      const chunkResults: { chunk_index: number; analysis_result: string }[] = [];

      if (chunks.length === 1) {
        const result = await analyzeChunk(chunks[0], novel.title);
        const parsed = extractJsonObject<Record<string, unknown>>(result);
        await analysisDb.create({
          novel_id: novelId,
          ...mapAnalysisFields(parsed, { theme: result }),
          raw_response: result,
          model_used: await getActiveModelName(),
          chunk_size: chunkSize,
        });
      } else {
        for (let i = 0; i < chunks.length; i++) {
          emit({
            novelId,
            title: novel.title,
            status: 'analyzing',
            currentChunk: i + 1,
            totalChunks: chunks.length,
          });

          const result = await analyzeChunk(chunks[i], novel.title, i + 1, chunks.length);
          chunkResults.push({ chunk_index: i, analysis_result: result });
        }

        const mergedResult = await mergeChunkResults(chunkResults, novel.title);
        const parsed = extractJsonObject<Record<string, unknown>>(mergedResult);

        await runInTransaction(async () => {
          for (const cr of chunkResults) {
            await chunkAnalysisDb.create({
              novel_id: novelId,
              chunk_index: cr.chunk_index,
              analysis_result: cr.analysis_result,
            });
          }
          await analysisDb.create({
            novel_id: novelId,
            ...mapAnalysisFields(parsed, { overall_summary: mergedResult }),
            raw_response: mergedResult,
            model_used: await getActiveModelName(),
            chunk_size: chunkSize,
          });
        });
      }

      await novelDb.updateStatus(novelId, 'completed');
      emit({ novelId, title: novel.title, status: 'completed' });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await novelDb.updateStatus(novelId, 'error', errorMsg);
      emit({ novelId, title: novel.title, status: 'error', error: errorMsg });
      throw error;
    }
  } finally {
    activeAnalyses.delete(novelId);
    if (onProgress && off) off(onProgress);
  }
}

const ANALYSIS_FIELD_KEYS = [
  'theme', 'plot', 'characters', 'writing_style', 'emotion', 'atmosphere',
  'literary_value', 'narrative_technique', 'symbolism', 'overall_summary',
] as const;

type AnalysisFieldKey = typeof ANALYSIS_FIELD_KEYS[number];

function toStr(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function mapAnalysisFields(parsed: Record<string, unknown> | null, fallback: Partial<Record<AnalysisFieldKey, string>>): Record<AnalysisFieldKey, string | undefined> {
  const out: Partial<Record<AnalysisFieldKey, string | undefined>> = {};
  for (const key of ANALYSIS_FIELD_KEYS) {
    if (parsed && key in parsed) {
      out[key] = toStr(parsed[key]);
    } else if (fallback[key]) {
      out[key] = fallback[key];
    } else {
      out[key] = undefined;
    }
  }
  return out as Record<AnalysisFieldKey, string | undefined>;
}

function splitContent(content: string, chunkSize: number, overlapRatio: number = 0.1): string[] {
  if (content.length <= chunkSize) {
    return [content];
  }

  const overlapSize = Math.floor(chunkSize * overlapRatio);
  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length);

    if (end < content.length) {
      let chunkEnd = end;
      const boundary = start + chunkSize;
      const minBoundary = start + Math.floor(chunkSize * 0.8);

      const paragraphBreak = content.lastIndexOf('\n\n', boundary);
      if (paragraphBreak > minBoundary) {
        chunkEnd = paragraphBreak + 2;
      } else {
        const lineBreak = content.lastIndexOf('\n', boundary);
        if (lineBreak > minBoundary) {
          chunkEnd = lineBreak + 1;
        } else {
          const spaceBreak = content.lastIndexOf(' ', boundary);
          if (spaceBreak > minBoundary) {
            chunkEnd = spaceBreak + 1;
          }
        }
      }

      end = chunkEnd;
    }

    chunks.push(content.substring(start, end));

    if (end >= content.length) break;
    start = end - overlapSize;
  }

  return chunks;
}

export const DEFAULT_PROMPT_ANALYZE = `请先判断小说《{title}》{chunkInfo}的类型（严肃文学 / 类型文学如玄幻/言情/悬疑/科幻/仙侠等 / 混合），再以对应标准展开分析。

{chunkInfo}（如存在）表示这是全文的第 N/M 部分，请仅基于此片段做局部分析，不要给全文结论；未提供则视为全文。

小说内容片段：
{content}

请返回以下 JSON（每项 80-200 字，字段值为字符串；同一字段下，类型不同侧重不同）：

{
  "theme": "主题与核心卖点（严肃文学：思想倾向、核心命题；类型文学：核心爽点、卖点、读者欲罢不能的点）",
  "plot": "本片段的情节结构（故事线、关键转折、节奏起伏——类型文学关注钩子与高潮密度）",
  "characters": "人物塑造（性格、关系、成长弧——类型文学侧重人设魅力、辨识度、CP 感）",
  "writing_style": "写作风格（语言特点、文风、叙事手法——类型文学关注辨识度与可读性）",
  "emotion": "情感（情感基调、情感弧、读者情感反应——共情/刺激/治愈/解压/虐心/甜爽）",
  "atmosphere": "氛围（整体氛围、场景感、基调）",
  "literary_value": "作品价值（严肃文学：文学性与艺术性；类型文学：完成度、独特性、可读性）",
  "narrative_technique": "叙事技巧（叙事结构、时间处理、视角、节奏控制——类型文学关注钩子设置、悬念维持、爽点节奏）",
  "symbolism": "象征与标志手法（严肃文学：象征与隐喻；类型文学：标志性桥段、套路、梗、金手指设计等）",
  "overall_summary": "本片段（或全文）的整体观感总结，60-150 字；如为节选，说明这只是当前可见内容印象"
}

严格 JSON，无 markdown 包裹，无解释文字。`;

export const DEFAULT_PROMPT_MERGE = `以下是小说《{title}》所有片段的分析，请合并为一份完整分析。

合并策略：
1. 先确认作品类型（从片段分析中识别），后续以对应类型标准进行整合——严肃文学看思想深度与艺术性，类型文学看完成度、爽点、节奏、人设魅力。
2. 主题、风格、叙事等贯穿性维度：去重归纳，体现完整脉络，不要简单拼接。
3. 人物、情节：串联所有片段，补全出场顺序与关系；类型文学需保留人设魅力与 CP 关系。
4. 字段值冲突时：取表述更准确、更详细的那一份；如确为演变（人物成长、风格转变），在 overall_summary 中点出。
5. overall_summary：200-400 字，包含作品类型定位、整体评价、推荐理由、适合读者群（严肃文学读者 / 网文爱好者 / 特定类型粉丝 / 不挑类型的休闲读者等）。

各片段分析：
{analyses}

请返回 JSON：
{
  "theme": "...",
  "plot": "...",
  "characters": "...",
  "writing_style": "...",
  "emotion": "...",
  "atmosphere": "...",
  "literary_value": "...",
  "narrative_technique": "...",
  "symbolism": "...",
  "overall_summary": "..."
}

严格 JSON，无 markdown 包裹，无解释文字。`;

async function analyzeChunk(
  content: string,
  title: string,
  chunkIndex?: number,
  totalChunks?: number
): Promise<string> {
  const llm = await getLLMProvider();
  const config = await llmConfigDb.getOrCreateDefault();

  const chunkInfo = chunkIndex ? `（第${chunkIndex}/${totalChunks}部分）` : '';
  const template = config.prompt_analyze || DEFAULT_PROMPT_ANALYZE;

  const prompt = template
    .replace(/{title}/g, title)
    .replace(/{chunkInfo}/g, chunkInfo)
    .replace(/{content}/g, content);

  return await withRetry(() => llm.analyze(prompt));
}

async function mergeChunkResults(
  chunkResults: { chunk_index: number; analysis_result: string | null }[],
  title: string
): Promise<string> {
  const llm = await getLLMProvider();
  const config = await llmConfigDb.getOrCreateDefault();

  const allAnalyses = chunkResults
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map((cr, i) => `\n=== 第${i + 1}部分分析 ===\n${cr.analysis_result || ''}`)
    .join('\n');

  const template = config.prompt_merge || DEFAULT_PROMPT_MERGE;

  const prompt = template
    .replace(/{title}/g, title)
    .replace(/{analyses}/g, allAnalyses);

  return await withRetry(() => llm.analyze(prompt));
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      const isRetryable = err?.name === 'AbortError' || (typeof status === 'number' && RETRYABLE_STATUS.has(status));
      if (!isRetryable || attempt === maxAttempts) break;
      const wait = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`[Analyzer] 调用失败，${wait}ms 后重试 (${attempt}/${maxAttempts})`, err?.message || err);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function getActiveModelName(): Promise<string> {
  const config = await llmConfigDb.getActive();
  return config ? `${config.provider}/${config.model}` : 'unknown';
}

async function statFile(filePath: string): Promise<{ mtime: number; size: number } | null> {
  try {
    const st = await fsp.stat(filePath);
    return { mtime: Math.floor(st.mtimeMs), size: st.size };
  } catch {
    return null;
  }
}

export async function importNovel(
  filePath: string,
  folderSource: 'folder_a' | 'folder_b' | null,
  existing?: Novel
): Promise<{ novel: Novel; status: 'created' | 'skipped' | 'updated' }> {
  const found = existing ?? await novelDb.getByPath(filePath);
  const stat = await statFile(filePath);

  if (found) {
    if (stat && found.file_mtime !== stat.mtime) {
      await runInTransaction(async () => {
        await novelDb.updateFileStats(found.id, stat.mtime, stat.size);
        if (found.status === 'completed') {
          await analysisDb.deleteByNovelId(found.id);
          await chunkAnalysisDb.deleteByNovelId(found.id);
          await novelDb.updateStatus(found.id, 'pending');
        }
      });
      const refreshed = (await novelDb.getById(found.id))!;
      return { novel: refreshed, status: 'updated' };
    }
    return { novel: found, status: 'skipped' };
  }

  let created: Novel | undefined;
  try {
    const content = await parseFile(filePath);
    const title = extractTitle(filePath, content);
    const author = extractAuthor(content);
    const contentSummary = content.substring(0, 500);

    const novel = await novelDb.create({
      title,
      author: author || undefined,
      file_path: filePath,
      file_type: filePath.endsWith('.epub') ? 'epub' : 'txt',
      content_summary: contentSummary,
      folder_source: folderSource || undefined,
      file_mtime: stat?.mtime,
      file_size: stat?.size,
    });
    created = novel;
    return { novel, status: 'created' };
  } catch (err) {
    if (created) {
      try { await novelDb.delete(created.id); } catch {}
    }
    throw err;
  }
}

const IMPORT_CONCURRENCY = 4;

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function importFolder(
  folderPath: string,
  folderSource: 'folder_a' | 'folder_b',
  onProgress?: (imported: number, total: number) => void
): Promise<{ imported: number; skipped: number; deleted: number; updated: number; errors: string[] }> {
  const { scanFolder } = await import('./scanner.js');
  const scanResult = await scanFolder(folderPath);
  const currentFiles = new Set(scanResult.files);

  const dbNovels = await novelDb.getByFolderSource(folderSource);
  const existingByPath = await novelDb.getByPathSet(scanResult.files);
  let imported = 0;
  let skipped = 0;
  let deleted = 0;
  let updated = 0;
  const errors: string[] = [...scanResult.errors];

  await runInTransaction(async () => {
    for (const novel of dbNovels) {
      if (!currentFiles.has(novel.file_path)) {
        try {
          await novelDb.delete(novel.id);
          deleted++;
        } catch (err) {
          errors.push(`删除失败: ${novel.file_path} - ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  });

  await runWithConcurrency(scanResult.files, IMPORT_CONCURRENCY, async (filePath) => {
    try {
      const result = await importNovel(filePath, folderSource, existingByPath.get(filePath));
      if (result.status === 'created') imported++;
      else if (result.status === 'updated') updated++;
      else skipped++;
    } catch (error) {
      errors.push(`导入失败: ${filePath} - ${error instanceof Error ? error.message : String(error)}`);
    }
    if (onProgress) {
      onProgress(imported + skipped + updated, scanResult.files.length);
    }
  });

  return { imported, skipped, deleted, updated, errors };
}
