import fs from 'fs';

type CacheEntry<T> = {
  mtimeMs: number;
  value: T;
};

const jsonCache = new Map<string, CacheEntry<unknown>>();

export function readJsonFileCached<T>(filePath: string, fallbackFactory: () => T): T {
  try {
    const stat = fs.statSync(filePath);
    const cached = jsonCache.get(filePath) as CacheEntry<T> | undefined;
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as T;
    jsonCache.set(filePath, {mtimeMs: stat.mtimeMs, value: parsed});
    return parsed;
  } catch {
    return fallbackFactory();
  }
}

export function invalidateJsonFileCache(filePath: string) {
  jsonCache.delete(filePath);
}
