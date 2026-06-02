const API_BASE = '/api';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface RequestOptions extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { signal: externalSignal, timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${url}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw new Error('请求被取消或超时');
    }
    throw new Error(err?.message || '网络错误');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = errorBody?.error || `请求失败 (${response.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export interface Novel {
  id: number;
  title: string;
  author: string | null;
  file_path: string;
  file_type: string;
  content_summary: string | null;
  status: string;
  error_message: string | null;
  folder_source: string | null;
  file_mtime: number | null;
  file_size: number | null;
  created_at: string;
  analysis?: Analysis;
}

export interface Analysis {
  id: number;
  novel_id: number;
  theme: string | null;
  plot: string | null;
  characters: string | null;
  writing_style: string | null;
  emotion: string | null;
  atmosphere: string | null;
  literary_value: string | null;
  narrative_technique: string | null;
  symbolism: string | null;
  overall_summary: string | null;
  raw_response: string | null;
  model_used: string | null;
  chunk_size: number;
  created_at: string;
}

export interface Preference {
  id: number;
  novel_id: number;
  note: string | null;
  created_at: string;
  novel?: Novel;
  analysis?: Analysis;
}

export interface Recommendation {
  id: number;
  novel_id: number;
  category: string;
  reason: string;
  score: number | null;
  created_at: string;
  novel?: Novel;
  analysis?: Analysis;
}

export interface LLMConfig {
  id: number;
  name: string;
  provider: string;
  api_key: string | null;
  base_url: string | null;
  model: string;
  chunk_size: number;
  overlap_ratio: number;
  rpm_limit: number;
  timeout: number;
  max_tokens: number | null;
  prompt_analyze: string | null;
  prompt_merge: string | null;
  prompt_recommend: string | null;
  folder_a: string | null;
  folder_b: string | null;
  auto_scan: number;
  is_active: number;
  created_at: string;
}

export interface AnalysisProgress {
  status: string;
  currentChunk?: number;
  totalChunks?: number;
}

export const api = {
  novels: {
    list: () => request<Novel[]>('/novels'),
    listAll: () => request<Novel[]>('/novels/all'),
    get: (id: number) => request<Novel>(`/novels/${id}`),
    delete: (id: number, deleteFile = false) => {
      const params = new URLSearchParams({ deleteFile: String(deleteFile) });
      return request(`/novels/${id}?${params}`, { method: 'DELETE' });
    },
    deleteAnalysis: (id: number) => request(`/novels/${id}/delete-analysis`, { method: 'POST' }),
    batchDeleteAnalysis: (ids: number[]) => request<{ message: string; count: number }>('/novels/batch-delete-analysis', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
    analyze: (id: number) => request(`/novels/${id}/analyze`, { method: 'POST' }),
    refreshSummary: (id: number) => request<{ message: string; content_summary: string }>(`/novels/${id}/refresh-summary`, { method: 'POST' }),
    batchAnalyze: (ids: number[]) => request<{ message: string; total: number }>('/novels/batch-analyze', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
    getBatchStatus: () => request<{ running: boolean; total: number; completed: number; failed: number; current: string }>('/novels/batch-analyze/status'),
    getStatus: (id: number) => request<{ novelId: number; status: string; progress: AnalysisProgress | null }>(`/novels/${id}/status`),
    importFolderA: () => request<{ imported: number; skipped: number; deleted: number; updated: number; errors: string[] }>('/novels/import/folder-a', { method: 'POST' }),
    importFolderB: () => request<{ imported: number; skipped: number; deleted: number; updated: number; errors: string[] }>('/novels/import/folder-b', { method: 'POST' }),
  },
  preferences: {
    list: () => request<Preference[]>('/preferences'),
    like: (novelId: number, note?: string) => request('/preferences/like', {
      method: 'POST',
      body: JSON.stringify({ novelId, note }),
    }),
    unlike: (novelId: number) => request('/preferences/unlike', {
      method: 'POST',
      body: JSON.stringify({ novelId }),
    }),
    check: (novelId: number) => request<{ isPreferred: boolean }>(`/preferences/check/${novelId}`),
  },
  recommendations: {
    list: () => request<Recommendation[]>('/recommendations'),
    getRecommended: () => request<Recommendation[]>('/recommendations/recommended'),
    getNotRecommended: () => request<Recommendation[]>('/recommendations/not-recommended'),
    generate: () => request('/recommendations/generate', { method: 'POST' }),
    getGenerateStatus: () => request<{ running: boolean; total: number; completed: number; failed: number; current: string }>('/recommendations/generate/status'),
  },
  config: {
    get: () => request<LLMConfig>('/config'),
    getDefaults: () => request<{ prompt_analyze: string; prompt_merge: string; prompt_recommend: string }>('/config/defaults'),
    update: (data: Partial<LLMConfig>) => request<LLMConfig>('/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    test: () => request<{ success: boolean; message?: string; error?: string }>('/config/test', { method: 'POST', timeoutMs: 120_000 }),
    getPresets: () => request<{ id: number; name: string; is_active: number; provider: string; model: string; created_at: string }[]>('/config/presets'),
    savePreset: (name: string, config?: Record<string, unknown>) => request<{ id: number; name: string }>('/config/presets', {
      method: 'POST',
      body: JSON.stringify({ name, ...config }),
    }),
    renamePreset: (id: number, name: string) => request(`/config/presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
    activatePreset: (id: number) => request<LLMConfig>(`/config/presets/${id}/activate`, { method: 'PUT' }),
    deletePreset: (id: number) => request(`/config/presets/${id}`, { method: 'DELETE' }),
    getTokenUsage: () => request<{
      total_calls: number;
      total_prompt_tokens: number;
      total_completion_tokens: number;
      total_tokens: number;
      by_model: { model: string; calls: number; total_tokens: number }[];
      by_provider: { provider: string; calls: number; total_tokens: number }[];
    }>('/config/token-usage'),
    clearTokenUsage: () => request<{ success: boolean }>('/config/token-usage', { method: 'DELETE' }),
  },
  folders: {
    resolve: (name: string) => {
      const params = new URLSearchParams({ name });
      return request<{ resolved: string | null; candidates: string[] }>(`/folders/resolve?${params}`);
    },
  },
};
