'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ico = (n, cls = '') => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 8000 : 3500);
}

/* Stockage local du navigateur : brouillon + bibliothèque de scènes. */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('afvg.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('afvg.' + k, JSON.stringify(v)); return true; } catch { toast('Stockage local plein ou indisponible', 'err'); return false; } },
};
const newScene = (n = 1) => ({ id: uid(), libId: null, name: 'Scène ' + n, prompt: '', promptOriginal: '', motion: '', endPrompt: '', duration: 3, refs: [] });
const newDraft = () => ({ title: 'Ma vidéo', provider: '', fps: 12, size: '1024x576', mode: 'chain', concurrency: 2, keyEvery: 1, res: 'std', style: '', enrichAuto: true, simple: true, globalRefs: [], scenes: [newScene()] });
let draft = Object.assign(newDraft(), LS.get('draft', {}));
if (!Array.isArray(draft.scenes) || !draft.scenes.length) draft.scenes = [newScene()];
let library = LS.get('library', []);
let _t;
const saveDraft = () => { clearTimeout(_t); _t = setTimeout(() => LS.set('draft', draft), 300); };
const saveLibrary = () => LS.set('library', library);
window.addEventListener('beforeunload', () => LS.set('draft', draft));

/* Client de l'API du serveur. */
async function api(method, url, body, raw = false) {
  let r;
  try {
    r = await fetch(url, { method, headers: body && !raw ? { 'Content-Type': 'application/json' } : undefined, body: raw ? body : body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Serveur injoignable'); }
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { /* pas du JSON */ }
  if (!r.ok) throw new Error((j && j.error) || t.slice(0, 150) || r.statusText);
  return j;
}
