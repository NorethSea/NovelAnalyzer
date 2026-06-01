import fs from 'fs/promises';
import path from 'path';

const SUPPORTED_EXTENSIONS = ['.txt', '.epub'];
const MAX_DEPTH = 16;
const MAX_FILES = 50000;

export interface ScanResult {
  files: string[];
  errors: string[];
}

export async function scanFolder(folderPath: string): Promise<ScanResult> {
  const result: ScanResult = { files: [], errors: [] };
  const visited = new Set<string>();

  try {
    await scanDirectory(folderPath, result, 0, visited);
  } catch (error) {
    result.errors.push(`无法访问文件夹: ${folderPath}`);
  }

  return result;
}

async function scanDirectory(
  dirPath: string,
  result: ScanResult,
  depth: number,
  visited: Set<string>
): Promise<void> {
  if (depth > MAX_DEPTH) {
    result.errors.push(`超出最大扫描深度 (${MAX_DEPTH}): ${dirPath}`);
    return;
  }
  if (result.files.length >= MAX_FILES) return;

  let realPath: string;
  try {
    realPath = await fs.realpath(dirPath);
  } catch {
    realPath = dirPath;
  }
  if (visited.has(realPath)) {
    result.errors.push(`检测到符号链接循环，跳过: ${dirPath}`);
    return;
  }
  visited.add(realPath);

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    result.errors.push(`无法读取目录: ${dirPath}`);
    return;
  }

  for (const entry of entries) {
    if (result.files.length >= MAX_FILES) break;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      await scanDirectory(fullPath, result, depth + 1, visited);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        result.files.push(fullPath);
      }
    } else if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await scanDirectory(fullPath, result, depth + 1, visited);
        } else if (stat.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            result.files.push(fullPath);
          }
        }
      } catch {
        result.errors.push(`无法访问链接: ${fullPath}`);
      }
    }
  }
}
