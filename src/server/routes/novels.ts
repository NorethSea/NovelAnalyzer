import { Router } from 'express';
import fs from 'fs/promises';
import { novelDb, analysisDb, chunkAnalysisDb, llmConfigDb, preferenceDb, batchJobDb, runInTransaction } from '../db/index.js';
import { analyzeNovel, importFolder } from '../services/analyzer.js';
import { resolveFolderPath, parseFolderPaths } from '../utils/path.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { isPathAllowed, getAllowedRoots } from '../utils/pathSecurity.js';
import { analyzerEvents } from '../services/analyzer.js';

const router = Router();

const analysisProgress = new Map<number, { status: string; currentChunk?: number; totalChunks?: number }>();

let batchRunning = false;
let batchCurrent = '';

function parseNovelId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, '无效的ID');
  return n;
}

router.get('/', asyncHandler(async (_req, res) => {
  const novels = await novelDb.getAllExcludingPreferred();
  res.json(novels);
}));

router.get('/all', asyncHandler(async (_req, res) => {
  const novels = await novelDb.getAll();
  res.json(novels);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const novel = await novelDb.getWithAnalysis(parseNovelId(req.params.id));
  if (!novel) throw new HttpError(404, '小说不存在');
  res.json(novel);
}));

router.post('/:id/analyze', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.params.id);
  const started = await novelDb.tryStartAnalyzing(novelId);
  if (!started) {
    const existing = await novelDb.getById(novelId);
    if (!existing) throw new HttpError(404, '小说不存在');
    throw new HttpError(409, '该小说正在分析中或状态不允许');
  }
  analysisProgress.set(novelId, { status: 'analyzing' });

  analyzeNovel(novelId, (progress) => {
    analysisProgress.set(novelId, {
      status: progress.status,
      currentChunk: progress.currentChunk,
      totalChunks: progress.totalChunks,
    });
  }).catch(err => {
    console.error('分析失败:', err);
  });
  res.json({ message: '分析已开始', novelId });
}));

router.post('/:id/refresh-summary', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.params.id);
  const novel = await novelDb.getById(novelId);
  if (!novel) throw new HttpError(404, '小说不存在');
  const { parseFile } = await import('../services/parser.js');
  const content = await parseFile(novel.file_path);
  const contentSummary = content.substring(0, 500);
  await novelDb.updateSummary(novelId, contentSummary);
  res.json({ message: '摘要已更新', content_summary: contentSummary });
}));

router.post('/batch-analyze', asyncHandler(async (req, res) => {
  if (batchRunning) throw new HttpError(409, '已有批量分析在运行中');

  const { ids } = req.body as { ids: number[] };
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new HttpError(400, '请提供要分析的小说ID列表');
  }
  const validIds = ids.filter(id => Number.isInteger(id) && id > 0);
  if (validIds.length === 0) throw new HttpError(400, '没有有效的小说ID');

  batchRunning = true;
  batchCurrent = '';
  await batchJobDb.start(validIds, 'analyze');

  res.json({ message: '批量分析已开始', total: validIds.length });

  void (async () => {
    let completed = 0;
    let failed = 0;
    try {
      for (const id of validIds) {
        const novel = await novelDb.getById(id);
        batchCurrent = novel?.title || `#${id}`;
        await batchJobDb.update({ current: batchCurrent }, 'analyze');
        analysisProgress.set(id, { status: 'analyzing' });

        try {
          await analyzeNovel(id, (progress) => {
            analysisProgress.set(id, {
              status: progress.status,
              currentChunk: progress.currentChunk,
              totalChunks: progress.totalChunks,
            });
          });
          completed++;
        } catch (err) {
          console.error(`批量分析失败: ${id}`, err);
          failed++;
        }
        await batchJobDb.update({ completed, failed }, 'analyze');
      }
    } finally {
      batchRunning = false;
      batchCurrent = '';
      const finalStatus = failed > 0 && completed === 0 ? 'failed' : (failed > 0 ? 'failed' : 'completed');
      await batchJobDb.finish('analyze', finalStatus);
    }
  })();
}));

router.get('/batch-analyze/status', asyncHandler(async (_req, res) => {
  const job = await batchJobDb.getCurrent('analyze');
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

router.get('/:id/status', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.params.id);
  const novel = await novelDb.getById(novelId);
  if (!novel) throw new HttpError(404, '小说不存在');
  const progress = analysisProgress.get(novelId);
  res.json({ novelId, status: novel.status, progress: progress || null });
}));

router.post('/:id/delete-analysis', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.params.id);
  const novel = await novelDb.getById(novelId);
  if (!novel) throw new HttpError(404, '小说不存在');

  await analysisDb.deleteByNovelId(novelId);
  await chunkAnalysisDb.deleteByNovelId(novelId);
  await novelDb.updateStatus(novelId, 'pending');

  res.json({ message: '分析结果已删除' });
}));

router.post('/batch-delete-analysis', asyncHandler(async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new HttpError(400, '请提供要清除分析的小说ID列表');
  }
  const validIds = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
  if (validIds.length === 0) throw new HttpError(400, '没有有效的小说ID');

  const existing = await novelDb.getByIds(validIds);
  const existingIds = existing.map(n => n.id);
  if (existingIds.length === 0) {
    res.json({ message: '没有匹配的小说', count: 0 });
    return;
  }

  await runInTransaction(async () => {
    await analysisDb.deleteByNovelIds(existingIds);
    await chunkAnalysisDb.deleteByNovelIds(existingIds);
    for (const id of existingIds) {
      await novelDb.updateStatus(id, 'pending');
    }
  });

  res.json({ message: `已清除 ${existingIds.length} 本小说的分析结果`, count: existingIds.length });
}));

router.post('/backfill-overall-summary', asyncHandler(async (_req, res) => {
  const count = await analysisDb.backfillOverallSummary();
  res.json({ message: `已回填 ${count} 条`, count });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.params.id);
  const deleteFile = req.query.deleteFile === 'true';
  const novel = await novelDb.getById(novelId);
  if (!novel) throw new HttpError(404, '小说不存在');

  if (deleteFile && novel.file_path) {
    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(novel.file_path, allowedRoots)) {
      throw new HttpError(403, '文件路径不在允许的目录范围内');
    }
    try {
      await fs.unlink(novel.file_path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[Delete] 无法删除文件 ${novel.file_path}:`, err);
      }
    }
  }

  await novelDb.delete(novelId);
  analysisProgress.delete(novelId);
  res.json({ message: '已删除' });
}));

async function runImport(folderSource: 'folder_a' | 'folder_b') {
  const config = await llmConfigDb.getOrCreateDefault();
  const raw = folderSource === 'folder_a' ? config.folder_a : config.folder_b;
  const folders = parseFolderPaths(raw);
  if (folders.length === 0) {
    const label = folderSource === 'folder_a' ? '小说库' : '收藏夹';
    throw new HttpError(400, `请先在设置中配置${label}的路径`);
  }

  let imported = 0;
  let skipped = 0;
  let deleted = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const rawPath of folders) {
    const folderPath = resolveFolderPath(rawPath);
    const result = await importFolder(folderPath, folderSource);
    imported += result.imported;
    skipped += result.skipped;
    deleted += result.deleted;
    updated += result.updated;
    errors.push(...result.errors);
  }

  if (folderSource === 'folder_b') {
    const importedNovels = await novelDb.getByFolderSource('folder_b');
    const novelIds = importedNovels.map(n => n.id);
    const existingPrefs = await preferenceDb.getByNovelIds(novelIds);
    const toCreate = importedNovels.filter(n => !existingPrefs.has(n.id));
    for (const novel of toCreate) {
      await preferenceDb.create({ novel_id: novel.id, note: '从收藏夹自动导入' });
    }
  }

  return { imported, skipped, deleted, updated, errors };
}

router.post('/import/folder-a', asyncHandler(async (_req, res) => {
  const result = await runImport('folder_a');
  res.json(result);
}));

router.post('/import/folder-b', asyncHandler(async (_req, res) => {
  const result = await runImport('folder_b');
  res.json(result);
}));

export default router;
