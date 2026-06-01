import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import readline from 'readline';
import EPub from 'epub2';
import chardet from 'chardet';
import iconv from 'iconv-lite';

const MAX_FILE_SIZE = 500 * 1024 * 1024;

export async function parseFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt') {
    return await parseTxt(filePath);
  } else if (ext === '.epub') {
    return await parseEpubFile(filePath);
  } else {
    throw new Error(`不支持的文件格式: ${ext}`);
  }
}

async function parseTxt(filePath: string): Promise<string> {
  const stat = await fsp.stat(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制`);
  }

  const buffer = await fsp.readFile(filePath);

  const detected = chardet.detect(buffer);
  let encoding = detected || 'utf-8';

  if (encoding === 'ascii' || encoding.toUpperCase() === 'ISO-8859-1') {
    encoding = 'utf-8';
  }

  console.log(`[Parser] ${path.basename(filePath)} 编码: ${encoding}`);

  let content = iconv.decode(buffer, encoding);

  if (content.includes('\uFFFD')) {
    console.log(`[Parser] ${encoding} 解码有乱码，尝试 GBK`);
    const gbkContent = iconv.decode(buffer, 'gbk');
    if (!gbkContent.includes('\uFFFD')) {
      content = gbkContent;
    }
  }

  return content;
}

async function parseEpubFile(filePath: string): Promise<string> {
  const epub = await EPub.createAsync(filePath);

  const textParts: string[] = [];

  for (const chapter of epub.flow) {
    if (!chapter.id) continue;
    try {
      const chapterText = await epub.getChapterAsync(chapter.id);
      if (!chapterText) continue;
      const cleanText = chapterText
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (cleanText) textParts.push(cleanText);
    } catch (e) {
      console.warn(`[Parser] EPUB 章节解析失败: ${chapter.id}`, e);
    }
  }

  return textParts.join('\n\n');
}

export function extractTitle(filePath: string, content?: string): string {
  const basename = path.basename(filePath, path.extname(filePath));

  if (content) {
    const firstLines = content.substring(0, 500);
    const titleMatch = firstLines.match(/书名[：:]\s*([^\r\n]+)/);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
  }

  return basename;
}

export function extractAuthor(content?: string): string | null {
  if (content) {
    const firstLines = content.substring(0, 500);
    const authorMatch = firstLines.match(/作者[：:]\s*([^\r\n]+)/);
    if (authorMatch) {
      return authorMatch[1].trim();
    }
  }
  return null;
}

export async function streamTxtLines(
  filePath: string,
  onLine: (line: string) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const stat = await fsp.stat(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制`);
  }

  const detected = chardet.detect(await fsp.readFile(filePath).then(b => b.subarray(0, Math.min(b.length, 65536))));
  const encoding = (detected && detected !== 'ascii') ? detected : 'utf-8';

  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  if (encoding !== 'utf-8') {
    let buffer = Buffer.alloc(0);
    stream.on('data', (chunk: string | Buffer) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    });
    stream.on('end', async () => {
      const text = iconv.decode(buffer, encoding);
      for (const line of text.split(/\r?\n/)) {
        if (signal?.aborted) return;
        await onLine(line);
      }
    });
  } else {
    try {
      for await (const line of rl) {
        if (signal?.aborted) {
          rl.close();
          return;
        }
        await onLine(line);
      }
    } finally {
      rl.close();
    }
  }
}
