import { Router, Request, Response } from 'express';
import { analyzerEvents, type AnalyzeProgress } from '../services/analyzer.js';
import { batchJobDb } from '../db/index.js';

const router = Router();

const sseConnectionsByIp = new Map<string, number>();
const MAX_SSE_PER_IP = 3;
const SSE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function getClientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || 'unknown').toString();
}

function releaseConnection(ip: string) {
  const count = sseConnectionsByIp.get(ip) || 0;
  if (count <= 1) sseConnectionsByIp.delete(ip);
  else sseConnectionsByIp.set(ip, count - 1);
}

function trackConnection(ip: string, res: Response): boolean {
  const current = sseConnectionsByIp.get(ip) || 0;
  if (current >= MAX_SSE_PER_IP) {
    res.status(429).json({ error: 'SSE 连接数超过限制' });
    return false;
  }
  sseConnectionsByIp.set(ip, current + 1);
  return true;
}

async function snapshotFor(type: 'analyze' | 'recommend') {
  const job = await batchJobDb.getCurrent(type);
  if (!job) {
    return { running: false, total: 0, completed: 0, failed: 0, current: '' };
  }
  return {
    running: job.status === 'running',
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    current: job.current,
  };
}

function setupSSE(req: Request, res: Response, type: 'analyze' | 'recommend') {
  const ip = getClientIp(req);
  if (!trackConnection(ip, res)) return;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);

  const send = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  void snapshotFor(type).then(snap => send('snapshot', { ...snap, type }));

  const onProgress = async (progress: AnalyzeProgress) => {
    send('progress', progress);
    send('batch', { ...(await snapshotFor(type)), type });
  };

  analyzerEvents.on(onProgress);

  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    res.write(': ping\n\n');
  }, 15000);

  const idleTimer = setTimeout(() => {
    res.end();
  }, SSE_IDLE_TIMEOUT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    clearTimeout(idleTimer);
    analyzerEvents.off(onProgress);
    releaseConnection(ip);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
}

router.get('/batch', (req, res) => {
  setupSSE(req, res, 'analyze');
});

router.get('/recommend', (req, res) => {
  setupSSE(req, res, 'recommend');
});

export default router;
