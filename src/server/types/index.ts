export interface Novel {
  id: number;
  title: string;
  author: string | null;
  file_path: string;
  file_type: 'txt' | 'epub';
  content_summary: string | null;
  status: 'pending' | 'analyzing' | 'completed' | 'error';
  error_message: string | null;
  folder_source: 'folder_a' | 'folder_b' | null;
  file_mtime: number | null;
  file_size: number | null;
  created_at: string;
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

export interface ChunkAnalysis {
  id: number;
  novel_id: number;
  chunk_index: number;
  analysis_result: string | null;
  created_at: string;
}

export interface Preference {
  id: number;
  novel_id: number;
  note: string | null;
  created_at: string;
}

export interface Recommendation {
  id: number;
  novel_id: number;
  category: 'recommended' | 'not_recommended';
  reason: string;
  score: number | null;
  created_at: string;
}

export interface LLMConfig {
  id: number;
  name: string;
  provider: 'openai' | 'claude' | 'ollama';
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

export interface NovelWithAnalysis extends Novel {
  analysis?: Analysis;
}

export interface RecommendationWithNovel extends Recommendation {
  novel?: Novel;
  analysis?: Analysis;
}
