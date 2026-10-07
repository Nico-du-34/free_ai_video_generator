'use strict';
const store = require('./store');
const { ApiError, sleep, retry } = require('./util');
const usage = require('./usage');

/* Limiteur : un quota images/minute par fournisseur, partagé par toutes les instances.
   Après un 429, le débit est divisé par deux pendant 2 minutes (ralentissement adaptatif). */
const stamps = new Map();
const cool = new Map();
function effectiveRpm(pid) {
  const rpm = Math.max(1, store.providerCfg(pid).rpm);
  return (cool.get(pid) || 0) > Date.now() ? Math.max(1, Math.floor(rpm / 2)) : rpm;
}
function quotaState(pid) {
  const now = Date.now();
  const used = (stamps.get(pid) || []).filter((t) => now - t < 60000).length;
  return { used, limit: effectiveRpm(pid), cooling: Math.max(0, (cool.get(pid) || 0) - now) };
}
async function acquireKey(key, rpm, signal) {
  for (;;) {
    const now = Date.now();
    const a = (stamps.get(key) || []).filter((t) => now - t < 60000);
    stamps.set(key, a);
    if (a.length < Math.max(1, rpm)) { a.push(now); return; }
    await sleep(a[0] + 60000 - now + 50, signal);
  }
}
/** Quota vidéo : requêtes/minute + secondes de vidéo par jour. */
async function acquireVideo(pid, sec, signal) {
  const p = store.providerCfg(pid);
  if (p.videoDailySeconds > 0 && usage.videoSecToday(pid) + sec > p.videoDailySeconds) {
    throw new ApiError(`Quota vidéo du jour atteint : ${usage.videoSecToday(pid)}/${p.videoDailySeconds} s avec ${p.label} (remise à zéro à minuit UTC ; réglable dans Réglages › Avancé)`, 403);
  }
  await acquireKey(pid + ':video', p.videoRpm || 1, signal);
}
async function acquire(pid, signal) {
  const lim = store.providerCfg(pid).dailyLimit;
  if (lim > 0 && usage.imagesToday(pid) >= lim) throw new ApiError(`Limite quotidienne atteinte : ${usage.imagesToday(pid)}/${lim} images aujourd'hui avec ${store.providerCfg(pid).label} (modifiable dans Réglages › Avancé)`, 403);
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
async function call(pid, url, { json, form, kind = 'image', sec = 0 }, signal) {
  const p = store.providerCfg(pid);
  if (!p.apiKey) throw new ApiError(`Clé API ${p.label} manquante (onglet Réglages)`, 401);
  if (/VOTRE_ACCOUNT_ID/.test(url)) throw new ApiError('Renseigne ton Account ID Cloudflare dans l\'URL de base (Réglages › Avancé)', 400);
  const timeout = AbortSignal.timeout(240000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', signal: sig,
      headers: { Authorization: 'Bearer ' + p.apiKey, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
  } catch (e) {
    if (signal && signal.aborted) throw e;
    usage.record({ service: pid, kind, ok: false, status: 0, msg: 'Réseau : ' + ((e.cause && e.cause.message) || e.message) });
    throw new ApiError('Réseau : ' + ((e.cause && e.cause.message) || e.message), 0);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  usage.noteHeaders(pid, res.headers);
  if (!res.ok) {
    if (res.status === 429) cool.set(pid, Date.now() + 120000);
    const text = buf.toString('utf8', 0, 600);
    let body; try { body = JSON.parse(text); } catch { /* pas du JSON */ }
    const msg = (body && ((body.error && (body.error.message || body.error)) || body.message || (body.errors && body.errors[0] && body.errors[0].message))) || text.slice(0, 200) || res.statusText;
    usage.record({ service: pid, kind, ok: false, status: res.status, msg: typeof msg === 'string' ? msg : JSON.stringify(msg) });
    throw new ApiError(`HTTP ${res.status} : ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, res.status, parseFloat(res.headers.get('retry-after')) || 0);
  }
  usage.record({ service: pid, kind, ok: true, ms: Date.now() - t0, status: res.status, sec });
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


/* ---------- Vidéo IA native ---------- */
const noVideoRef = new Set();
const videoKinds = () => Object.entries(store.getSettings().providers).filter(([, p]) => p.videoKind).map(([id]) => id);

function findStatus(j) {
  const c = [j && j.status, j && j.state, j && j.data && j.data.status, j && j.result && j.result.status, j && j.task_status];
  const v = c.find((x) => typeof x === 'string');
  return v || '';
}
function findVideoUrl(o) {
  const found = [];
  const walk = (v, key, depth) => {
    if (depth > 5 || v == null) return;
    if (typeof v === 'string') { if (/^https?:\/\/\S+$/i.test(v) && (/\.(mp4|webm|mov)(\?|$)/i.test(v) || /video|output|result|download|url/i.test(key))) found.push({ key, v }); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key, depth + 1)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(o, '', 0);
  const best = found.find((f) => /\.(mp4|webm|mov)(\?|$)/i.test(f.v)) || found.find((f) => /video/i.test(f.key)) || found[0];
  return best ? best.v : null;
}
async function download(url, signal) {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
  let r;
  try { r = await fetch(url, { signal: sig }); } catch (e) { if (signal && signal.aborted) throw e; throw new ApiError('Téléchargement de la vidéo impossible : ' + ((e.cause && e.cause.message) || e.message), 0); }
  if (!r.ok) throw new ApiError('Téléchargement de la vidéo impossible (HTTP ' + r.status + ')', r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function videoAgnes(pid, p, o, signal) {
  const origin = new URL(p.baseUrl).origin;
  let id = o.videoId;
  if (!id) {
    const body = { model: p.videoModel || 'agnes-video-v2.0', prompt: o.prompt, width: o.width, height: o.height, num_frames: 8 * Math.max(1, Math.round((o.sec * o.fps) / 8)) + 1, frame_rate: o.fps };
    const refKey = p.refField || 'image';
    if (o.ref && !noVideoRef.has(pid)) { const u = 'data:image/jpeg;base64,' + o.ref.toString('base64'); body[refKey] = p.refArray ? [u] : u; }
    let json;
    try { json = asJson(await call(pid, p.baseUrl + '/videos', { json: body, kind: 'video', sec: o.sec }, signal)); } catch (e) {
      if (body[refKey] && e.status === 400 && !noVideoRef.has(pid)) { noVideoRef.add(pid); delete body[refKey]; json = asJson(await call(pid, p.baseUrl + '/videos', { json: body, kind: 'video', sec: o.sec }, signal)); } else throw e;
    }
    id = json.video_id || json.id || (json.data && (json.data.video_id || json.data.id)) || (Array.isArray(json.data) && json.data[0] && (json.data[0].video_id || json.data[0].id));
    if (!id) throw new ApiError('Réponse inattendue (pas de video_id) : ' + JSON.stringify(json).slice(0, 200));
    if (o.onId) o.onId(id, json);
  }
  const t0 = Date.now();
  let misses = 0, first = true;
  for (;;) {
    await sleep(first ? 3000 : 6000, signal); first = false;
    if (Date.now() - t0 > 25 * 60000) throw new ApiError('Délai dépassé : le clip n\'est pas prêt après 25 min', 0);
    let j;
    try {
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
      const r = await fetch(`${origin}/agnesapi?video_id=${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + p.apiKey }, signal: sig });
      usage.noteHeaders(pid, r.headers);
      const text = await r.text();
      if (!r.ok) { if (r.status === 401 || r.status === 403) throw new ApiError(`HTTP ${r.status} : ${text.slice(0, 160)}`, r.status); if (++misses > 8) throw new ApiError(`Suivi du clip impossible (HTTP ${r.status})`, r.status); continue; }
      try { j = JSON.parse(text); } catch { if (++misses > 8) throw new ApiError('Réponse de suivi illisible : ' + text.slice(0, 120)); continue; }
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (e instanceof ApiError && e.status && e.status < 500) throw e;
      if (++misses > 8) throw e instanceof ApiError ? e : new ApiError('Réseau : ' + e.message, 0);
      continue;
    }
    misses = 0;
    const status = findStatus(j), url = findVideoUrl(j);
    if (o.onStatus) o.onStatus(status || 'en cours', Math.round((Date.now() - t0) / 1000), j);
    if (url) return download(url, signal);
    if (/fail|error|cancel|reject|timeout|expired/i.test(status)) throw Object.assign(new ApiError('Génération vidéo refusée ou échouée : ' + JSON.stringify(j).slice(0, 220), 422), { fatalVideo: true });
  }
}
async function videoPollinations(pid, p, o, signal) {
  const origin = new URL(p.baseUrl).origin;
  const q = new URLSearchParams({ duration: String(Math.round(o.sec)), width: String(o.width), height: String(o.height), audio: 'false' });
  if (p.videoModel) q.set('model', p.videoModel);
  if (o.refUrl) q.set('image', o.refUrl);
  const url = `${origin}/video/${encodeURIComponent(o.prompt.slice(0, 1200))}?${q}`;
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(20 * 60000)]) : AbortSignal.timeout(20 * 60000);
  const t0 = Date.now();
  let res;
  try { res = await fetch(url, { headers: { Authorization: 'Bearer ' + p.apiKey }, signal: sig }); } catch (e) {
    if (signal && signal.aborted) throw e;
    usage.record({ service: pid, kind: 'video', ok: false, msg: 'Réseau : ' + e.message });
    throw new ApiError('Réseau : ' + ((e.cause && e.cause.message) || e.message), 0);
  }
  usage.noteHeaders(pid, res.headers);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || !/video|octet/i.test(res.headers.get('content-type') || '')) {
    const msg = buf.toString('utf8', 0, 300);
    usage.record({ service: pid, kind: 'video', ok: false, status: res.status, msg });
    throw new ApiError(`HTTP ${res.status} : ${msg.slice(0, 200)}`, res.ok ? 502 : res.status, parseFloat(res.headers.get('retry-after')) || 0);
  }
  usage.record({ service: pid, kind: 'video', ok: true, ms: Date.now() - t0, status: res.status, sec: o.sec });
  return buf;
}
/** Génère UN clip vidéo. o : { prompt, width, height, sec, fps, ref?, refUrl?, videoId?, onId?, onStatus? } → Buffer mp4 */
async function video(pid, o, signal) {
  const p = store.providerCfg(pid);
  if (!p.apiKey) throw new ApiError(`Clé API ${p.label} manquante (onglet Réglages)`, 401);
  if (p.videoKind === 'agnes') return videoAgnes(pid, p, o, signal);
  if (p.videoKind === 'pollinations') return videoPollinations(pid, p, o, signal);
  throw new ApiError(`${p.label} ne propose pas de génération vidéo`, 400);
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
    kind: 'chat', json: { model: p.chatModel, messages: [{ role: 'system', content: system || store.getSettings().enhancePrompt }, { role: 'user', content: text }] },
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

/** Écrit une narration (voix off) par scène, calée sur la durée de chaque scène. */
async function narrate(pid, scenes, lang, signal) {
  const L = { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese' }[lang] || 'French';
  const sys = `You write the voice-over narration of a short video. For each scene, write natural spoken narration in ${L}, about 2.3 words per second of that scene's duration (never more), without stage directions or quotes. Return ONLY a JSON array of ${scenes.length} strings, in scene order.`;
  const arr = parseJsonArray(await chat(pid, JSON.stringify(scenes.map((s) => ({ scene: s.prompt, seconds: s.duration }))), signal, sys));
  if (!Array.isArray(arr) || arr.length !== scenes.length) throw new ApiError('Le modèle n\'a pas renvoyé une narration par scène, réessaie');
  return arr.map((x) => String(x || '').trim().slice(0, 1500));
}

module.exports = { video, videoKinds, acquireVideo, quotaState, acquire, image, chat, enhanceMany, seriesIdeas, narrate, call, asJson };
