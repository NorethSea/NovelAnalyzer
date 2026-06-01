import { Router } from 'express';
import { preferenceDb, novelDb } from '../db/index.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const router = Router();

const MAX_NOTE_LENGTH = 1000;

function parseNovelId(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, '无效的小说ID');
  return n;
}

function sanitizeNote(note: unknown): string | undefined {
  if (note == null) return undefined;
  if (typeof note !== 'string') throw new HttpError(400, 'note 必须为字符串');
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new HttpError(400, `note 长度不能超过 ${MAX_NOTE_LENGTH} 字符`);
  }
  return trimmed || undefined;
}

router.get('/', asyncHandler(async (_req, res) => {
  const result = await preferenceDb.getAllWithNovels();
  res.json(result);
}));

router.post('/like', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.body?.novelId);
  const note = sanitizeNote(req.body?.note);
  const novel = await novelDb.getById(novelId);
  if (!novel) throw new HttpError(404, '小说不存在');
  const preference = await preferenceDb.create({ novel_id: novelId, note });
  res.json(preference);
}));

router.post('/unlike', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.body?.novelId);
  await preferenceDb.deleteByNovelId(novelId);
  res.json({ message: '已取消喜欢' });
}));

router.get('/check/:novelId', asyncHandler(async (req, res) => {
  const novelId = parseNovelId(req.params.novelId);
  const isPreferred = await preferenceDb.isPreferred(novelId);
  res.json({ isPreferred });
}));

export default router;
