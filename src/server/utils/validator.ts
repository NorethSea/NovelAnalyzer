import { HttpError } from './asyncHandler.js';

const VALID_PROVIDERS = new Set(['openai', 'claude', 'ollama']);

export interface ValidatedLLMConfig {
  name?: string;
  provider?: string;
  api_key?: string | null;
  base_url?: string | null;
  model?: string;
  chunk_size?: number;
  overlap_ratio?: number;
  rpm_limit?: number;
  timeout?: number;
  max_tokens?: number | null;
  prompt_analyze?: string | null;
  prompt_merge?: string | null;
  prompt_recommend?: string | null;
  folder_a?: string | null;
  folder_b?: string | null;
  auto_scan?: number;
}

function optionalString(v: unknown, max = 50000): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new HttpError(400, '字段类型必须为字符串');
  if (v.length > max) throw new HttpError(400, `字段长度不能超过 ${max} 字符`);
  return v;
}

function optionalNumber(v: unknown, min: number, max: number, name: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${name} 必须为有效数字`);
  if (n < min || n > max) throw new HttpError(400, `${name} 必须在 ${min}-${max} 之间`);
  return n;
}

function optionalInteger(v: unknown, min: number, max: number, name: string): number | undefined {
  const n = optionalNumber(v, min, max, name);
  if (n === undefined) return undefined;
  return Math.round(n);
}

function optionalBool(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === 1 || v === 0) return v;
  if (v === '1' || v === 'true') return 1;
  if (v === '0' || v === 'false') return 0;
  throw new HttpError(400, '布尔字段值无效');
}

function isSafeFolderPath(v: string): boolean {
  if (v.length > 500) return false;
  if (v.includes('\0')) return false;
  return true;
}

export function validateLLMConfigUpdate(body: any): ValidatedLLMConfig {
  const out: ValidatedLLMConfig = {};

  if ('name' in body) out.name = optionalString(body.name, 200) || '';
  if ('provider' in body) {
    const p = body.provider;
    if (p !== undefined && p !== null && p !== '') {
      if (typeof p !== 'string' || !VALID_PROVIDERS.has(p)) {
        throw new HttpError(400, `provider 必须是 ${Array.from(VALID_PROVIDERS).join('/')} 之一`);
      }
      out.provider = p;
    }
  }
  if ('api_key' in body) out.api_key = optionalString(body.api_key, 1000);
  if ('base_url' in body) {
    const u = optionalString(body.base_url, 500);
    if (u && !/^https?:\/\//i.test(u)) throw new HttpError(400, 'base_url 必须以 http(s):// 开头');
    out.base_url = u;
  }
  if ('model' in body) {
    const m = optionalString(body.model, 200);
    if (m !== undefined && m !== null && m !== '') out.model = m;
  }
  if ('chunk_size' in body) {
    const n = optionalInteger(body.chunk_size, 1000, 10_000_000, 'chunk_size');
    if (n !== undefined) out.chunk_size = n;
  }
  if ('overlap_ratio' in body) {
    const n = optionalNumber(body.overlap_ratio, 0, 0.9, 'overlap_ratio');
    if (n !== undefined) out.overlap_ratio = n;
  }
  if ('rpm_limit' in body) {
    const n = optionalInteger(body.rpm_limit, 0, 10000, 'rpm_limit');
    if (n !== undefined) out.rpm_limit = n;
  }
  if ('timeout' in body) {
    const n = optionalInteger(body.timeout, 5, 3600, 'timeout');
    if (n !== undefined) out.timeout = n;
  }
  if ('max_tokens' in body) {
    if (body.max_tokens === null || body.max_tokens === '') {
      out.max_tokens = null;
    } else {
      const n = optionalInteger(body.max_tokens, 100, 100000, 'max_tokens');
      if (n !== undefined) out.max_tokens = n;
    }
  }
  if ('prompt_analyze' in body) out.prompt_analyze = optionalString(body.prompt_analyze);
  if ('prompt_merge' in body) out.prompt_merge = optionalString(body.prompt_merge);
  if ('prompt_recommend' in body) out.prompt_recommend = optionalString(body.prompt_recommend);
  if ('folder_a' in body) {
    const v = optionalString(body.folder_a, 5000);
    if (v !== undefined && v !== null && !isSafeFolderPath(v)) throw new HttpError(400, 'folder_a 路径无效');
    out.folder_a = v;
  }
  if ('folder_b' in body) {
    const v = optionalString(body.folder_b, 5000);
    if (v !== undefined && v !== null && !isSafeFolderPath(v)) throw new HttpError(400, 'folder_b 路径无效');
    out.folder_b = v;
  }
  if ('auto_scan' in body) {
    const n = optionalBool(body.auto_scan);
    if (n !== undefined) out.auto_scan = n;
  }

  return out;
}
