import path from 'path';
import { parseFolderPaths, resolveFolderPath } from './path.js';
import { llmConfigDb } from '../db/index.js';

const SYSTEM_FORBIDDEN = [
  process.platform === 'win32'
    ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData']
    : ['/etc', '/proc', '/sys', '/var', '/usr', '/boot', '/root', '/bin', '/sbin'],
].flat();

function isSystemForbidden(resolved: string): boolean {
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return SYSTEM_FORBIDDEN.some(p => {
    const np = process.platform === 'win32' ? p.toLowerCase() : p;
    return normalized === np || normalized.startsWith(np + path.sep);
  });
}

export async function getAllowedRoots(): Promise<string[]> {
  const config = await llmConfigDb.getActive();
  if (!config) return [];
  const roots: string[] = [];
  for (const raw of parseFolderPaths(config.folder_a)) {
    const resolved = resolveFolderPath(raw);
    if (resolved) roots.push(resolved);
  }
  for (const raw of parseFolderPaths(config.folder_b)) {
    const resolved = resolveFolderPath(raw);
    if (resolved) roots.push(resolved);
  }
  return roots;
}

export function isPathAllowed(target: string, allowedRoots: string[]): boolean {
  if (!path.isAbsolute(target)) return false;
  if (isSystemForbidden(target)) return false;

  const normalized = path.resolve(target);
  for (const root of allowedRoots) {
    if (!root) continue;
    const rootResolved = path.resolve(root);
    if (normalized === rootResolved) return true;
    if (normalized.startsWith(rootResolved + path.sep)) return true;
  }
  return false;
}

export function isParentAllowed(target: string, allowedRoots: string[]): boolean {
  if (!path.isAbsolute(target)) return false;
  if (isSystemForbidden(target)) return false;

  const normalized = path.resolve(target);
  for (const root of allowedRoots) {
    if (!root) continue;
    const rootResolved = path.resolve(root);
    if (normalized === rootResolved) return true;
    if (normalized.startsWith(rootResolved + path.sep)) return true;
  }
  return false;
}

export function isSystemPathBlocked(target: string): boolean {
  return isSystemForbidden(path.resolve(target));
}
