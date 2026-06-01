import { Router } from 'express';
import { recommendationDb, batchJobDb } from '../db/index.js';
import { generateRecommendations } from '../services/recommender.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const router = Router();

let recommendRunning = false;

router.get('/', asyncHandler(async (_req, res) => {
  const result = await recommendationDb.getAllWithNovels();
  res.json(result);
}));

router.get('/recommended', asyncHandler(async (_req, res) => {
  const result = await recommendationDb.getAllWithNovels('recommended');
  res.json(result);
}));

router.get('/not-recommended', asyncHandler(async (_req, res) => {
  const result = await recommendationDb.getAllWithNovels('not_recommended');
  res.json(result);
}));

router.get('/generate/status', asyncHandler(async (_req, res) => {
  const job = await batchJobDb.getCurrent('recommend');
  if (!job) {
    res.json({ running: false, total: 0, completed: 0, failed: 0, current: '' });
    return;
  }
  res.json({
    running: job.status === 'running',
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    current: job.current,
  });
}));

router.post('/generate', asyncHandler(async (_req, res) => {
  if (recommendRunning) throw new HttpError(409, '推荐生成已在进行中');

  const job = await batchJobDb.getCurrent('recommend');
  if (job && job.status === 'running') {
    throw new HttpError(409, '推荐生成已在进行中');
  }

  recommendRunning = true;
  await recommendationDb.deleteAll();
  await batchJobDb.start([0], 'recommend');

  res.json({ message: '推荐生成已开始' });

  void (async () => {
    let failed = 0;
    try {
      const results = await generateRecommendations((current) => {
        batchJobDb.update({ current }, 'recommend').catch(() => {});
      });
      await batchJobDb.update({ completed: results.length, total: results.length }, 'recommend');
    } catch (err) {
      console.error('推荐生成失败:', err);
      failed = 1;
    } finally {
      recommendRunning = false;
      await batchJobDb.finish('recommend', failed > 0 ? 'failed' : 'completed');
    }
  })();
}));

export default router;
