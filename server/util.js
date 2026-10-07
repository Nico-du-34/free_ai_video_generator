'use strict';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

function sleep(ms, signal) {
  return new Promise((res, rej) => {
    if (signal && signal.aborted) return rej(abortError());
    const onAbort = () => { clearTimeout(t); rej(abortError()); };
    const t = setTimeout(() => { signal && signal.removeEventListener('abort', onAbort); res(); }, ms);
    signal && signal.addEventListener('abort', onAbort, { once: true });
  });
}
function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

class ApiError extends Error {
  constructor(msg, status = 0, retryAfter = 0) { super(msg); this.status = status; this.retryAfter = retryAfter; }
}

/** Réessaie les erreurs réseau / 429 / 5xx avec backoff exponentiel. */
async function retry(fn, signal, onRetry) {
  for (let a = 0; ; a++) {
    try { return await fn(); } catch (e) {
      if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
      const retryable = e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);
      if (!retryable || a >= 4) throw e;
      const wait = e.retryAfter ? e.retryAfter * 1000 : Math.min(30000, 2000 * 2 ** a);
      if (onRetry) onRetry(e, a + 1, wait);
      await sleep(wait, signal);
    }
  }
}

module.exports = { clamp, uid, sleep, abortError, ApiError, retry };
