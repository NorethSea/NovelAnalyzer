export function extractJsonObject<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith('{')) {
      try { return JSON.parse(inner) as T; } catch {}
    }
  }

  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.substring(start, i + 1);
        try { return JSON.parse(candidate) as T; } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function truncateString(s: string | null | undefined, maxLen: number): string {
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen) + '…';
}
