import fs from 'fs';
import path from 'path';
import os from 'os';

export function parseFolderPaths(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    return [parsed];
  } catch {
    return raw ? [raw] : [];
  }
}

export function resolveFolderPath(folderPath: string): string {
  if (path.isAbsolute(folderPath) && fs.existsSync(folderPath)) {
    return folderPath;
  }

  const name = path.basename(folderPath);
  const searchDirs = [
    process.cwd(),
    os.homedir(),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Downloads'),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const target = path.join(dir, name);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      return target;
    }
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const subTarget = path.join(dir, entry.name, name);
        if (fs.existsSync(subTarget) && fs.statSync(subTarget).isDirectory()) {
          return subTarget;
        }
      }
    } catch {}
  }

  return folderPath;
}
