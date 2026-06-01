import { Router } from 'express';
import { llmConfigDb } from '../db/index.js';
import { getLLMProvider, resetProvider } from '../services/llm/index.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { validateLLMConfigUpdate } from '../utils/validator.js';

const router = Router();

router.get('/defaults', asyncHandler(async (_req, res) => {
  const { DEFAULT_PROMPT_ANALYZE, DEFAULT_PROMPT_MERGE } = await import('../services/analyzer.js');
  const { DEFAULT_PROMPT_RECOMMEND } = await import('../services/recommender.js');
  res.json({
    prompt_analyze: DEFAULT_PROMPT_ANALYZE,
    prompt_merge: DEFAULT_PROMPT_MERGE,
    prompt_recommend: DEFAULT_PROMPT_RECOMMEND,
  });
}));

router.get('/', asyncHandler(async (_req, res) => {
  const config = await llmConfigDb.getOrCreateDefault();
  res.json(config);
}));

router.get('/all', asyncHandler(async (_req, res) => {
  const configs = await llmConfigDb.getAll();
  res.json(configs);
}));

router.put('/', asyncHandler(async (req, res) => {
  const validated = validateLLMConfigUpdate(req.body || {});

  let config = await llmConfigDb.getActive();
  if (!config) {
    if (!validated.provider || !validated.model) {
      throw new HttpError(400, '首次创建配置需要 provider 和 model');
    }
    config = await llmConfigDb.create({
      name: validated.name ?? '',
      provider: validated.provider,
      api_key: validated.api_key ?? undefined,
      base_url: validated.base_url ?? undefined,
      model: validated.model,
      chunk_size: validated.chunk_size,
      overlap_ratio: validated.overlap_ratio,
      rpm_limit: validated.rpm_limit,
      timeout: validated.timeout,
      max_tokens: validated.max_tokens ?? undefined,
      prompt_analyze: validated.prompt_analyze ?? undefined,
      prompt_merge: validated.prompt_merge ?? undefined,
      prompt_recommend: validated.prompt_recommend ?? undefined,
      folder_a: validated.folder_a ?? undefined,
      folder_b: validated.folder_b ?? undefined,
      auto_scan: validated.auto_scan ?? 1,
    });
    await llmConfigDb.setActive(config.id);
  } else {
    await llmConfigDb.update(config.id, validated as unknown as Record<string, unknown>);
    resetProvider();
  }

  const updatedConfig = await llmConfigDb.getActive();
  res.json(updatedConfig);
}));

router.get('/presets', asyncHandler(async (_req, res) => {
  const configs = await llmConfigDb.getAll();
  res.json(configs.map(c => ({
    id: c.id,
    name: c.name || `方案 ${c.id}`,
    is_active: c.is_active,
    provider: c.provider,
    model: c.model,
    created_at: c.created_at,
  })));
}));

router.post('/presets', asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) throw new HttpError(400, '请输入方案名称');
  if (typeof name !== 'string' || name.length > 200) throw new HttpError(400, '方案名称过长');

  const active = await llmConfigDb.getActive();
  if (!active) throw new HttpError(400, '当前没有可保存的配置');

  const preset = await llmConfigDb.create({
    name: name.trim(),
    provider: active.provider,
    api_key: active.api_key || undefined,
    base_url: active.base_url || undefined,
    model: active.model,
    chunk_size: active.chunk_size,
    overlap_ratio: active.overlap_ratio,
    rpm_limit: active.rpm_limit,
    timeout: active.timeout,
    max_tokens: active.max_tokens || undefined,
    prompt_analyze: active.prompt_analyze || undefined,
    prompt_merge: active.prompt_merge || undefined,
    prompt_recommend: active.prompt_recommend || undefined,
    folder_a: active.folder_a || undefined,
    folder_b: active.folder_b || undefined,
    auto_scan: active.auto_scan,
  });

  res.json(preset);
}));

router.put('/presets/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '无效的方案ID');
  const { name } = req.body || {};
  if (!name?.trim()) throw new HttpError(400, '请输入方案名称');
  if (typeof name !== 'string' || name.length > 200) throw new HttpError(400, '方案名称过长');
  await llmConfigDb.update(id, { name: name.trim() });
  res.json({ success: true });
}));

router.put('/presets/:id/activate', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '无效的方案ID');
  await llmConfigDb.setActive(id);
  resetProvider();
  const config = await llmConfigDb.getActive();
  res.json(config);
}));

router.delete('/presets/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '无效的方案ID');
  const active = await llmConfigDb.getActive();
  if (active && active.id === id) throw new HttpError(400, '不能删除当前正在使用的方案');
  await llmConfigDb.delete(id);
  res.json({ success: true });
}));

router.post('/test', asyncHandler(async (_req, res) => {
  try {
    const llm = await getLLMProvider();
    const response = await llm.chat([
      { role: 'user', content: '请回复"连接成功"四个字' }
    ]);
    res.json({ success: true, message: response });
  } catch (error) {
    res.json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
}));

export default router;
