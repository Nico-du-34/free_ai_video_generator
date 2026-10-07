'use strict';
/* Moteur : chaque "instance" (job) a son propre Runner ; le quota API est partagé via Limiter. */
const Engine = {
  runners: new Map(),
  onChange: () => {},

  plan(job) {
    const out = [];
    job.scenes.forEach((s, si) => {
      const n = Math.max(1, Math.round(s.duration * job.fps));
      for (let k = 0; k < n; k++) out.push({ si, k, n });
    });
    return out;
  },

  framePrompt(job, scene, k, n) {
    const p = n > 1 ? Math.round((k / (n - 1)) * 100) : 0;
    let t = [job.style, scene.prompt].filter(Boolean).join(', ');
    if (scene.motion) t += `. Motion in this shot: ${scene.motion}`;
    if (scene.endPrompt) t += `. The scene evolves progressively toward this end state: ${scene.endPrompt}`;
    if (scene.motion || scene.endPrompt) t += `. Current progress of the shot: ${p}%`;
    if (k > 0 && job.mode !== 'none') {
      t += '. Keep exactly the same characters, designs, art style, camera and lighting as the reference image, only advance the action by one very small step.';
    }
    return t + ` (frame ${k + 1} of ${n})`;
  },

  start(job) {
    if (this.runners.has(job.id)) return;
    const r = new Runner(job);
    this.runners.set(job.id, r);
    r.run().finally(() => { if (this.runners.get(job.id) === r) this.runners.delete(job.id); });
  },

  pause(job) {
    const r = this.runners.get(job.id);
    if (r) { r.ctl.abort(); this.runners.delete(job.id); }
    if (job.status === 'running' || job.status === 'assembling') job.status = 'paused';
    job.note = '';
    this.emit(job);
  },

  async assemble(job) {
    if (job.status === 'assembling') return;
    job.status = 'assembling'; job.error = ''; job.note = 'Assemblage… garde cet onglet visible';
    this.emit(job);
    try {
      await Video.build(job, (p) => { job.assemble = p; this.emit(job); });
      job.status = job.done.includes('0') ? 'paused' : 'done';
    } catch (e) {
      job.status = 'error'; job.error = 'Assemblage : ' + e.message;
    }
    job.assemble = 0; job.note = '';
    this.emit(job);
  },

  emit(job) { saveJobs(); this.onChange(job); },
  doneCount(job) { return (job.done.match(/1/g) || []).length; },
};

class Runner {
  constructor(job) {
    this.job = job;
    this.plan = Engine.plan(job);
    this.ctl = new AbortController();
    this.inflight = new Set();
    this.cache = new Map();
    this.failed = false;
    this.waiters = [];
    this.lastDone = Date.now();
  }

  isDone(i) { return this.job.done[i] === '1'; }
  setDone(i) { const d = this.job.done; this.job.done = d.slice(0, i) + '1' + d.slice(i + 1); }
  firstIdx(si) { return this.plan.findIndex((f) => f.si === si); }
  notify() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  waitChange() { return new Promise((res) => this.waiters.push(res)); }

  pick() {
    const { job } = this;
    for (let i = 0; i < this.plan.length; i++) {
      if (this.isDone(i) || this.inflight.has(i)) continue;
      const f = this.plan[i];
      if (job.mode === 'chain' && i > 0 && !this.isDone(i - 1)) return -1;
      if (job.mode === 'anchor' && f.k > 0 && !this.isDone(this.firstIdx(f.si))) continue;
      return i;
    }
    return -1;
  }

  async run() {
    const { job } = this;
    job.status = 'running'; job.error = ''; job.note = '';
    this.lastDone = Date.now();
    Engine.emit(job);
    const conc = job.mode === 'chain' ? 1 : clamp(job.concurrency || 1, 1, 6);
    await Promise.all(Array.from({ length: conc }, () => this.worker()));
    if (this.ctl.signal.aborted) return;
    if (this.failed) { job.status = 'error'; Engine.emit(job); return; }
    if (!job.done.includes('0')) await Engine.assemble(job);
    else { job.status = 'paused'; Engine.emit(job); }
  }

  async worker() {
    const sig = this.ctl.signal;
    while (!sig.aborted && !this.failed) {
      const i = this.pick();
      if (i === -1) {
        if (!this.inflight.size) return;
        await this.waitChange();
        continue;
      }
      this.inflight.add(i);
      try { await this.frame(i); } catch (e) {
        if (e.name === 'AbortError' || sig.aborted) return;
        this.failed = true;
        this.job.error = `Image ${i + 1} : ${e.message}`;
        return;
      } finally { this.inflight.delete(i); this.notify(); }
    }
  }

  async frameData(i) {
    const key = 'f' + i;
    if (!this.cache.has(key)) {
      const b = await DB.get(`${this.job.id}:f:${i}`);
      this.cache.set(key, b ? await blobToDataURL(await downscale(b, 768, 0.85)) : null);
      if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(key);
  }
  async assetData(id) {
    if (!this.cache.has(id)) this.cache.set(id, await Assets.dataUrl(id));
    return this.cache.get(id);
  }

  async frame(i) {
    const { job } = this;
    const sig = this.ctl.signal;
    const f = this.plan[i];
    const scene = job.scenes[f.si];
    const refs = [];
    if (job.mode === 'chain' && i > 0) refs.push(await this.frameData(i - 1));
    else if (job.mode === 'anchor' && f.k > 0) refs.push(await this.frameData(this.firstIdx(f.si)));
    for (const id of [...scene.refs, ...(job.globalRefs || [])]) refs.push(await this.assetData(id));
    const images = refs.filter(Boolean).slice(0, Math.max(1, settings.maxRefs));
    const prompt = Engine.framePrompt(job, scene, f.k, f.n);

    const blob = await Api.retry(async () => {
      await Limiter.acquire(sig);
      const t0 = Date.now();
      const b = await Api.image({ prompt, size: job.size, refs: images }, sig);
      noteLatency(Date.now() - t0);
      return b;
    }, sig, (e, n) => { job.note = `Nouvel essai ${n}/4 : ${e.message}`; Engine.emit(job); });

    await DB.put(`${job.id}:f:${i}`, blob);
    this.setDone(i);
    job.lastFrame = i; job.note = '';
    const now = Date.now(), iv = (now - this.lastDone) / 1000;
    this.lastDone = now;
    job.spf = job.spf ? job.spf * 0.7 + iv * 0.3 : iv;
    Engine.emit(job);
  }
}

/* Assemblage vidéo : on rejoue les images sur un canvas à la cadence voulue et on l'enregistre. */
const Video = {
  pickMime() {
    const webm = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mp4 = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
    const list = settings.videoFormat === 'mp4' ? [...mp4, ...webm] : [...webm, ...mp4];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  },

  async build(job, onProgress) {
    const mime = this.pickMime();
    if (!mime) throw new Error('MediaRecorder non supporté par ce navigateur');
    const total = job.done.length;
    const idxs = [...job.done].map((c, i) => (c === '1' ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) throw new Error('aucune image générée');
    const load = async (i) => createImageBitmap(await DB.get(`${job.id}:f:${i}`));
    let last = await load(idxs[0]);
    const w = last.width & ~1, h = last.height & ~1;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(last, 0, 0, w, h);
    const rec = new MediaRecorder(canvas.captureStream(job.fps), { mimeType: mime, videoBitsPerSecond: 10e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((res) => (rec.onstop = res));
    rec.start(500);
    const step = 1000 / job.fps, t0 = performance.now();
    for (let i = 0; i < total; i++) {
      if (job.done[i] === '1') { last = await load(i); }
      ctx.drawImage(last, 0, 0, w, h);
      onProgress && onProgress((i + 1) / total);
      await sleep(Math.max(0, t0 + (i + 1) * step - performance.now()));
    }
    await sleep(step);
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    await DB.put(`${job.id}:video`, blob);
    job.video = { type: blob.type, size: blob.size, ext: blob.type.includes('mp4') ? 'mp4' : 'webm', frames: idxs.length, at: Date.now() };
  },
};
