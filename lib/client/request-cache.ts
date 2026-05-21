import {buildOwnerPreviewHeaders, normalizeOwnerPreviewMemberId, OWNER_PREVIEW_MEMBER_STORAGE_KEY, OWNER_PREVIEW_STORAGE_KEY} from '../owner-preview';

type CachedEntry<T> = {
  expiresAt: number;
  value: T;
};

const getCache = new Map<string, CachedEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cacheGeneration = new Map<string, number>();

function getGeneration(key: string) {
  return cacheGeneration.get(key) || 0;
}

export async function fetchJsonCached<T>(url: string, ttlMs = 0): Promise<T> {
  const previewEnabled =
    typeof window !== 'undefined' && window.localStorage.getItem(OWNER_PREVIEW_STORAGE_KEY) === '1';
  const previewMemberId =
    typeof window !== 'undefined' ? normalizeOwnerPreviewMemberId(window.localStorage.getItem(OWNER_PREVIEW_MEMBER_STORAGE_KEY)) : '';
  const cacheKey = `${url}::${previewEnabled ? previewMemberId || 'preview' : 'live'}`;
  const generation = getGeneration(cacheKey);
  const now = Date.now();
  const cached = getCache.get(cacheKey) as CachedEntry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  const running = inflight.get(cacheKey) as Promise<T> | undefined;
  if (running) return running;

  const req = fetch(url, {
    headers: buildOwnerPreviewHeaders(previewEnabled, previewMemberId),
  })
    .then(async (res) => {
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (payload as any)?.error || `Request failed (${res.status})`;
        throw new Error(msg);
      }
      if (ttlMs > 0 && getGeneration(cacheKey) === generation) {
        getCache.set(cacheKey, {value: payload as T, expiresAt: now + ttlMs});
      }
      return payload as T;
    })
    .finally(() => {
      const running = inflight.get(cacheKey);
      if (running === (req as Promise<unknown>)) inflight.delete(cacheKey);
    });

  inflight.set(cacheKey, req as Promise<unknown>);
  return req;
}

export function invalidateJsonCache(url: string) {
  for (const key of Array.from(getCache.keys())) {
    if (key === url || key.startsWith(`${url}::`)) {
      getCache.delete(key);
      inflight.delete(key);
      cacheGeneration.set(key, getGeneration(key) + 1);
    }
  }
  for (const key of Array.from(inflight.keys())) {
    if (key === url || key.startsWith(`${url}::`)) {
      inflight.delete(key);
      cacheGeneration.set(key, getGeneration(key) + 1);
    }
  }
}

export function debounceAsync<T>(key: string, delayMs: number, task: () => Promise<T>): Promise<T> {
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(async () => {
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      } finally {
        debounceTimers.delete(key);
      }
    }, delayMs);

    debounceTimers.set(key, timer);
  });
}
