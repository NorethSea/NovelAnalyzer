import { getDb, saveDb, closeDb, flushDb, runInTransaction } from './schema.js';
export { closeDb, flushDb, runInTransaction };
import type { Novel, Analysis, ChunkAnalysis, Preference, Recommendation, LLMConfig, NovelWithAnalysis, TokenUsageRecord } from '../types/index.js';

type SqlParam = string | number | null;

async function queryAll<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  const db = await getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params as SqlParam[]);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

async function queryOne<T>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
  const results = await queryAll<T>(sql, params);
  return results[0];
}

async function runSql(sql: string, params: SqlParam[] = []): Promise<void> {
  const db = await getDb();
  db.run(sql, params as SqlParam[]);
}

async function getLastInsertId(): Promise<number> {
  const db = await getDb();
  const result = db.exec('SELECT last_insert_rowid() as id');
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0] as number;
  }
  return 0;
}

function persistDb() {
  saveDb();
}

const ANALYSIS_FIELDS = `
  a.id as a_id, a.theme as a_theme, a.plot as a_plot, a.characters as a_characters,
  a.writing_style as a_writing_style, a.emotion as a_emotion, a.atmosphere as a_atmosphere,
  a.literary_value as a_literary_value, a.narrative_technique as a_narrative_technique,
  a.symbolism as a_symbolism, a.overall_summary as a_overall_summary, a.raw_response as a_raw_response,
  a.model_used as a_model_used, a.chunk_size as a_chunk_size, a.created_at as a_created_at
`;

function rowToAnalysis(row: any): Analysis | undefined {
  if (row.a_id == null) return undefined;
  return {
    id: row.a_id,
    novel_id: row.id,
    theme: row.a_theme,
    plot: row.a_plot,
    characters: row.a_characters,
    writing_style: row.a_writing_style,
    emotion: row.a_emotion,
    atmosphere: row.a_atmosphere,
    literary_value: row.a_literary_value,
    narrative_technique: row.a_narrative_technique,
    symbolism: row.a_symbolism,
    overall_summary: row.a_overall_summary,
    raw_response: row.a_raw_response,
    model_used: row.a_model_used,
    chunk_size: row.a_chunk_size,
    created_at: row.a_created_at,
  };
}

function rowToNovel(row: any): Novel {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    file_path: row.file_path,
    file_type: row.file_type,
    content_summary: row.content_summary,
    status: row.status,
    error_message: row.error_message,
    folder_source: row.folder_source,
    file_mtime: row.file_mtime,
    file_size: row.file_size,
    created_at: row.created_at,
  };
}

// Novel operations
export const novelDb = {
  async create(data: { title: string; author?: string; file_path: string; file_type: string; content_summary?: string; folder_source?: string; file_mtime?: number; file_size?: number }): Promise<Novel> {
    await runSql(
      `INSERT INTO novels (title, author, file_path, file_type, content_summary, folder_source, file_mtime, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.title, data.author || null, data.file_path, data.file_type, data.content_summary || null, data.folder_source || null, data.file_mtime ?? null, data.file_size ?? null]
    );
    const id = await getLastInsertId();
    persistDb();
    return (await queryOne<Novel>('SELECT * FROM novels WHERE id = ?', [id]))!;
  },

  async getById(id: number): Promise<Novel | undefined> {
    if (!Number.isInteger(id) || id <= 0) return undefined;
    return queryOne<Novel>('SELECT * FROM novels WHERE id = ?', [id]);
  },

  async getByIds(ids: number[]): Promise<Novel[]> {
    if (ids.length === 0) return [];
    const valid = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
    if (valid.length === 0) return [];
    const placeholders = valid.map(() => '?').join(',');
    return queryAll<Novel>(`SELECT * FROM novels WHERE id IN (${placeholders})`, valid);
  },

  async getByPath(filePath: string): Promise<Novel | undefined> {
    return queryOne<Novel>('SELECT * FROM novels WHERE file_path = ?', [filePath]);
  },

  async getAll(): Promise<Novel[]> {
    return queryAll<Novel>('SELECT * FROM novels ORDER BY created_at DESC');
  },

  async getAllExcludingPreferred(): Promise<Novel[]> {
    return queryAll<Novel>(
      `SELECT n.* FROM novels n
       LEFT JOIN preferences p ON p.novel_id = n.id
       WHERE p.id IS NULL
       ORDER BY n.created_at DESC`
    );
  },

  async getByStatus(status: string): Promise<Novel[]> {
    return queryAll<Novel>('SELECT * FROM novels WHERE status = ? ORDER BY created_at DESC', [status]);
  },

  async getByFolderSource(folderSource: string): Promise<Novel[]> {
    return queryAll<Novel>('SELECT * FROM novels WHERE folder_source = ? ORDER BY created_at DESC', [folderSource]);
  },

  async getByPathSet(filePaths: string[]): Promise<Map<string, Novel>> {
    const map = new Map<string, Novel>();
    if (filePaths.length === 0) return map;
    const placeholders = filePaths.map(() => '?').join(',');
    const novels = await queryAll<Novel>(
      `SELECT * FROM novels WHERE file_path IN (${placeholders})`,
      filePaths
    );
    for (const n of novels) map.set(n.file_path, n);
    return map;
  },

  async getWithAnalysis(id: number): Promise<NovelWithAnalysis | undefined> {
    if (!Number.isInteger(id) || id <= 0) return undefined;
    const row = await queryOne<any>(
      `SELECT n.*, ${ANALYSIS_FIELDS}
       FROM novels n
       LEFT JOIN analyses a ON a.novel_id = n.id
       WHERE n.id = ?`,
      [id]
    );
    if (!row) return undefined;
    return { ...rowToNovel(row), analysis: rowToAnalysis(row) };
  },

  async updateStatus(id: number, status: string, errorMessage?: string): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    if (errorMessage) {
      await runSql('UPDATE novels SET status = ?, error_message = ? WHERE id = ?', [status, errorMessage, id]);
    } else {
      await runSql('UPDATE novels SET status = ?, error_message = NULL WHERE id = ?', [status, id]);
    }
    persistDb();
  },

  async updateSummary(id: number, contentSummary: string): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    await runSql('UPDATE novels SET content_summary = ? WHERE id = ?', [contentSummary, id]);
    persistDb();
  },

  async updateFileStats(id: number, mtime: number, size: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    await runSql('UPDATE novels SET file_mtime = ?, file_size = ? WHERE id = ?', [mtime, size, id]);
    persistDb();
  },

  async tryStartAnalyzing(id: number): Promise<boolean> {
    if (!Number.isInteger(id) || id <= 0) return false;
    const result = await runSql(
      `UPDATE novels SET status = 'analyzing', error_message = NULL
       WHERE id = ? AND status IN ('pending', 'error')`,
      [id]
    );
    persistDb();
    const modified = (db: any) => db.getRowsModified?.() ?? 0;
    const dbInst = await getDb();
    return (dbInst as any).getRowsModified?.() > 0;
  },

  async resetAnalyzingToError(message: string): Promise<number> {
    const dbInst = await getDb();
    dbInst.run("UPDATE novels SET status = 'error', error_message = ? WHERE status = 'analyzing'", [message]);
    const count = (dbInst as any).getRowsModified?.() ?? 0;
    if (count > 0) persistDb();
    return count;
  },

  async delete(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    await runSql('DELETE FROM novels WHERE id = ?', [id]);
    persistDb();
  },

  async count(): Promise<number> {
    const result = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM novels');
    return result?.count || 0;
  }
};

// Analysis operations
export const analysisDb = {
  async create(data: {
    novel_id: number;
    theme?: string;
    plot?: string;
    characters?: string;
    writing_style?: string;
    emotion?: string;
    atmosphere?: string;
    literary_value?: string;
    narrative_technique?: string;
    symbolism?: string;
    overall_summary?: string;
    raw_response?: string;
    model_used?: string;
    chunk_size?: number;
  }): Promise<Analysis> {
    await runSql(
      `INSERT INTO analyses (novel_id, theme, plot, characters, writing_style, emotion, atmosphere,
        literary_value, narrative_technique, symbolism, overall_summary, raw_response, model_used, chunk_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.novel_id, data.theme || null, data.plot || null, data.characters || null,
        data.writing_style || null, data.emotion || null, data.atmosphere || null,
        data.literary_value || null, data.narrative_technique || null, data.symbolism || null,
        data.overall_summary || null, data.raw_response || null, data.model_used || null,
        data.chunk_size || 200000
      ]
    );
    const id = await getLastInsertId();
    persistDb();
    return (await queryOne<Analysis>('SELECT * FROM analyses WHERE id = ?', [id]))!;
  },

  async getByNovelId(novelId: number): Promise<Analysis | undefined> {
    return queryOne<Analysis>('SELECT * FROM analyses WHERE novel_id = ?', [novelId]);
  },

  async getByNovelIds(novelIds: number[]): Promise<Map<number, Analysis>> {
    const map = new Map<number, Analysis>();
    if (novelIds.length === 0) return map;
    const placeholders = novelIds.map(() => '?').join(',');
    const rows = await queryAll<Analysis>(`SELECT * FROM analyses WHERE novel_id IN (${placeholders})`, novelIds);
    for (const r of rows) map.set(r.novel_id, r);
    return map;
  },

  async deleteByNovelId(novelId: number): Promise<void> {
    await runSql('DELETE FROM analyses WHERE novel_id = ?', [novelId]);
    persistDb();
  },

  async deleteByNovelIds(novelIds: number[]): Promise<void> {
    if (novelIds.length === 0) return;
    const valid = Array.from(new Set(novelIds.filter(id => Number.isInteger(id) && id > 0)));
    if (valid.length === 0) return;
    const placeholders = valid.map(() => '?').join(',');
    await runSql(`DELETE FROM analyses WHERE novel_id IN (${placeholders})`, valid);
    persistDb();
  },

  async backfillOverallSummary(): Promise<number> {
    const rows = await queryAll<{
      id: number; theme: string | null; writing_style: string | null;
      literary_value: string | null; plot: string | null;
    }>(
      `SELECT id, theme, writing_style, literary_value, plot
       FROM analyses
       WHERE overall_summary IS NULL OR overall_summary = ''`
    );
    if (rows.length === 0) return 0;
    let count = 0;
    await runInTransaction(async () => {
      for (const r of rows) {
        const parts = [r.theme, r.writing_style, r.literary_value, r.plot]
          .map(s => (s || '').trim())
          .filter(Boolean)
          .map(s => s.replace(/[。；;]+$/g, ''))
          .slice(0, 3);
        if (parts.length === 0) continue;
        const summary = parts.join('；') + '。';
        await runSql('UPDATE analyses SET overall_summary = ? WHERE id = ?', [summary, r.id]);
        count++;
      }
    });
    return count;
  }
};

// Chunk analysis operations
export const chunkAnalysisDb = {
  async create(data: { novel_id: number; chunk_index: number; analysis_result?: string }): Promise<ChunkAnalysis> {
    await runSql(
      `INSERT INTO chunk_analyses (novel_id, chunk_index, analysis_result)
       VALUES (?, ?, ?)`,
      [data.novel_id, data.chunk_index, data.analysis_result || null]
    );
    const id = await getLastInsertId();
    persistDb();
    return (await queryOne<ChunkAnalysis>('SELECT * FROM chunk_analyses WHERE id = ?', [id]))!;
  },

  async getByNovelId(novelId: number): Promise<ChunkAnalysis[]> {
    return queryAll<ChunkAnalysis>('SELECT id, novel_id, chunk_index, analysis_result, created_at FROM chunk_analyses WHERE novel_id = ? ORDER BY chunk_index', [novelId]);
  },

  async deleteByNovelId(novelId: number): Promise<void> {
    await runSql('DELETE FROM chunk_analyses WHERE novel_id = ?', [novelId]);
    persistDb();
  },

  async deleteByNovelIds(novelIds: number[]): Promise<void> {
    if (novelIds.length === 0) return;
    const valid = Array.from(new Set(novelIds.filter(id => Number.isInteger(id) && id > 0)));
    if (valid.length === 0) return;
    const placeholders = valid.map(() => '?').join(',');
    await runSql(`DELETE FROM chunk_analyses WHERE novel_id IN (${placeholders})`, valid);
    persistDb();
  }
};

// Preference operations
export const preferenceDb = {
  async create(data: { novel_id: number; note?: string }): Promise<Preference> {
    await runSql(
      `INSERT OR REPLACE INTO preferences (novel_id, note) VALUES (?, ?)`,
      [data.novel_id, data.note || null]
    );
    const id = await getLastInsertId();
    persistDb();
    return (await queryOne<Preference>('SELECT * FROM preferences WHERE id = ?', [id]))!;
  },

  async getAll(): Promise<Preference[]> {
    return queryAll<Preference>('SELECT * FROM preferences ORDER BY created_at DESC');
  },

  async getAllWithNovels(): Promise<(Preference & { novel?: Novel; analysis?: Analysis })[]> {
    const rows = await queryAll<any>(
      `SELECT p.id as p_id, p.novel_id as p_novel_id, p.note as p_note, p.created_at as p_created_at,
              n.*, ${ANALYSIS_FIELDS}
       FROM preferences p
       LEFT JOIN novels n ON n.id = p.novel_id
       LEFT JOIN analyses a ON a.novel_id = n.id
       ORDER BY p.created_at DESC`
    );
    return rows.map(row => ({
      id: row.p_id,
      novel_id: row.p_novel_id,
      note: row.p_note,
      created_at: row.p_created_at,
      novel: row.id != null ? rowToNovel(row) : undefined,
      analysis: rowToAnalysis(row),
    }));
  },

  async getByNovelId(novelId: number): Promise<Preference | undefined> {
    return queryOne<Preference>('SELECT * FROM preferences WHERE novel_id = ?', [novelId]);
  },

  async getByNovelIds(novelIds: number[]): Promise<Map<number, Preference>> {
    const map = new Map<number, Preference>();
    if (novelIds.length === 0) return map;
    const placeholders = novelIds.map(() => '?').join(',');
    const rows = await queryAll<Preference>(`SELECT * FROM preferences WHERE novel_id IN (${placeholders})`, novelIds);
    for (const r of rows) map.set(r.novel_id, r);
    return map;
  },

  async isPreferred(novelId: number): Promise<boolean> {
    const pref = await queryOne('SELECT 1 FROM preferences WHERE novel_id = ?', [novelId]);
    return !!pref;
  },

  async deleteByNovelId(novelId: number): Promise<void> {
    await runSql('DELETE FROM preferences WHERE novel_id = ?', [novelId]);
    persistDb();
  },

  async getPreferredNovelIds(): Promise<number[]> {
    const rows = await queryAll<{ novel_id: number }>('SELECT novel_id FROM preferences');
    return rows.map(r => r.novel_id);
  }
};

// Recommendation operations
export const recommendationDb = {
  async create(data: { novel_id: number; category: string; reason: string; score?: number }): Promise<Recommendation> {
    await runSql(
      `INSERT OR REPLACE INTO recommendations (novel_id, category, reason, score)
       VALUES (?, ?, ?, ?)`,
      [data.novel_id, data.category, data.reason, data.score || null]
    );
    const id = await getLastInsertId();
    persistDb();
    return (await queryOne<Recommendation>('SELECT * FROM recommendations WHERE id = ?', [id]))!;
  },

  async getAll(): Promise<Recommendation[]> {
    return queryAll<Recommendation>('SELECT * FROM recommendations ORDER BY created_at DESC');
  },

  async getAllWithNovels(category?: string): Promise<(Recommendation & { novel?: Novel; analysis?: Analysis })[]> {
    const where = category ? 'WHERE r.category = ?' : '';
    const params: SqlParam[] = category ? [category] : [];
    const rows = await queryAll<any>(
      `SELECT r.id as r_id, r.novel_id as r_novel_id, r.category as r_category,
              r.reason as r_reason, r.score as r_score, r.created_at as r_created_at,
              n.*, ${ANALYSIS_FIELDS}
       FROM recommendations r
       LEFT JOIN novels n ON n.id = r.novel_id
       LEFT JOIN analyses a ON a.novel_id = n.id
       ${where}
       ORDER BY r.created_at DESC`,
      params
    );
    return rows.map(row => ({
      id: row.r_id,
      novel_id: row.r_novel_id,
      category: row.r_category,
      reason: row.r_reason,
      score: row.r_score,
      created_at: row.r_created_at,
      novel: row.id != null ? rowToNovel(row) : undefined,
      analysis: rowToAnalysis(row),
    }));
  },

  async getByCategory(category: string): Promise<Recommendation[]> {
    return queryAll<Recommendation>('SELECT * FROM recommendations WHERE category = ? ORDER BY created_at DESC', [category]);
  },

  async deleteAll(): Promise<void> {
    await runSql('DELETE FROM recommendations');
    persistDb();
  }
};

// LLM config operations
const LLM_CONFIG_FIELDS = new Set([
  'name', 'provider', 'api_key', 'base_url', 'model', 'chunk_size', 'overlap_ratio',
  'rpm_limit', 'timeout', 'max_tokens', 'prompt_analyze', 'prompt_merge', 'prompt_recommend',
  'folder_a', 'folder_b', 'auto_scan', 'is_active',
] as const);

export const llmConfigDb = {
  async getActive(): Promise<LLMConfig | undefined> {
    return queryOne<LLMConfig>('SELECT * FROM llm_configs WHERE is_active = 1 LIMIT 1');
  },

  async getAll(): Promise<LLMConfig[]> {
    return queryAll<LLMConfig>('SELECT * FROM llm_configs ORDER BY created_at DESC');
  },

  async create(data: {
    name?: string;
    provider: string;
    api_key?: string;
    base_url?: string;
    model: string;
    chunk_size?: number;
    overlap_ratio?: number;
    rpm_limit?: number;
    timeout?: number;
    max_tokens?: number;
    prompt_analyze?: string;
    prompt_merge?: string;
    prompt_recommend?: string;
    folder_a?: string;
    folder_b?: string;
    auto_scan?: number;
  }): Promise<LLMConfig> {
    await runSql(
      `INSERT INTO llm_configs (name, provider, api_key, base_url, model, chunk_size, overlap_ratio, rpm_limit, timeout, max_tokens, prompt_analyze, prompt_merge, prompt_recommend, folder_a, folder_b, auto_scan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name || '', data.provider, data.api_key || null, data.base_url || null, data.model,
        data.chunk_size || 200000, data.overlap_ratio || 0.1, data.rpm_limit || 0, data.timeout || 300, data.max_tokens || null,
        data.prompt_analyze || null, data.prompt_merge || null, data.prompt_recommend || null,
        data.folder_a || null, data.folder_b || null, data.auto_scan !== undefined ? data.auto_scan : 1
      ]
    );
    const id = await getLastInsertId();
    persistDb();
    return (await queryOne<LLMConfig>('SELECT * FROM llm_configs WHERE id = ?', [id]))!;
  },

  async update(id: number, data: Record<string, unknown>): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    const fields: string[] = [];
    const values: SqlParam[] = [];
    for (const key of LLM_CONFIG_FIELDS) {
      if (key in data) {
        fields.push(`${key} = ?`);
        values.push(data[key] as SqlParam);
      }
    }
    if (fields.length === 0) return;
    values.push(id);
    await runSql(`UPDATE llm_configs SET ${fields.join(', ')} WHERE id = ?`, values);
    persistDb();
  },

  async setActive(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    await runSql('UPDATE llm_configs SET is_active = 0');
    await runSql('UPDATE llm_configs SET is_active = 1 WHERE id = ?', [id]);
    persistDb();
  },

  async delete(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    await runSql('DELETE FROM llm_configs WHERE id = ? AND is_active = 0', [id]);
    persistDb();
  },

  async getOrCreateDefault(): Promise<LLMConfig> {
    let config = await this.getActive();
    if (!config) {
      config = await this.create({
        provider: 'openai',
        model: 'gpt-4o',
        chunk_size: 200000,
        overlap_ratio: 0.1,
        auto_scan: 1
      });
      await this.setActive(config.id);
    }
    return config;
  }
};

export const tokenUsageDb = {
  async record(data: {
    model: string;
    provider: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }): Promise<void> {
    await runSql(
      `INSERT INTO token_usage (model, provider, prompt_tokens, completion_tokens, total_tokens)
       VALUES (?, ?, ?, ?, ?)`,
      [data.model, data.provider, data.prompt_tokens, data.completion_tokens, data.total_tokens]
    );
    persistDb();
  },

  async getStats(): Promise<{
    total_calls: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_tokens: number;
    by_model: { model: string; calls: number; total_tokens: number }[];
    by_provider: { provider: string; calls: number; total_tokens: number }[];
  }> {
    const totals = await queryOne<any>('SELECT COUNT(*) as total_calls, COALESCE(SUM(prompt_tokens),0) as total_prompt_tokens, COALESCE(SUM(completion_tokens),0) as total_completion_tokens, COALESCE(SUM(total_tokens),0) as total_tokens FROM token_usage') || {
      total_calls: 0, total_prompt_tokens: 0, total_completion_tokens: 0, total_tokens: 0,
    };
    const byModelRows = await queryAll<any>('SELECT model, COUNT(*) as calls, COALESCE(SUM(total_tokens),0) as total_tokens FROM token_usage GROUP BY model ORDER BY total_tokens DESC');
    const byProviderRows = await queryAll<any>('SELECT provider, COUNT(*) as calls, COALESCE(SUM(total_tokens),0) as total_tokens FROM token_usage GROUP BY provider ORDER BY total_tokens DESC');
    return {
      ...totals,
      by_model: byModelRows,
      by_provider: byProviderRows,
    };
  },

  async clear(): Promise<void> {
    await runSql('DELETE FROM token_usage');
    persistDb();
  },
};

// Batch job persistence
export interface BatchJobState {
  id?: number;
  type: 'analyze' | 'recommend';
  status: 'idle' | 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  current: string;
  novel_ids: number[];
}

const BATCH_JOB_FIELDS = new Set([
  'type', 'status', 'total', 'completed', 'failed', 'current', 'novel_ids',
] as const);

export const batchJobDb = {
  async getCurrent(type: 'analyze' | 'recommend' = 'analyze'): Promise<BatchJobState | null> {
    const row = await queryOne<any>(
      'SELECT * FROM batch_jobs WHERE type = ? ORDER BY id DESC LIMIT 1',
      [type]
    );
    if (!row) return null;
    let novel_ids: number[] = [];
    try {
      const parsed = JSON.parse(row.novel_ids || '[]');
      novel_ids = Array.isArray(parsed) ? parsed.filter(n => Number.isInteger(n)) : [];
    } catch (e) {
      console.warn('[batchJobDb] 解析 novel_ids 失败:', e);
    }
    return {
      id: row.id,
      type: row.type || 'analyze',
      status: row.status,
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      current: row.current || '',
      novel_ids,
    };
  },

  async start(novelIds: number[], type: 'analyze' | 'recommend' = 'analyze'): Promise<void> {
    await runSql('DELETE FROM batch_jobs WHERE type = ?', [type]);
    await runSql(
      `INSERT INTO batch_jobs (type, status, total, completed, failed, current, novel_ids)
       VALUES (?, 'running', ?, 0, 0, '', ?)`,
      [type, novelIds.length, JSON.stringify(novelIds)]
    );
    persistDb();
  },

  async update(data: Record<string, unknown>, type: 'analyze' | 'recommend' = 'analyze'): Promise<void> {
    const fields: string[] = [];
    const values: SqlParam[] = [];
    for (const key of BATCH_JOB_FIELDS) {
      if (key in data) {
        fields.push(`${key} = ?`);
        values.push(data[key] as SqlParam);
      }
    }
    if (fields.length === 0) return;
    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(type);
    await runSql(
      `UPDATE batch_jobs SET ${fields.join(', ')} WHERE id = (SELECT id FROM batch_jobs WHERE type = ? ORDER BY id DESC LIMIT 1)`,
      values
    );
    persistDb();
  },

  async finish(type: 'analyze' | 'recommend' = 'analyze', status: 'completed' | 'failed' = 'completed'): Promise<void> {
    await this.update({ status, current: '' }, type);
  },

  async recoverIfStuck(type?: 'analyze' | 'recommend'): Promise<void> {
    if (type) {
      await runSql("UPDATE batch_jobs SET status = 'failed', current = '' WHERE status = 'running' AND type = ?", [type]);
    } else {
      await runSql("UPDATE batch_jobs SET status = 'failed', current = '' WHERE status = 'running'");
    }
    persistDb();
  }
};
