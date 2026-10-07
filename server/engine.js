'use strict';
// Moteur de génération côté serveur : les instances continuent même si le navigateur est fermé.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');
const providers = require('./providers');
const media = require('./media');
const audio = require('./audio');
const { clamp, uid, retry } = require('./util');

const jobs = new Map();
const runners = new Map();
const MODES = ['chain', 'anchor', 'none'];
const INTERP = process.env.INTERPOLATION === 'blend' ? 'blend' : 'mci';
// done[i] : '1' générée · '0' à générer · '-' non générée (interpolée à l'assemblage)

const jobDir = (id) => path.join(store.dirs.jobs, id);
const framesDir = (id) => path.join(jobDir(id), 'frames');
const framePath = (id, i) => path.join(framesDir(id), String(i + 1).padStart(5, '0') + '.png');
const videoPath = (id) => path.join(jobDir(id), 'video.mp4');
const clipPath = (id, i) => path.join(jobDir(id), 'clips', 'c_' + String(i + 1).padStart(5, '0') + '.mp4');
const silentPath = (id) => path.join(jobDir(id), 'video_silent.mp4');
const audioDir = (id) => path.join(jobDir(id), 'audio');
const assetPath = (id) => path.join(store.dirs.assets, id + '.jpg');
const httpError = (status, msg) => Object.assign(new Error(msg), { status });

/* ---------- Persistance ---------- */
const timers = new Map();
function persist(job, now) {
  const write = () => { timers.delete(job.id); if (jobs.has(job.id)) { try { store.writeJSON(path.join(jobDir(job.id), 'job.json'), job); } catch (e) { console.error('persist', e.message); } } };
  if (now) { clearTimeout(timers.get(job.id)); return write(); }
  if (!timers.has(job.id)) timers.set(job.id, setTimeout(write, 500));
}
function flushAll() { for (const j of jobs.values()) persist(j, true); }

/* ---------- Console de l'instance ---------- */
function log(job, lvl, msg) {
  job.logSeq = (job.logSeq || 0) + 1;
  (job.log = job.log || []).push({ n: job.logSeq, t: Date.now(), l: lvl, m: String(msg).slice(0, 600) });
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
}
const logLines = (job, since) => ({ lines: (job.log || []).filter((x) => x.n > since), last: job.logSeq || 0 });
const slim = (job) => ({ ...job, log: undefined, logN: job.logSeq || 0 });

/* ---------- Prompt et plan ---------- */
function framePrompt(job, scene, k, n) {
  if (job.engine === 'slides') {
    let t = [job.style, scene.prompt].filter(Boolean).join(', ');
    if (scene.motion) t += `. Action: ${scene.motion}`;
    if (scene.endPrompt && n > 1) t += `. The story progresses toward: ${scene.endPrompt} (shot ${k + 1} of ${n})`;
    else if (n > 1) t += `. Shot ${k + 1} of ${n}, a different camera angle or moment of the same scene`;
    if (k > 0 && job.mode !== 'none') t += '. Keep exactly the same characters, designs, art style and setting as the reference image.';
    return t + '. Cinematic composition, sharp focus';
  }
  const p = n > 1 ? Math.round((k / (n - 1)) * 100) : 0;
  let t = [job.style, scene.prompt].filter(Boolean).join(', ');
  if (scene.motion) t += `. Motion in this shot: ${scene.motion}`;
  if (scene.endPrompt) t += `. The scene evolves progressively toward this end state: ${scene.endPrompt}`;
  if (scene.motion || scene.endPrompt) t += `. Current progress of the shot: ${p}%`;
  if (k > 0 && job.mode !== 'none') t += '. Keep exactly the same characters, designs, art style, camera and lighting as the reference image, only advance the action by one very small step.';
  return t + ` (frame ${k + 1} of ${n})`;
}
const plan = (job) => job.scenes.flatMap((s, si) => {
  if (job.engine === 'video' || job.engine === 'slides') {          // un élément = un clip IA ou une image fixe, avec sa durée
    const unit = job.engine === 'video' ? job.clipSec : job.slideSec;
    const n = Math.max(1, Math.ceil(s.duration / unit - 1e-9));
    return Array.from({ length: n }, (_, k) => ({ si, k, n, sec: k < n - 1 ? unit : +(s.duration - unit * (n - 1)).toFixed(3) }));
  }
  const n = Math.max(1, Math.round(s.duration * job.fps));
  return Array.from({ length: n }, (_, k) => ({ si, k, n }));
});
const ENGINES = ['video', 'slides', 'frames'];
const totalSeconds = (job) => job.scenes.reduce((a, s) => a + s.duration, 0);
/** Résolution demandée aux modèles vidéo (multiples de 32). */
function videoSize(size) {
  const [w, h] = size.split('x').map(Number), r = w / h;
  return r >= 1.6 ? [1152, 640] : r >= 1.2 ? [1024, 768] : r >= 0.9 ? [768, 768] : r >= 0.7 ? [768, 1024] : [640, 1152];
}
const evenSize = (size) => size.split('x').map((v) => Math.round(+v / 2) * 2);
const isKey = (f, ke) => f.k % ke === 0 || f.k === f.n - 1;
const countGen = (job) => (job.done.match(/[01]/g) || []).length;
const countDone = (job) => (job.done.match(/1/g) || []).length;

/** URL publique signée d'une image (pour les modèles vidéo qui n'acceptent qu'une URL) ; nécessite PUBLIC_URL. */
async function pubUrl(jobId, buf, name) {
  const base = process.env.PUBLIC_URL;
  if (!base) return null;
  const dir = path.join(jobDir(jobId), 'pub');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, name + '.jpg'), buf);
  return `${base.replace(/\/$/, '')}/pub/${jobId}/${name}.${store.sign(jobId + '/' + name)}`;
}

/* ---------- Création ---------- */
function validRefs(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((id) => typeof id === 'string' && store.ID_RE.test(id) && fs.existsSync(assetPath(id))).slice(0, 10);
}
function createJob(spec) {
  const settings = store.getSettings();
  const provider = settings.providers[spec.provider] ? spec.provider : settings.defaultProvider;
  const size = /^\d{3,4}x\d{3,4}$/.test(spec.size) ? spec.size : '1024x576';
  if (size.split('x').some((v) => +v > 2048)) throw httpError(400, 'Taille trop grande');
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) throw httpError(400, 'Au moins une scène est requise');
  if (spec.scenes.length > 50) throw httpError(400, '50 scènes maximum');
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const pcfg = settings.providers[provider];
  const engine = ENGINES.includes(spec.engine) ? spec.engine : 'frames';
  if (engine === 'video' && !pcfg.videoKind) throw httpError(400, `${pcfg.label} ne propose pas de génération vidéo : choisis Agnes ou Pollinations, ou le type « Images animées »`);
  const noRefs = pcfg.refMode === 'none' && engine !== 'video';
  const job = {
    engine, clipSec: clamp(+pcfg.videoMaxClip || 5, 2, 30), slideSec: clamp(+spec.slideSec || 3, 1.5, 10), clips: [],
    id: 'j_' + uid(), title: str(spec.title, 120).trim() || 'Vidéo', provider, createdAt: Date.now(), status: 'paused',
    fps: engine === 'video' ? clamp(+pcfg.videoFps || 24, 12, 60) : engine === 'slides' ? clamp(Math.round(+spec.fps) || 24, 12, 60) : clamp(Math.round(+spec.fps) || 12, 12, 60), size,
    mode: noRefs ? 'none' : engine === 'video' ? (pcfg.videoKind === 'pollinations' && !process.env.PUBLIC_URL ? 'none' : 'chain') : MODES.includes(spec.mode) ? spec.mode : 'chain',
    concurrency: clamp(Math.max(Math.round(+spec.concurrency) || 1, noRefs ? 3 : 1), 1, 6), keyEvery: engine === 'frames' ? clamp(Math.round(+spec.keyEvery) || 1, 1, 6) : 1,
    style: str(spec.style, 500).trim(),
    enrichAuto: !!spec.enrichAuto, enriched: false, globalRefs: validRefs(spec.globalRefs), audio: audio.normalize(spec.audio),
    series: spec.series && store.ID_RE.test(spec.series.id || '') ? { id: spec.series.id, title: str(spec.series.title, 120), ep: +spec.series.ep || 1, of: +spec.series.of || 1 } : null,
    scenes: spec.scenes.map((s, i) => {
      const prompt = str(s.prompt, 4000).trim();
      if (!prompt) throw httpError(400, `La scène #${i + 1} n'a pas de prompt`);
      return { name: str(s.name, 80) || 'Scène ' + (i + 1), prompt, motion: str(s.motion, 500).trim(), endPrompt: str(s.endPrompt, 500).trim(), duration: clamp(+s.duration || 3, 0.5, 600), refs: validRefs(s.refs), narration: str(s.narration, 1500).trim() };
    }),
    done: '', error: '', note: '', video: null, lastFrame: -1, spf: 0, assemble: 0, log: [], logSeq: 0,
  };
  const pl = plan(job);
  if (pl.length > (engine === 'frames' ? 5000 : 300)) throw httpError(400, engine === 'frames' ? `Trop d'images (${pl.length}, max 5000) : réduis la durée ou les images/seconde` : `Trop d'éléments (${pl.length}, max 300) : réduis la durée`);
  job.done = pl.map((f) => (isKey(f, job.keyEvery) ? '0' : '-')).join('');
  fs.mkdirSync(framesDir(job.id), { recursive: true });
  jobs.set(job.id, job);
  log(job, 'info', engine === 'video'
    ? `Instance créée : ${pl.length} clip(s) vidéo IA de ${job.clipSec} s max (${totalSeconds(job)} s au total) via ${pcfg.label}, sortie ${job.size} à ${job.fps} img/s`
    : engine === 'slides'
      ? `Instance créée : ${pl.length} image(s) fixes animées (≈${job.slideSec} s chacune, ${totalSeconds(job)} s au total) via ${pcfg.label} · zoom, panoramique et fondus`
      : `Instance créée : ${pl.length} images vidéo, ${countGen(job)} à générer via ${pcfg.label} (${job.size}, ${job.fps} img/s, mode ${job.mode}${job.keyEvery > 1 ? `, 1 image IA sur ${job.keyEvery} + interpolation` : ''})`);
  if (noRefs && spec.mode !== 'none') log(job, 'warn', `${settings.providers[provider].label} ne gère pas les images de référence : images indépendantes`);
  persist(job, true);
  start(job);
  return job;
}
function cloneJob(job) {
  return createJob({ ...job, title: job.title + ' (copie)', enrichAuto: false, series: null });
}

/* ---------- Séries ---------- */
async function seriesIdeas(job, count) {
  count = clamp(Math.round(+count) || 3, 1, 12);
  return providers.seriesIdeas(job.provider, { title: job.title, style: job.style, prompts: job.scenes.map((s) => s.prompt) }, count);
}
async function createSeries(origin, episodes, keepContinuity) {
  if (!Array.isArray(episodes) || !episodes.length) throw httpError(400, 'Aucun épisode');
  if (episodes.length > 12) throw httpError(400, '12 épisodes maximum à la fois');
  const total = origin.scenes.reduce((a, s) => a + s.duration, 0);
  const base = (origin.series && origin.series.title) || origin.title.replace(/\s*\(copie\)$/, '');
  const sid = (origin.series && origin.series.id) || 's_' + uid();
  const of = (origin.series ? origin.series.of : 1) + episodes.length;
  const firstEp = (origin.series ? origin.series.of : 1) + 1;
  const refs = [...origin.globalRefs];
  if (keepContinuity) {
    for (const s of origin.scenes) for (const r of s.refs) if (!refs.includes(r)) refs.push(r);
    const last = origin.done.lastIndexOf('1');
    if (last >= 0) {
      const id = 'a_' + uid();
      await fsp.writeFile(assetPath(id), await media.toJpeg(await fsp.readFile(framePath(origin.id, last)), 1024));
      refs.unshift(id);
    }
  }
  if (!origin.series) { origin.series = { id: sid, title: base, ep: 1, of }; }
  else origin.series.of = of;
  log(origin, 'info', `Converti en série « ${base} » : ${episodes.length} nouveaux épisodes`);
  persist(origin, true);
  return episodes.map((e, i) => createJob({
    ...origin, title: `${base} – ${String(e.title || `Épisode ${firstEp + i}`).slice(0, 80)}`, enrichAuto: false,
    globalRefs: refs.slice(0, 10), series: { id: sid, title: base, ep: firstEp + i, of },
    scenes: [{ name: String(e.title || 'Épisode').slice(0, 80), prompt: String(e.prompt || ''), duration: total, motion: '', endPrompt: '', refs: [] }],
  }));
}

/* ---------- Exécution ---------- */
class Runner {
  constructor(job) {
    this.job = job; this.plan = plan(job); this.ctl = new AbortController();
    this.inflight = new Set(); this.cache = new Map(); this.failed = false; this.waiters = []; this.lastDone = Date.now();
  }
  isDone(i) { return this.job.done[i] !== '0'; }
  setDone(i) { const d = this.job.done; this.job.done = d.slice(0, i) + '1' + d.slice(i + 1); }
  prevGen(i) { for (let j = i - 1; j >= 0; j--) if (this.job.done[j] !== '-') return j; return -1; }
  firstIdx(si) { return this.plan.findIndex((f) => f.si === si); }
  notify() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  waitChange() { return new Promise((res) => this.waiters.push(res)); }

  pick() {
    for (let i = 0; i < this.plan.length; i++) {
      if (this.isDone(i) || this.inflight.has(i)) continue;
      const f = this.plan[i], pg = this.prevGen(i);
      if (this.job.mode === 'chain' && pg >= 0 && this.job.done[pg] !== '1') return -1;
      if (this.job.mode === 'anchor' && f.k > 0 && this.job.done[this.firstIdx(f.si)] !== '1') continue;
      return i;
    }
    return -1;
  }

  async run() {
    const job = this.job;
    job.status = 'running'; job.error = ''; job.note = '';
    this.lastDone = Date.now();
    log(job, 'info', `▶ Démarrage (${countDone(job)}/${countGen(job)} éléments déjà générés)`);
    persist(job, true);
    if (job.enrichAuto && !job.enriched) await this.enrich();
    if (this.ctl.signal.aborted) return;
    if (audio.hasAudio(job)) {   // voix et ambiance sont préparées pendant que les images se génèrent
      audio.prepare(job, audioDir(job.id), this.ctl.signal)
        .then((r) => r && log(job, 'ok', `🔊 Audio prêt : ${r.voices.length} voix, ambiance ${r.ambient ? 'oui' : 'non'}`))
        .catch((e) => { if (e.name !== 'AbortError') log(job, 'warn', 'Préparation audio : ' + e.message); });
    }
    const conc = job.mode === 'chain' ? 1 : clamp(job.concurrency, 1, 6);
    await Promise.all(Array.from({ length: conc }, () => this.worker()));
    if (this.ctl.signal.aborted) return;
    if (this.failed) { job.status = 'error'; log(job, 'err', job.error); persist(job, true); return; }
    if (!job.done.includes('0')) await assemble(job); else { job.status = 'paused'; persist(job, true); }
  }

  async enrich() {
    const job = this.job;
    job.note = 'Enrichissement des prompts…';
    log(job, 'info', `Enrichissement de ${job.scenes.length} prompt(s) en un seul appel`);
    try {
      const out = await providers.enhanceMany(job.provider, job.scenes.map((s) => s.prompt), this.ctl.signal);
      job.scenes.forEach((s, i) => { s.prompt = out[i]; log(job, 'info', `  scène ${i + 1} : ${out[i].slice(0, 160)}`); });
    } catch (e) {
      if (e.name === 'AbortError') return;
      log(job, 'warn', 'Enrichissement ignoré : ' + e.message);
    }
    job.enriched = true; job.note = '';
    persist(job);
  }

  async worker() {
    const sig = this.ctl.signal;
    while (!sig.aborted && !this.failed) {
      const i = this.pick();
      if (i === -1) { if (!this.inflight.size) return; await this.waitChange(); continue; }
      this.inflight.add(i);
      try { await this.frame(i); } catch (e) {
        if (e.name === 'AbortError' || sig.aborted) return;
        if (e.fatalVideo && this.job.clips[i]) this.job.clips[i].videoId = null;
        this.failed = true; this.job.error = `${this.job.engine === 'video' ? 'Clip' : 'Image'} ${i + 1} : ${e.message}`;
        return;
      } finally { this.inflight.delete(i); this.notify(); }
    }
  }

  async cached(key, fn) {
    if (!this.cache.has(key)) {
      const pr = fn();
      this.cache.set(key, pr);
      pr.catch(() => this.cache.delete(key));
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(key);
  }

  /** Génère un clip avec un vrai modèle vidéo (asynchrone côté fournisseur). */
  async clip(i) {
    const job = this.job, sig = this.ctl.signal, f = this.plan[i], scene = job.scenes[f.si], p = store.providerCfg(job.provider);
    const [W, H] = videoSize(job.size);
    let ref = null, refUrl = null;
    if (job.mode === 'chain' && f.k > 0 && job.done[i - 1] === '1') {
      try { ref = await this.cached('l' + (i - 1), () => media.lastFrame(clipPath(job.id, i - 1))); } catch (e) { log(job, 'warn', 'Dernière image du clip précédent illisible : ' + e.message); }
    } else if (f.k === 0) {
      const id = scene.refs[0] || job.globalRefs[0];
      if (id) { try { ref = await fsp.readFile(assetPath(id)); } catch { /* référence supprimée */ } }
    }
    if (ref && p.videoKind === 'pollinations') { refUrl = await pubUrl(job.id, ref, `r${i}`); if (!refUrl) ref = null; }
    let prompt = [job.style, scene.prompt].filter(Boolean).join(', ');
    if (scene.motion) prompt += `. Camera and action: ${scene.motion}`;
    if (f.k > 0) prompt += '. Continue the same shot seamlessly, same characters, same setting and style.';
    if (scene.endPrompt && f.k === f.n - 1) prompt += `. The shot ends with: ${scene.endPrompt}`;
    const st = (job.clips[i] = job.clips[i] || {});
    log(job, 'dbg', `→ clip ${countDone(job) + 1}/${job.done.length} (${f.sec} s) ${st.videoId ? 'reprise du suivi ' + st.videoId : 'soumis'} · ${ref ? 'image de départ' : 'texte seul'} · ${prompt.slice(0, 140)}`);
    const t0 = Date.now();
    let lastSt = '', lastLog = 0;
    const buf = await retry(async () => {
      if (!st.videoId) await providers.acquireVideo(job.provider, f.sec, sig);
      return providers.video(job.provider, {
        prompt, width: W, height: H, sec: f.sec, fps: job.fps, ref, refUrl, videoId: st.videoId,
        onId: (id, raw) => { st.videoId = id; persist(job, true); log(job, 'info', `Clip n°${i + 1} accepté par ${p.label} (video_id ${id})`); log(job, 'dbg', 'Réponse : ' + JSON.stringify(raw).slice(0, 300)); },
        onStatus: (status, sec, raw) => {
          job.note = `Clip ${countDone(job) + 1}/${job.done.length} : ${status} (${sec} s)`;
          if (status !== lastSt || Date.now() - lastLog > 60000) { lastSt = status; lastLog = Date.now(); log(job, 'dbg', `Suivi du clip n°${i + 1} : ${status} (${sec} s) ${JSON.stringify(raw).slice(0, 200)}`); }
        },
      }, sig);
    }, sig, (e, n, wait) => { job.note = `Nouvel essai ${n}/4 : ${e.message}`; log(job, 'warn', `Clip n°${i + 1} : ${e.message} — nouvel essai ${n}/4 dans ${(wait / 1000).toFixed(0)} s`); });
    store.noteLatency(job.provider + ':video', Date.now() - t0);
    const file = clipPath(job.id, i);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file + '.tmp', buf);
    await fsp.rename(file + '.tmp', file);
    this.setDone(i);
    st.videoId = null;
    job.lastFrame = i; job.note = '';
    const now = Date.now(), iv = (now - this.lastDone) / 1000;
    this.lastDone = now;
    job.spf = job.spf ? job.spf * 0.7 + iv * 0.3 : iv;
    log(job, 'ok', `✓ clip ${countDone(job)}/${job.done.length} reçu en ${((now - t0) / 1000).toFixed(0)} s (${(buf.length / 1048576).toFixed(1)} Mo)`);
    persist(job);
  }

  async frame(i) {
    if (this.job.engine === 'video') return this.clip(i);
    const job = this.job, sig = this.ctl.signal, f = this.plan[i], scene = job.scenes[f.si];
    const refs = [];
    const fromFrame = (k) => this.cached('f' + k, async () => media.toJpeg(await fsp.readFile(framePath(job.id, k)), 640));
    const pg = this.prevGen(i);
    if (job.mode === 'chain' && pg >= 0) refs.push(await fromFrame(pg));
    else if (job.mode === 'anchor' && f.k > 0) refs.push(await fromFrame(this.firstIdx(f.si)));
    for (const id of [...scene.refs, ...job.globalRefs]) {
      try { refs.push(await this.cached(id, () => fsp.readFile(assetPath(id)))); } catch { /* référence supprimée : ignorée */ }
    }
    const images = refs.slice(0, store.getSettings().maxRefs);
    const prompt = framePrompt(job, scene, f.k, f.n);
    const rank = countDone(job) + 1, tot = countGen(job);
    log(job, 'dbg', `→ image ${rank}/${tot} (n°${i + 1}) envoyée · ${images.length} réf. · ${prompt.slice(0, 140)}`);
    const t0 = Date.now();
    const buf = await retry(async () => {
      await providers.acquire(job.provider, sig);
      const t = Date.now();
      const b = await providers.image(job.provider, { prompt, size: job.size, refs: images }, sig);
      store.noteLatency(job.provider, Date.now() - t);
      return b;
    }, sig, (e, n, wait) => { job.note = `Nouvel essai ${n}/4 : ${e.message}`; log(job, 'warn', `Image n°${i + 1} : ${e.message} — nouvel essai ${n}/4 dans ${(wait / 1000).toFixed(0)} s`); });

    // PNG pour l'assemblage + miniature de référence pour l'image suivante, en parallèle
    const file = framePath(job.id, i);
    const [png] = await Promise.all([
      media.toPng(buf),
      job.mode !== 'none' ? this.cached('f' + i, () => media.toJpeg(buf, 640)).catch(() => {}) : null,
    ]);
    await fsp.writeFile(file + '.tmp', png);
    await fsp.rename(file + '.tmp', file);
    this.setDone(i);
    job.lastFrame = i; job.note = '';
    const now = Date.now(), iv = (now - this.lastDone) / 1000;
    this.lastDone = now;
    job.spf = job.spf ? job.spf * 0.7 + iv * 0.3 : iv;
    log(job, 'ok', `✓ image ${countDone(job)}/${tot} reçue en ${((now - t0) / 1000).toFixed(1)} s (${(png.length / 1024).toFixed(0)} Ko)`);
    persist(job);
  }
}

function start(job) {
  if (runners.has(job.id) || job.status === 'assembling') return;
  const r = new Runner(job);
  runners.set(job.id, r);
  r.run().catch((e) => { job.status = 'error'; job.error = e.message; log(job, 'err', e.message); persist(job, true); })
    .finally(() => { if (runners.get(job.id) === r) runners.delete(job.id); });
}
function pause(job) {
  const r = runners.get(job.id);
  if (r) { r.ctl.abort(); runners.delete(job.id); }
  if (job.status === 'running') { job.status = 'paused'; job.note = ''; log(job, 'info', '⏸ Mise en pause'); }
  persist(job, true);
}

/** Vidéo finale = vidéo muette + mixage audio (si configuré) ; en cas d'échec audio on garde la version muette. */
async function finalizeVideo(job) {
  const out = videoPath(job.id), tmp = out + '.tmp.mp4';
  job.videoAudio = false;
  if (audio.hasAudio(job)) {
    job.assemble = 0.92;
    log(job, 'info', '🔊 Mixage de la voix et de l\'ambiance…');
    try { await audio.mix(job, audioDir(job.id), silentPath(job.id), tmp); await fsp.rename(tmp, out); job.videoAudio = true; return; } catch (e) {
      log(job, 'warn', 'Audio ignoré (vidéo muette conservée) : ' + e.message);
      job.note = 'Audio ignoré : ' + e.message;
      await fsp.rm(tmp, { force: true });
    }
  }
  await fsp.copyFile(silentPath(job.id), out);
}

/** Applique de nouveaux réglages audio sur une vidéo déjà assemblée (sans régénérer les images). */
async function remix(job, newAudio, narrations) {
  if (job.status === 'running' || job.status === 'assembling') throw httpError(409, 'Instance occupée');
  job.audio = audio.normalize(newAudio);
  if (Array.isArray(narrations)) job.scenes.forEach((s, i) => { if (typeof narrations[i] === 'string') s.narration = narrations[i].slice(0, 1500).trim(); });
  log(job, 'info', '🔊 Nouveaux réglages audio appliqués');
  if (!fs.existsSync(silentPath(job.id))) { persist(job, true); return; }   // pas encore de vidéo : pris en compte à l'assemblage
  const prev = job.status;
  job.status = 'assembling'; job.error = ''; job.note = ''; job.assemble = 0.5;
  persist(job, true);
  try {
    await finalizeVideo(job);
    const st = await fsp.stat(videoPath(job.id));
    job.video = { ...(job.video || { frames: 0 }), size: st.size, at: Date.now(), audio: !!job.videoAudio };
    log(job, 'ok', `✓ Audio appliqué${job.videoAudio ? '' : ' (aucune piste audio)'}`);
  } catch (e) { job.error = 'Audio : ' + e.message; log(job, 'err', job.error); }
  job.status = job.error ? 'error' : (prev === 'error' ? 'paused' : prev);
  job.assemble = 0;
  persist(job, true);
}

async function assemble(job) {
  if (job.status === 'assembling') return;
  job.status = 'assembling'; job.error = ''; job.note = ''; job.assemble = 0;
  log(job, 'info', '🎬 Assemblage de la vidéo (ffmpeg)…');
  persist(job, true);
  const seq = path.join(jobDir(job.id), 'seq');
  const t0 = Date.now();
  try {
    const out = silentPath(job.id) + '.tmp.mp4';
    let frames = 0, interp = false;
    const [W, H] = evenSize(job.size), pl = plan(job);
    const onP = (p) => { job.assemble = p * 0.9; };
    if (job.engine === 'video' || job.engine === 'slides') {
      const idx = [...job.done].map((c, i) => (c === '1' ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) throw new Error(job.engine === 'video' ? 'aucun clip généré' : 'aucune image générée');
      frames = idx.length;
      const files = idx.map((i) => (job.engine === 'video' ? clipPath(job.id, i) : framePath(job.id, i)));
      const secs = idx.map((i) => pl[i].sec);
      if (job.engine === 'video') await media.encodeClips(files, secs, W, H, job.fps, out, onP);
      else await media.encodeSlides(files, secs, W, H, job.fps, out, onP);
    } else {
      await fsp.rm(seq, { recursive: true, force: true });
      await fsp.mkdir(seq, { recursive: true });
      const total = job.done.length;
      const idxs = [...job.done].map((c, i) => (c === '-' ? -1 : i)).filter((i) => i >= 0);   // images à placer dans la séquence
      let last = job.done.indexOf('1');
      if (last < 0) throw new Error('aucune image générée');
      for (let k = 0; k < idxs.length; k++) {   // images manquantes : on répète la précédente
        if (job.done[idxs[k]] === '1') { last = idxs[k]; frames++; }
        await fsp.symlink(framePath(job.id, last), path.join(seq, String(k + 1).padStart(5, '0') + '.png'));
      }
      interp = job.keyEvery > 1 && idxs.length < total;
      await media.encodeVideo(path.join(seq, '%05d.png'), {
        inFps: interp ? job.fps * idxs.length / total : job.fps, outFps: job.fps, interp: interp ? INTERP : null,
      }, out, total, onP);
    }
    await fsp.rename(out, silentPath(job.id));
    await finalizeVideo(job);
    const st = await fsp.stat(videoPath(job.id));
    job.video = { size: st.size, at: Date.now(), frames, audio: !!job.videoAudio };
    job.status = job.done.includes('0') ? 'paused' : 'done';
    log(job, 'ok', `✓ Vidéo prête : ${(st.size / 1048576).toFixed(1)} Mo en ${((Date.now() - t0) / 1000).toFixed(1)} s${interp ? ' (interpolation ' + INTERP + ')' : ''}${job.videoAudio ? ' · avec audio' : ''}`);
  } catch (e) {
    job.status = 'error'; job.error = 'Assemblage : ' + e.message; log(job, 'err', job.error);
  }
  job.assemble = 0;
  await fsp.rm(seq, { recursive: true, force: true }).catch(() => {});
  persist(job, true);
}

async function remove(job) {
  pause(job);
  jobs.delete(job.id);
  clearTimeout(timers.get(job.id)); timers.delete(job.id);
  await fsp.rm(jobDir(job.id), { recursive: true, force: true });
}

function boot() {
  for (const id of fs.readdirSync(store.dirs.jobs)) {
    const job = store.readJSON(path.join(store.dirs.jobs, id, 'job.json'), null);
    if (!job || !store.ID_RE.test(job.id || '')) continue;
    jobs.set(job.id, job);
  }
  // reprise automatique après un redémarrage du serveur
  for (const job of jobs.values()) {
    if (job.status === 'running') { log(job, 'info', '↻ Reprise après redémarrage du serveur'); start(job); }
    else if (job.status === 'assembling') { job.status = 'paused'; assemble(job); }
  }
  console.log(`${jobs.size} instance(s) chargée(s)`);
}

const list = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(slim);
const get = (id) => jobs.get(id);

module.exports = { clipPath, audioDir, remix, boot, list, get, slim, createJob, cloneJob, seriesIdeas, createSeries, logLines, start, pause, assemble, remove, flushAll, framePrompt, plan, framePath, videoPath, assetPath, httpError };
