import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { isSystemPathBlocked, isPathAllowed, getAllowedRoots } from '../utils/pathSecurity.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const reqPath = (req.query.path as string) || '';
  const resolved = reqPath || os.homedir();

  if (isSystemPathBlocked(resolved)) {
    throw new HttpError(403, '禁止访问系统目录');
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    res.json({ path: resolved, parent: null, folders: [] });
    return;
  }

  if (!stat.isDirectory()) {
    res.json({ path: resolved, parent: null, folders: [] });
    return;
  }

  const allowedRoots = await getAllowedRoots();
  const parent = path.dirname(resolved);
  if (parent !== resolved && !isPathAllowed(parent, allowedRoots) && !isPathAllowed(resolved, allowedRoots)) {
    if (path.dirname(resolved) !== os.homedir() && parent !== path.dirname(os.homedir())) {
      const upOne = path.dirname(parent);
      res.json({
        path: resolved,
        parent: (upOne !== resolved && isPathAllowed(upOne, allowedRoots)) ? upOne : null,
        folders: [],
        restricted: true,
      });
      return;
    }
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const folders = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, path: path.join(resolved, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ path: resolved, parent: parent !== resolved ? parent : null, folders });
}));

router.get('/resolve', asyncHandler(async (req, res) => {
  const name = req.query.name as string;
  if (!name) throw new HttpError(400, '缺少 name 参数');
  if (name.length > 100) throw new HttpError(400, '名称过长');

  const home = os.homedir();
  const searchDirs = Array.from(new Set([
    home,
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
  ]));

  const candidates: string[] = [];
  const seen = new Set<string>();

  async function addCandidate(p: string) {
    if (seen.has(p)) return;
    if (isSystemPathBlocked(p)) return;
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        seen.add(p);
        candidates.push(p);
      }
    } catch {}
  }

  for (const dir of searchDirs) {
    try {
      if (isSystemPathBlocked(dir)) continue;
      await addCandidate(path.join(dir, name));

      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        await addCandidate(path.join(dir, entry.name, name));
      }
    } catch {}
  }

  res.json({ resolved: candidates[0] || null, candidates });
}));

export default router;
