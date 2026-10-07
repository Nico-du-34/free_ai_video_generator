'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const engine = require('./engine');
const providers = require('./providers');
const media = require('./media');
const audio = require('./audio');
const usage = require('./usage');
const { uid, retry, ApiError } = require('./util');

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const USER = process.env.APP_USER || 'admin';
const PASS = process.env.APP_PASSWORD || '';
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json', '.ico': 'image/x-icon' };

const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(b); };
const eq = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };

function authorized(req) {
  if (!PASS) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const [u, ...p] = Buffer.from(m[1], 'base64').toString().split(':');
  return eq(u, USER) & eq(p.join(':'), PASS) ? true : false;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 1e6) {
  const b = await readBody(req, limit);
  try { return b.length ? JSON.parse(b.toString()) : {}; } catch { throw engine.httpError(400, 'JSON invalide'); }
}

/** Envoi de fichier avec support des Range (lecture vidéo / seek). */
async function sendFile(req, res, file, type, { download, cache } = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return send(res, 404, { error: 'Introuvable' }); }
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': cache || 'no-cache', 'last-modified': st.mtime.toUTCString() };
  if (download) headers['content-disposition'] = `attachment; filename="${download}"`;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  let start = 0, end = st.size - 1, code = 200;
  if (m && (m[1] || m[2])) {
    start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]);
    end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    code = 206; headers['content-range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['content-length'] = end - start + 1;
  res.writeHead(code, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

const slug = (s) => (String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'video').toLowerCase();

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  let r;
  if (p === '/api/state' && m === 'GET') {
    return send(res, 200, { jobs: engine.list(), settings: store.publicSettings(), latency: store.stats.latency, time: Date.now() });
  }
  if (p === '/api/usage' && m === 'GET') {
    const o = await usage.overview(providers.quotaState);
    const js = engine.list();
    o.jobs = { total: js.length, running: js.filter((j) => j.status === 'running').length, assembling: js.filter((j) => j.status === 'assembling').length, error: js.filter((j) => j.status === 'error').length };
    return send(res, 200, o);
  }
  if (p === '/api/usage/check' && m === 'POST') {
    const b = await readJson(req);
    if (b.service) return send(res, 200, await usage.checkService(String(b.service)));
    const [c] = await Promise.all([usage.checkProvider(String(b.provider)), usage.refreshAccount(String(b.provider)).catch(() => null)]);
    return send(res, 200, c);
  }
  if (p === '/api/usage/reset' && m === 'POST') { usage.reset(); return send(res, 200, { ok: true }); }
  if (p === '/api/settings' && m === 'PUT') { store.updateSettings(await readJson(req)); return send(res, 200, store.publicSettings()); }
  if (p === '/api/test' && m === 'POST') {
    const b = await readJson(req);
    const pc = store.getSettings().providers[b.provider] && store.providerCfg(b.provider);
    if (!pc) throw engine.httpError(400, 'Fournisseur inconnu');
    if (!pc.apiKey) throw engine.httpError(400, `Clé API ${pc.label} manquante`);
    if (pc.type === 'openai' && pc.chatModel) {
      const out = await providers.chat(b.provider, 'a red apple');
      return send(res, 200, { ok: true, sample: out.slice(0, 120) });
    }
    const t0 = Date.now();                     // pas de modèle texte : on teste avec une vraie image
    await providers.acquire(b.provider);
    await providers.image(b.provider, { prompt: 'a red apple', size: '512x512' });
    return send(res, 200, { ok: true, sample: `image générée en ${((Date.now() - t0) / 1000).toFixed(1)} s` });
  }
  if (p === '/api/enhance' && m === 'POST') {
    const b = await readJson(req);
    if (!String(b.text || '').trim()) throw engine.httpError(400, 'Prompt vide');
    return send(res, 200, { text: await providers.chat(b.provider, String(b.text).slice(0, 4000)) });
  }
  if (p === '/api/preview' && m === 'POST') {
    const b = await readJson(req);
    const settings = store.getSettings();
    const provider = settings.providers[b.provider] ? b.provider : settings.defaultProvider;
    b.scene = b.scene || {};
    const scene = { prompt: String(b.scene.prompt || '').slice(0, 4000), motion: String(b.scene.motion || ''), endPrompt: String(b.scene.endPrompt || '') };
    if (!scene.prompt.trim()) throw engine.httpError(400, 'Prompt vide');
    const size = /^\d{3,4}x\d{3,4}$/.test(b.size) ? b.size : '1024x576';
    const prompt = engine.framePrompt({ style: String(b.style || ''), mode: 'none' }, scene, 0, Math.max(1, Math.round((+b.scene.duration || 3) * (+b.fps || 12))));
    const refs = [];
    for (const id of [...(b.scene.refs || []), ...(b.globalRefs || [])]) if (store.ID_RE.test(id)) { try { refs.push(await fsp.readFile(engine.assetPath(id))); } catch { /* ignorée */ } }
    const t0 = Date.now();
    const buf = await retry(async () => {
      await providers.acquire(provider);
      const t = Date.now();
      const out = await providers.image(provider, { prompt, size, refs: refs.slice(0, settings.maxRefs) });
      store.noteLatency(provider, Date.now() - t);
      return out;
    });
    const jpg = await media.toJpeg(buf, 1024);
    return send(res, 200, { image: 'data:image/jpeg;base64,' + jpg.toString('base64'), ms: Date.now() - t0, prompt });
  }
  if (p === '/api/audio/preview' && m === 'POST') {
    const b = await readJson(req);
    const mp3 = await audio.previewVoice(b.voice, b.text);
    return send(res, 200, { audio: 'data:audio/mpeg;base64,' + mp3.toString('base64') });
  }
  if (p === '/api/audio/ambient-preview' && m === 'POST') {
    const b = await readJson(req);
    const mp3 = await audio.previewAmbient(b.ambient, path.join(store.DATA, 'tmp'));
    return send(res, 200, { audio: 'data:audio/mpeg;base64,' + mp3.toString('base64') });
  }
  if (p === '/api/narrate' && m === 'POST') {
    const b = await readJson(req);
    if (!Array.isArray(b.scenes) || !b.scenes.length || b.scenes.length > 50) throw engine.httpError(400, 'Scènes invalides');
    const scenes = b.scenes.map((s) => ({ prompt: String(s.prompt || '').slice(0, 1500), duration: Math.max(0.5, +s.duration || 3) }));
    if (scenes.some((s) => !s.prompt.trim())) throw engine.httpError(400, 'Chaque scène doit avoir un prompt');
    return send(res, 200, { narrations: await providers.narrate(b.provider, scenes, audio.LANGS.includes(b.lang) ? b.lang : 'fr') });
  }
  if (p === '/api/assets' && m === 'POST') {
    const raw = await readBody(req, 15e6);
    if (!raw.length) throw engine.httpError(400, 'Fichier vide');
    let jpg; try { jpg = await media.toJpeg(raw, 1024); } catch { throw engine.httpError(400, 'Image illisible'); }
    const id = 'a_' + uid();
    await fsp.writeFile(engine.assetPath(id), jpg);
    return send(res, 200, { id });
  }
  if ((r = /^\/api\/assets\/([a-z0-9_]+)$/i.exec(p)) && m === 'GET') {
    if (!store.ID_RE.test(r[1])) return send(res, 404, { error: 'Introuvable' });
    return sendFile(req, res, engine.assetPath(r[1]), 'image/jpeg', { cache: 'public, max-age=31536000, immutable' });
  }
  if (p === '/api/jobs' && m === 'POST') return send(res, 201, engine.slim(engine.createJob(await readJson(req, 2e6))));

  if ((r = /^\/api\/jobs\/([a-z0-9_]+)(?:\/([a-z]+)(?:\/(\d+))?)?$/i.exec(p))) {
    const job = engine.get(r[1]);
    if (!job) return send(res, 404, { error: 'Instance introuvable' });
    const action = r[2];
    if (!action && m === 'DELETE') { await engine.remove(job); return send(res, 200, { ok: true }); }
    if (action === 'pause' && m === 'POST') { engine.pause(job); return send(res, 200, engine.slim(job)); }
    if (action === 'resume' && m === 'POST') { if (job.status !== 'done') engine.start(job); return send(res, 200, engine.slim(job)); }
    if (action === 'assemble' && m === 'POST') {
      if (job.status === 'running' || job.status === 'assembling') throw engine.httpError(409, 'Instance occupée');
      engine.assemble(job); return send(res, 202, engine.slim(job));
    }
    if (action === 'clone' && m === 'POST') return send(res, 201, engine.slim(engine.cloneJob(job)));
    if (action === 'audio' && m === 'POST') {
      const b = await readJson(req);
      await engine.remix(job, b.audio, b.narrations);
      return send(res, 202, engine.slim(job));
    }
    if (action === 'log' && m === 'GET') return send(res, 200, engine.logLines(job, +url.searchParams.get('since') || 0));
    if (action === 'series' && m === 'POST') {
      const b = await readJson(req);
      if (r[3] === undefined && b.ideas) return send(res, 200, { ideas: await engine.seriesIdeas(job, b.count) });
      return send(res, 201, { jobs: (await engine.createSeries(job, b.episodes, b.keepContinuity !== false)).map(engine.slim) });
    }
    if (action === 'frame' && m === 'GET') {
      const i = +r[3];
      if (!(job.done[i] === '1')) return send(res, 404, { error: 'Image non générée' });
      return sendFile(req, res, engine.framePath(job.id, i), 'image/png', { cache: 'public, max-age=31536000, immutable', download: url.searchParams.has('dl') ? `${slug(job.title)}-${String(i + 1).padStart(4, '0')}.png` : undefined });
    }
    if (action === 'video' && (m === 'GET' || m === 'HEAD')) {
      if (!job.video) return send(res, 404, { error: 'Pas encore de vidéo' });
      return sendFile(req, res, engine.videoPath(job.id), 'video/mp4', { download: url.searchParams.has('dl') ? slug(job.title) + '.mp4' : undefined });
    }
  }
  return send(res, 404, { error: 'Route inconnue' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Frame Studio", charset="UTF-8"' }); return res.end('Authentification requise'); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Interdit' });
    return await sendFile(req, res, file, MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.name === 'AbortError') return;
    // erreur du fournisseur d'IA → 502 (400 si c'est une clé manquante) ; erreur de validation → son propre code
    const upstream = e instanceof ApiError;
    const status = upstream ? (e.status === 401 && e.message.includes('manquante') ? 400 : 502)
      : e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: e.message }); else res.end();
  }
});
server.requestTimeout = 0;
server.headersTimeout = 30000;

engine.boot();
server.listen(PORT, HOST, () => {
  console.log(`Frame Studio → http://localhost:${PORT}  (données : ${store.DATA})`);
  if (!PASS) console.warn('⚠  APP_PASSWORD non défini : l\'application est accessible sans mot de passe. Définis-le avant toute mise en ligne.');
});
const shutdown = () => { engine.flushAll(); usage.flush(); server.close(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
