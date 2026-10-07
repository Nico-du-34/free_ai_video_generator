'use strict';
/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const slug = (s) => (String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'video').toLowerCase();
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}
function sleep(ms, signal) {
  return new Promise((res, rej) => {
    if (signal && signal.aborted) return rej(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => { signal && signal.removeEventListener('abort', onAbort); res(); }, ms);
    const onAbort = () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); };
    signal && signal.addEventListener('abort', onAbort, { once: true });
  });
}
function toast(msg, kind = '') {
  const box = $('#toasts');
  if (!box) return console.log(msg);
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}

/* ---------- localStorage : réglages, brouillon, bibliothèque, instances ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('afvg.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('afvg.' + k, JSON.stringify(v)); return true; }
    catch { toast('Stockage local plein ou indisponible', 'err'); return false; }
  },
};

const DEFAULT_ENHANCE = 'You are a prompt engineer for an AI image generator that produces the frames of a video. ' +
  'Rewrite the user\'s scene description as ONE vivid, detailed English prompt (subject, setting, lighting, camera angle, art style). ' +
  'Keep the user\'s intent and any named characters. Maximum 80 words. Output only the prompt, no quotes, no explanation.';

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://apihub.agnes-ai.com/v1',
  useProxy: location.protocol !== 'file:',
  imageModel: 'agnes-image-2.1-flash',
  chatModel: 'agnes-2.5-flash',
  rpm: 15,            // images/minute (limite gratuite 1K : 20)
  maxRefs: 4,         // nb max d'images envoyées par requête
  refField: 'image',
  refArray: true,
  videoFormat: 'webm',
  enhancePrompt: DEFAULT_ENHANCE,
};
let settings = { ...DEFAULTS, ...LS.get('settings', {}) };
const saveSettings = () => LS.set('settings', settings);

const newScene = (n = 1) => ({ id: uid(), libId: null, name: 'Scène ' + n, prompt: '', promptOriginal: '', motion: '', endPrompt: '', duration: 3, refs: [] });
const newDraft = () => ({ title: 'Ma vidéo', fps: 12, size: '1024x576', mode: 'chain', concurrency: 2, style: '', enrichAuto: false, globalRefs: [], scenes: [newScene()] });
let draft = Object.assign(newDraft(), LS.get('draft', {}));
if (!draft.scenes || !draft.scenes.length) draft.scenes = [newScene()];
let library = LS.get('library', []);
let jobs = LS.get('jobs', []);
let stats = LS.get('stats', { latency: 0 });
jobs.forEach((j) => { if (j.status === 'running' || j.status === 'assembling') j.status = 'paused'; });

let _t1, _t2;
const saveDraft = () => { clearTimeout(_t1); _t1 = setTimeout(() => LS.set('draft', draft), 300); };
const saveJobs = () => { clearTimeout(_t2); _t2 = setTimeout(() => LS.set('jobs', jobs), 400); };
const saveLibrary = () => LS.set('library', library);
function noteLatency(ms) {
  stats.latency = stats.latency ? stats.latency * 0.7 + ms * 0.3 : ms;
  LS.set('stats', stats);
}

/* ---------- IndexedDB : blobs (images de référence, frames, vidéos) ---------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('afvg', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('blobs', mode);
      const rq = fn(t.objectStore('blobs'));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  };
  const api = {
    put: (k, blob) => tx('readwrite', (s) => s.put(blob, k)),
    get: (k) => tx('readonly', (s) => s.get(k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
    keys: () => tx('readonly', (s) => s.getAllKeys()),
    async delPrefix(p) { for (const k of await api.keys()) if (String(k).startsWith(p)) await api.del(k); },
  };
  return api;
})();

const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function downscale(blob, max, quality = 0.9) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
}

const Assets = {
  cache: new Map(),
  async add(file) { const id = 'a_' + uid(); await DB.put(id, await downscale(file, 1024)); return id; },
  async url(id) {
    if (!this.cache.has(id)) {
      const b = await DB.get(id);
      if (!b) return '';
      this.cache.set(id, URL.createObjectURL(b));
    }
    return this.cache.get(id);
  },
  async dataUrl(id) { const b = await DB.get(id); return b ? blobToDataURL(await downscale(b, 768, 0.85)) : null; },
  async gc() {
    const used = new Set([...draft.globalRefs, ...draft.scenes.flatMap((s) => s.refs)]);
    library.forEach((s) => s.refs.forEach((r) => used.add(r)));
    jobs.forEach((j) => { (j.globalRefs || []).forEach((r) => used.add(r)); j.scenes.forEach((s) => s.refs.forEach((r) => used.add(r))); });
    for (const k of await DB.keys()) if (String(k).startsWith('a_') && !used.has(k)) await DB.del(k);
  },
};
