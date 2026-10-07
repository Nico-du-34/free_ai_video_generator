'use strict';
// Moteur de génération côté serveur : les instances continuent même si le navigateur est fermé.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');
const providers = require('./providers');
const media = require('./media');
const { clamp, uid, retry } = require('./util');

const jobs = new Map();
const runners = new Map();
const MODES = ['chain', 'anchor', 'none'];

const jobDir = (id) => path.join(store.dirs.jobs, id);
const framesDir = (id) => path.join(jobDir(id), 'frames');
const framePath = (id, i) => path.join(framesDir(id), String(i + 1).padStart(5, '0') + '.png');
const videoPath = (id) => path.join(jobDir(id), 'video.mp4');
const assetPath = (id) => path.join(store.dirs.assets, id + '.jpg');

/* ---------- Persistance ---------- */
const timers = new Map();
function persist(job, now) {
  const write = () => { timers.delete(job.id); if (jobs.has(job.id)) { try { store.writeJSON(path.join(jobDir(job.id), 'job.json'), job); } catch (e) { console.error('persist', e.message); } } };
  if (now) { clearTimeout(timers.get(job.id)); return write(); }
  if (!timers.has(job.id)) timers.set(job.id, setTimeout(write, 500));
}
function flushAll() { for (const j of jobs.values()) persist(j, true); }

/* ---------- Prompt d'une image ---------- */
function framePrompt(job, scene, k, n) {
  const p = n > 1 ? Math.round((k / (n - 1)) * 100) : 0;
  let t = [job.style, scene.prompt].filter(Boolean).join(', ');
  if (scene.motion) t += `. Motion in this shot: ${scene.motion}`;
  if (scene.endPrompt) t += `. The scene evolves progressively toward this end state: ${scene.endPrompt}`;
  if (scene.motion || scene.endPrompt) t += `. Current progress of the shot: ${p}%`;
  if (k > 0 && job.mode !== 'none') t += '. Keep exactly the same characters, designs, art style, camera and lighting as the reference image, only advance the action by one very small step.';
  return t + ` (frame ${k + 1} of ${n})`;
}
const plan = (job) => job.scenes.flatMap((s, si) => { const n = Math.max(1, Math.round(s.duration * job.fps)); return Array.from({ length: n }, (_, k) => ({ si, k, n })); });

/* ---------- Création ---------- */
function httpError(status, msg) { return Object.assign(new Error(msg), { status }); }
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
  const job = {
    id: 'j_' + uid(), title: str(spec.title, 120).trim() || 'Vidéo', provider, createdAt: Date.now(), status: 'paused',
    fps: clamp(Math.round(+spec.fps) || 12, 12, 60), size, mode: MODES.includes(spec.mode) ? spec.mode : 'chain',
    concurrency: clamp(Math.round(+spec.concurrency) || 1, 1, 6), style: str(spec.style, 500).trim(),
    enrichAuto: !!spec.enrichAuto, enriched: false, globalRefs: validRefs(spec.globalRefs),
    scenes: spec.scenes.map((s, i) => {
      const prompt = str(s.prompt, 4000).trim();
      if (!prompt) throw httpError(400, `La scène #${i + 1} n'a pas de prompt`);
      return { name: str(s.name, 80) || 'Scène ' + (i + 1), prompt, motion: str(s.motion, 500).trim(), endPrompt: str(s.endPrompt, 500).trim(), duration: clamp(+s.duration || 3, 0.5, 600), refs: validRefs(s.refs) };
    }),
    done: '', error: '', note: '', video: null, lastFrame: -1, spf: 0, assemble: 0,
  };
  const total = plan(job).length;
  if (total > 5000) throw httpError(400, `Trop d'images (${total}, max 5000) : réduis la durée ou les images/seconde`);
  job.done = '0'.repeat(total);
  fs.mkdirSync(framesDir(job.id), { recursive: true });
  jobs.set(job.id, job);
  persist(job, true);
  start(job);
  return job;
}
function cloneJob(job) {
  return createJob({ ...job, title: job.title + ' (copie)', enrichAuto: false });
}

/* ---------- Exécution ---------- */
class Runner {
  constructor(job) {
    this.job = job; this.plan = plan(job); this.ctl = new AbortController();
    this.inflight = new Set(); this.cache = new Map(); this.failed = false; this.waiters = []; this.lastDone = Date.now();
  }
  isDone(i) { return this.job.done[i] === '1'; }
  setDone(i) { const d = this.job.done; this.job.done = d.slice(0, i) + '1' + d.slice(i + 1); }
  firstIdx(si) { return this.plan.findIndex((f) => f.si === si); }
  notify() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  waitChange() { return new Promise((res) => this.waiters.push(res)); }

  pick() {
    for (let i = 0; i < this.plan.length; i++) {
      if (this.isDone(i) || this.inflight.has(i)) continue;
      const f = this.plan[i];
      if (this.job.mode === 'chain' && i > 0 && !this.isDone(i - 1)) return -1;
      if (this.job.mode === 'anchor' && f.k > 0 && !this.isDone(this.firstIdx(f.si))) continue;
      return i;
    }
    return -1;
  }

  async run() {
    const job = this.job;
    job.status = 'running'; job.error = ''; job.note = '';
    this.lastDone = Date.now();
    persist(job, true);
    if (job.enrichAuto && !job.enriched) await this.enrich();
    if (this.ctl.signal.aborted) return;
    const conc = job.mode === 'chain' ? 1 : clamp(job.concurrency, 1, 6);
    await Promise.all(Array.from({ length: conc }, () => this.worker()));
    if (this.ctl.signal.aborted) return;
    if (this.failed) { job.status = 'error'; persist(job, true); return; }
    if (!job.done.includes('0')) await assemble(job); else { job.status = 'paused'; persist(job, true); }
  }

  async enrich() {
    const job = this.job;
    job.note = 'Enrichissement des prompts…';
    try {
      for (const s of job.scenes) s.prompt = await providers.chat(job.provider, s.prompt, this.ctl.signal);
    } catch (e) {
      if (e.name === 'AbortError') return;
      job.note = 'Enrichissement ignoré : ' + e.message;
    }
    job.enriched = true; if (job.note === 'Enrichissement des prompts…') job.note = '';
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
        this.failed = true; this.job.error = `Image ${i + 1} : ${e.message}`;
        return;
      } finally { this.inflight.delete(i); this.notify(); }
    }
  }

  async cached(key, fn) {
    if (!this.cache.has(key)) { this.cache.set(key, await fn()); if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value); }
    return this.cache.get(key);
  }

  async frame(i) {
    const job = this.job, sig = this.ctl.signal, f = this.plan[i], scene = job.scenes[f.si];
    const refs = [];
    const fromFrame = (k) => this.cached('f' + k, async () => media.toJpeg(await fsp.readFile(framePath(job.id, k)), 768));
    if (job.mode === 'chain' && i > 0) refs.push(await fromFrame(i - 1));
    else if (job.mode === 'anchor' && f.k > 0) refs.push(await fromFrame(this.firstIdx(f.si)));
    for (const id of [...scene.refs, ...job.globalRefs]) {
      try { refs.push(await this.cached(id, () => fsp.readFile(assetPath(id)))); } catch { /* référence supprimée : ignorée */ }
    }
    const images = refs.slice(0, store.getSettings().maxRefs);
    const prompt = framePrompt(job, scene, f.k, f.n);
    const buf = await retry(async () => {
      await providers.acquire(job.provider, sig);
      const t0 = Date.now();
      const b = await providers.image(job.provider, { prompt, size: job.size, refs: images }, sig);
      store.noteLatency(job.provider, Date.now() - t0);
      return b;
    }, sig, (e, n) => { job.note = `Nouvel essai ${n}/4 : ${e.message}`; });
    const png = await media.toPng(buf);
    const file = framePath(job.id, i);
    await fsp.writeFile(file + '.tmp', png);
    await fsp.rename(file + '.tmp', file);
    this.setDone(i);
    job.lastFrame = i; job.note = '';
    const now = Date.now(), iv = (now - this.lastDone) / 1000;
    this.lastDone = now;
    job.spf = job.spf ? job.spf * 0.7 + iv * 0.3 : iv;
    persist(job);
  }
}

function start(job) {
  if (runners.has(job.id) || job.status === 'assembling') return;
  const r = new Runner(job);
  runners.set(job.id, r);
  r.run().catch((e) => { job.status = 'error'; job.error = e.message; persist(job, true); })
    .finally(() => { if (runners.get(job.id) === r) runners.delete(job.id); });
}
function pause(job) {
  const r = runners.get(job.id);
  if (r) { r.ctl.abort(); runners.delete(job.id); }
  if (job.status === 'running') { job.status = 'paused'; job.note = ''; }
  persist(job, true);
}

async function assemble(job) {
  if (job.status === 'assembling') return;
  job.status = 'assembling'; job.error = ''; job.note = ''; job.assemble = 0;
  persist(job, true);
  const seq = path.join(jobDir(job.id), 'seq');
  try {
    await fsp.rm(seq, { recursive: true, force: true });
    await fsp.mkdir(seq, { recursive: true });
    const total = job.done.length;
    let last = job.done.indexOf('1');
    if (last < 0) throw new Error('aucune image générée');
    let frames = 0;
    for (let i = 0; i < total; i++) {      // images manquantes : on répète la précédente
      if (job.done[i] === '1') { last = i; frames++; }
      await fsp.symlink(framePath(job.id, last), path.join(seq, String(i + 1).padStart(5, '0') + '.png'));
    }
    const out = videoPath(job.id) + '.tmp.mp4';
    await media.encodeVideo(path.join(seq, '%05d.png'), job.fps, out, total, (p) => { job.assemble = p; });
    await fsp.rename(out, videoPath(job.id));
    const st = await fsp.stat(videoPath(job.id));
    job.video = { size: st.size, at: Date.now(), frames };
    job.status = job.done.includes('0') ? 'paused' : 'done';
  } catch (e) {
    job.status = 'error'; job.error = 'Assemblage : ' + e.message;
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
    if (job.status === 'running') start(job);
    else if (job.status === 'assembling') { job.status = 'paused'; assemble(job); }
  }
  console.log(`${jobs.size} instance(s) chargée(s)`);
}

const list = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
const get = (id) => jobs.get(id);

module.exports = { boot, list, get, createJob, cloneJob, start, pause, assemble, remove, flushAll, framePrompt, plan, framePath, videoPath, assetPath, httpError };
