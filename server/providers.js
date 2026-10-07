'use strict';
const store = require('./store');
const { ApiError, sleep, retry } = require('./util');

/* Limiteur : un quota images/minute par fournisseur, partagé par toutes les instances. */
const stamps = new Map();
async function acquire(pid, signal) {
  for (;;) {
    const rpm = Math.max(1, store.providerCfg(pid).rpm);
    const now = Date.now();
    const a = (stamps.get(pid) || []).filter((t) => now - t < 60000);
    stamps.set(pid, a);
    if (a.length < rpm) { a.push(now); return; }
    await sleep(a[0] + 60000 - now + 50, signal);
  }
}

const noRespFormat = new Set();

async function request(pid, urlPath, { json, form }, signal) {
  const p = store.providerCfg(pid);
  if (!p.apiKey) throw new ApiError(`Clé API ${p.label} manquante (onglet Réglages)`, 401);
  const timeout = AbortSignal.timeout(240000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetch(p.baseUrl + urlPath, {
      method: 'POST', signal: sig,
      headers: { Authorization: 'Bearer ' + p.apiKey, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
  } catch (e) {
    if (signal && signal.aborted) throw e;
    throw new ApiError('Réseau : ' + ((e.cause && e.cause.message) || e.message), 0);
  }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { /* pas du JSON */ }
  if (!res.ok) {
    const msg = (body && ((body.error && (body.error.message || body.error)) || body.message)) || text.slice(0, 200) || res.statusText;
    throw new ApiError(`HTTP ${res.status} : ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, res.status, parseFloat(res.headers.get('retry-after')) || 0);
  }
  if (!body) throw new ApiError('Réponse non JSON : ' + text.slice(0, 120));
  return body;
}

/** Génère UNE image. refs = Buffers JPEG. Retourne un Buffer. */
async function image(pid, { prompt, size, refs = [] }, signal) {
  const p = store.providerCfg(pid);
  let json;
  const useEdits = refs.length && p.refMode === 'edits';
  const attempt = async () => {
    if (useEdits) {
      const fd = new FormData();
      const model = p.editModel || p.imageModel;
      if (model) fd.append('model', model);
      fd.append('prompt', prompt); fd.append('size', size); fd.append('n', '1');
      if (!noRespFormat.has(pid)) fd.append('response_format', 'b64_json');
      refs.forEach((b) => fd.append(refs.length > 1 ? 'image[]' : 'image', new Blob([b], { type: 'image/jpeg' }), 'ref.jpg'));
      return request(pid, '/images/edits', { form: fd }, signal);
    }
    const body = { prompt, size, n: 1 };
    if (p.imageModel) body.model = p.imageModel;
    if (!noRespFormat.has(pid)) body.response_format = 'b64_json';
    if (refs.length) {
      const urls = refs.map((b) => 'data:image/jpeg;base64,' + b.toString('base64'));
      body[p.refField || 'image'] = p.refArray ? urls : urls[0];
    }
    return request(pid, '/images/generations', { json: body }, signal);
  };
  try { json = await attempt(); } catch (e) {
    if (e.status === 400 && /response_format/i.test(e.message) && !noRespFormat.has(pid)) { noRespFormat.add(pid); json = await attempt(); } else throw e;
  }
  const d = json.data && json.data[0];
  if (d && d.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d && d.url && /^https?:\/\//i.test(d.url)) {
    let r;
    try { r = await fetch(d.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) }); } catch (e) {
      if (signal && signal.aborted) throw e;
      throw new ApiError('Téléchargement de l\'image impossible : ' + e.message, 0);
    }
    if (!r.ok) throw new ApiError('Téléchargement de l\'image impossible (HTTP ' + r.status + ')', r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new ApiError('Réponse inattendue : ' + JSON.stringify(json).slice(0, 160));
}

async function chat(pid, text, signal) {
  const p = store.providerCfg(pid);
  const json = await retry(() => request(pid, '/chat/completions', {
    json: { model: p.chatModel, messages: [{ role: 'system', content: store.getSettings().enhancePrompt }, { role: 'user', content: text }] },
  }, signal), signal);
  const out = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!out) throw new ApiError('Réponse vide du modèle de texte');
  return out.trim().replace(/^["“]|["”]$/g, '');
}

module.exports = { acquire, image, chat };
