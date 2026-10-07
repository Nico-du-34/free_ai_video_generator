'use strict';
class ApiError extends Error {
  constructor(msg, status = 0, retryAfter = 0) { super(msg); this.status = status; this.retryAfter = retryAfter; }
}

/* Limiteur global : toutes les instances partagent le quota (images / minute). */
const Limiter = {
  stamps: [],
  async acquire(signal) {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60000);
      if (this.stamps.length < Math.max(1, settings.rpm)) { this.stamps.push(now); return; }
      await sleep(this.stamps[0] + 60000 - now + 50, signal);
    }
  },
};

const b64ToBlob = (b64, type = 'image/png') => {
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
};

const Api = {
  noRespFormat: false,
  endpoint(path) { return settings.useProxy ? '/api' + path : settings.baseUrl.replace(/\/$/, '') + path; },

  async post(path, body, signal) {
    if (!settings.apiKey) throw new ApiError('Clé API manquante (onglet Réglages)', 401);
    let res;
    try {
      res = await fetch(this.endpoint(path), {
        method: 'POST', signal, body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ApiError('Réseau/CORS : ' + e.message + (settings.useProxy ? '' : ' — essaie d\'activer le proxy local (npm start)'), 0);
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { /* pas du JSON */ }
    if (!res.ok) {
      let msg = (json && ((json.error && json.error.message) || json.message)) || text.slice(0, 200) || res.statusText;
      if (settings.useProxy && (res.status === 404 || res.status === 405) && !json) msg += ' (proxy local indisponible ? lance `npm start` ou décoche le proxy)';
      throw new ApiError(`HTTP ${res.status} : ${msg}`, res.status, parseFloat(res.headers.get('retry-after')) || 0);
    }
    if (!json) throw new ApiError('Réponse non JSON : ' + text.slice(0, 120));
    return json;
  },

  async retry(fn, signal, onRetry) {
    for (let a = 0; ; a++) {
      try { return await fn(); } catch (e) {
        if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
        const retryable = e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);
        if (!retryable || a >= 4) throw e;
        const wait = e.retryAfter ? e.retryAfter * 1000 : Math.min(30000, 2000 * 2 ** a);
        onRetry && onRetry(e, a + 1, wait);
        await sleep(wait, signal);
      }
    }
  },

  /** Génère UNE image. refs = data URLs. Retourne un Blob. */
  async image({ prompt, size, refs = [] }, signal) {
    const body = { model: settings.imageModel, prompt, size, n: 1 };
    if (!this.noRespFormat) body.response_format = 'b64_json';
    if (refs.length) body[settings.refField] = settings.refArray ? refs : refs[0];
    let json;
    try { json = await this.post('/images/generations', body, signal); } catch (e) {
      if (e.status === 400 && /response_format/i.test(e.message) && !this.noRespFormat) {
        this.noRespFormat = true;
        return this.image({ prompt, size, refs }, signal);
      }
      throw e;
    }
    const d = json.data && json.data[0];
    if (d && d.b64_json) return b64ToBlob(d.b64_json);
    if (d && d.url) {
      let r;
      try { r = await fetch(d.url, { signal }); } catch (e) { if (e.name === 'AbortError') throw e; r = null; }
      if (!r || !r.ok) r = await fetch('/fetch?url=' + encodeURIComponent(d.url), { signal });
      if (!r.ok) throw new ApiError('Téléchargement de l\'image impossible (HTTP ' + r.status + ')', r.status);
      return r.blob();
    }
    throw new ApiError('Réponse inattendue : ' + JSON.stringify(json).slice(0, 160));
  },

  async enhance(text, signal) {
    const json = await this.retry(() => this.post('/chat/completions', {
      model: settings.chatModel,
      messages: [{ role: 'system', content: settings.enhancePrompt }, { role: 'user', content: text }],
    }, signal), signal);
    const out = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!out) throw new ApiError('Réponse vide du modèle de texte');
    return out.trim().replace(/^["“]|["”]$/g, '');
  },
};
