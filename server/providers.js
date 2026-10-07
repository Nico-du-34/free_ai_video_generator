'use strict';
const store = require('./store');
const { ApiError, sleep, retry } = require('./util');

/* Limiteur : un quota images/minute par fournisseur, partagé par toutes les instances.
   Après un 429, le débit est divisé par deux pendant 2 minutes (ralentissement adaptatif). */
const stamps = new Map();
const cool = new Map();
function effectiveRpm(pid) {
  const rpm = Math.max(1, store.providerCfg(pid).rpm);
  return (cool.get(pid) || 0) > Date.now() ? Math.max(1, Math.floor(rpm / 2)) : rpm;
}
async function acquire(pid, signal) {
  for (;;) {
    const now = Date.now();
    const a = (stamps.get(pid) || []).filter((t) => now - t < 60000);
    stamps.set(pid, a);
    if (a.length < effectiveRpm(pid)) { a.push(now); return; }
    await sleep(a[0] + 60000 - now + 50, signal);
  }
}

const noRespFormat = new Set();
const mimeOf = (b) => (b[0] === 0xff ? 'image/jpeg' : b[0] === 0x52 ? 'image/webp' : 'image/png');

/** Requête POST générique : retourne { buf, type } ou lève ApiError. */
async function call(pid, url, { json, form }, signal) {
  const p = store.providerCfg(pid);
  if (!p.apiKey) throw new ApiError(`Clé API ${p.label} manquante (onglet Réglages)`, 401);
  if (/VOTRE_ACCOUNT_ID/.test(url)) throw new ApiError('Renseigne ton Account ID Cloudflare dans l\'URL de base (Réglages › Avancé)', 400);
  const timeout = AbortSignal.timeout(240000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', signal: sig,
      headers: { Authorization: 'Bearer ' + p.apiKey, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
  } catch (e) {
    if (signal && signal.aborted) throw e;
    throw new ApiError('Réseau : ' + ((e.cause && e.cause.message) || e.message), 0);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    if (res.status === 429) cool.set(pid, Date.now() + 120000);
    const text = buf.toString('utf8', 0, 600);
    let body; try { body = JSON.parse(text); } catch { /* pas du JSON */ }
    const msg = (body && ((body.error && (body.error.message || body.error)) || body.message || (body.errors && body.errors[0] && body.errors[0].message))) || text.slice(0, 200) || res.statusText;
    throw new ApiError(`HTTP ${res.status} : ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, res.status, parseFloat(res.headers.get('retry-after')) || 0);
  }
  return { buf, type };
}
function asJson({ buf }) {
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new ApiError('Réponse non JSON : ' + buf.toString('utf8', 0, 120)); }
}
function extra(p) { try { return p.extraBody ? JSON.parse(p.extraBody) : {}; } catch { return {}; } }
const wh = (size) => { const [w, h] = size.split('x').map(Number); return { width: w, height: h }; };

/** Génère UNE image. refs = Buffers JPEG. Retourne un Buffer. */
async function image(pid, { prompt, size, refs = [] }, signal) {
  const p = store.providerCfg(pid);
  if (p.refMode === 'none') refs = [];

  if (p.type === 'cloudflare') {
    const r = await call(pid, `${p.baseUrl}/run/${p.imageModel}`, { json: { prompt, ...extra(p) } }, signal);
    if (/json/i.test(r.type)) {
      const j = asJson(r), b64 = j.result && j.result.image;
      if (!b64) throw new ApiError('Réponse inattendue : ' + JSON.stringify(j).slice(0, 160));
      return Buffer.from(b64, 'base64');
    }
    return r.buf;
  }
  if (p.type === 'hf') {
    const params = { ...(p.sizeMode === 'wh' ? wh(size) : {}), ...extra(p) };
    const r = await call(pid, `${p.baseUrl}/models/${p.imageModel}`, { json: { inputs: prompt, parameters: params } }, signal);
    if (/json/i.test(r.type)) throw new ApiError('Réponse inattendue : ' + r.buf.toString('utf8', 0, 160));
    return r.buf;
  }

  const useEdits = refs.length && p.refMode === 'edits';
  const attempt = async () => {
    if (useEdits) {
      const fd = new FormData();
      const model = p.editModel || p.imageModel;
      if (model) fd.append('model', model);
      fd.append('prompt', prompt); fd.append('size', size); fd.append('n', '1');
      if (!noRespFormat.has(pid)) fd.append('response_format', 'b64_json');
      refs.forEach((b) => fd.append(refs.length > 1 ? 'image[]' : 'image', new Blob([b], { type: 'image/jpeg' }), 'ref.jpg'));
      return asJson(await call(pid, p.baseUrl + '/images/edits', { form: fd }, signal));
    }
    const body = { prompt, n: 1, ...(p.sizeMode === 'wh' ? wh(size) : { size }), ...extra(p) };
    if (p.imageModel) body.model = p.imageModel;
    if (!noRespFormat.has(pid)) body.response_format = 'b64_json';
    if (refs.length) {
      const urls = refs.map((b) => 'data:image/jpeg;base64,' + b.toString('base64'));
      body[p.refField || 'image'] = p.refArray ? urls : urls[0];
    }
    return asJson(await call(pid, p.baseUrl + '/images/generations', { json: body }, signal));
  };
  let json;
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

/** Fournisseur utilisable pour le texte : celui demandé, sinon le premier qui a une clé et un modèle texte. */
function chatProvider(pid) {
  const ok = (id) => { const p = store.providerCfg(id); return p.type === 'openai' && p.chatModel && p.apiKey; };
  if (ok(pid)) return pid;
  const s = store.getSettings();
  const alt = [s.defaultProvider, ...Object.keys(s.providers)].find(ok);
  if (alt) return alt;
  throw new ApiError('Aucun fournisseur avec une clé et un modèle texte (Agnes, Pollinations ou Together) : l\'enrichissement et les idées de série en ont besoin', 400);
}

async function chat(pid, text, signal, system) {
  const id = chatProvider(pid), p = store.providerCfg(id);
  const json = await retry(async () => asJson(await call(id, p.baseUrl + '/chat/completions', {
    json: { model: p.chatModel, messages: [{ role: 'system', content: system || store.getSettings().enhancePrompt }, { role: 'user', content: text }] },
  }, signal)), signal);
  const out = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!out) throw new ApiError('Réponse vide du modèle de texte');
  return out.trim().replace(/^["“]|["”]$/g, '');
}

const parseJsonArray = (t) => { const m = /\[[\s\S]*\]/.exec(t); if (!m) throw new Error('pas de tableau JSON'); return JSON.parse(m[0]); };

/** Enrichit N descriptions en UN seul appel (beaucoup plus rapide) ; repli séquentiel si la réponse est mal formée. */
async function enhanceMany(pid, texts, signal) {
  if (texts.length === 1) return [await chat(pid, texts[0], signal)];
  try {
    const sys = store.getSettings().enhancePrompt + ` The user message is a JSON array of ${texts.length} scene descriptions. Rewrite EACH one this way and return ONLY a JSON array of ${texts.length} strings, in the same order, nothing else.`;
    const arr = parseJsonArray(await chat(pid, JSON.stringify(texts), signal, sys));
    if (Array.isArray(arr) && arr.length === texts.length && arr.every((x) => typeof x === 'string' && x.trim())) return arr.map((x) => x.trim());
  } catch (e) { if (e.name === 'AbortError') throw e; }
  const out = [];
  for (const t of texts) out.push(await chat(pid, t, signal));
  return out;
}

/** Propose les prompts des prochains épisodes d'une série. */
async function seriesIdeas(pid, info, count, signal) {
  const sys = 'You are a screenwriter for a series of short AI-generated videos. Given the first episode, propose the next episodes. ' +
    `Return ONLY a JSON array of exactly ${count} objects {"title": short episode title in the user's language, "prompt": vivid image-generation prompt in English, 40-70 words, describing a single continuous shot}. ` +
    'Keep the same main characters, art style and tone; each episode must advance the story with a new situation.';
  const user = `Series title: ${info.title}\nStyle: ${info.style || 'n/a'}\nEpisode 1 prompts: ${info.prompts.map((x, i) => `${i + 1}) ${x}`).join(' ')}`;
  const arr = parseJsonArray(await chat(pid, user, signal, sys));
  const eps = (Array.isArray(arr) ? arr : []).map((e) => ({ title: String((e && e.title) || '').slice(0, 80), prompt: String((e && e.prompt) || '').slice(0, 1500) })).filter((e) => e.prompt.trim());
  if (!eps.length) throw new ApiError('Le modèle n\'a pas renvoyé d\'idées exploitables, réessaie');
  return eps.slice(0, count).map((e, i) => ({ title: e.title || `Épisode ${i + 2}`, prompt: e.prompt }));
}

module.exports = { acquire, image, chat, enhanceMany, seriesIdeas };
