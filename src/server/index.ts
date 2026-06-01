import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { closeDb, llmConfigDb, novelDb, batchJobDb, flushDb, analysisDb } from './db/index.js';
import novelsRouter from './routes/novels.js';
import preferencesRouter from './routes/preferences.js';
import recommendationsRouter from './routes/recommendations.js';
import configRouter from './routes/config.js';
import foldersRouter from './routes/folders.js';
import eventsRouter from './routes/events.js';
import { resolveFolderPath, parseFolderPaths } from './utils/path.js';
import { errorMiddleware, notFoundHandler, requestIdMiddleware } from './utils/asyncHandler.js';
import { rateLimit } from './utils/rateLimit.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Origin not allowed'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);

const llmTestLimiter = rateLimit({ windowMs: 60_000, max: 5 });
const analyzeStartLimiter = rateLimit({ windowMs: 60_000, max: 30 });

app.use('/api/novels', novelsRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/config', configRouter);
app.use('/api/config/test', llmTestLimiter);
app.use('/api/folders', foldersRouter);
app.use('/api/events', eventsRouter);
app.use('/api/novels', analyzeStartLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const publicDir = path.resolve(process.cwd(), 'dist/public');
app.use(express.static(publicDir));
app.get(/^(?!\/api).*/, (_req, res, next) => {
  res.sendFile(path.join(publicDir, 'index.html'), err => {
    if (err) next();
  });
});

app.use('/api', notFoundHandler);
app.use(errorMiddleware);

let autoScanRunning = false;
let activeAutoScanAbort: AbortController | null = null;
async function autoScanOnStartup() {
  if (autoScanRunning) return;
  autoScanRunning = true;
  activeAutoScanAbort = new AbortController();
  const signal = activeAutoScanAbort.signal;
  try {
    const config = await llmConfigDb.getActive();
    if (!config || !config.auto_scan) return;
    if (signal.aborted) return;

    const { importFolder } = await import('./services/analyzer.js');
    const { preferenceDb } = await import('./db/index.js');

    const foldersA = parseFolderPaths(config.folder_a);
    for (const raw of foldersA) {
      if (signal.aborted) return;
      const folderPath = resolveFolderPath(raw);
      console.log(`自动扫描小说库: ${folderPath}`);
      const result = await importFolder(folderPath, 'folder_a');
      console.log(`小说库: 新增${result.imported} 更新${result.updated} 跳过${result.skipped} 删除${result.deleted}`);
    }

    const foldersB = parseFolderPaths(config.folder_b);
    for (const raw of foldersB) {
      if (signal.aborted) return;
      const folderPath = resolveFolderPath(raw);
      console.log(`自动扫描收藏夹: ${folderPath}`);
      const result = await importFolder(folderPath, 'folder_b');
      console.log(`收藏夹: 新增${result.imported} 更新${result.updated} 跳过${result.skipped} 删除${result.deleted}`);
    }

    if (foldersB.length > 0 && !signal.aborted) {
      const importedNovels = await novelDb.getByFolderSource('folder_b');
      const novelIds = importedNovels.map(n => n.id);
      const existingPrefs = await preferenceDb.getByNovelIds(novelIds);
      const toCreate = importedNovels.filter(n => !existingPrefs.has(n.id));
      for (const novel of toCreate) {
        if (signal.aborted) return;
        await preferenceDb.create({ novel_id: novel.id, note: '从收藏夹自动导入' });
      }
    }
  } catch (error) {
    console.error('自动扫描失败:', error);
  } finally {
    autoScanRunning = false;
    activeAutoScanAbort = null;
  }
}

async function recoverStuckState() {
  try {
    const recovered = await novelDb.resetAnalyzingToError('服务重启，分析任务被中断');
    if (recovered > 0) {
      console.log(`[Recovery] 已重置 ${recovered} 本被中断的小说为 error 状态`);
    }
    await batchJobDb.recoverIfStuck('analyze');
    await batchJobDb.recoverIfStuck('recommend');
    const backfilled = await analysisDb.backfillOverallSummary();
    if (backfilled > 0) {
      console.log(`[Recovery] 已回填 ${backfilled} 条 overall_summary`);
    }
  } catch (err) {
    console.error('[Recovery] 启动恢复失败:', err);
  }
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] 收到 ${signal}，正在保存数据...`);
  if (activeAutoScanAbort) activeAutoScanAbort.abort();
  try {
    await flushDb();
  } catch (err) {
    console.error('[Shutdown] 持久化失败:', err);
  }
  setTimeout(() => {
    closeDb().finally(() => process.exit(0));
  }, 2000);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
  void shutdown('unhandledRejection');
});

if (NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.listen(PORT, async () => {
  console.log(`服务器运行在 http://localhost:${PORT} (${NODE_ENV})`);
  await recoverStuckState();
  void autoScanOnStartup();
});
