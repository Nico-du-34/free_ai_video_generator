'use strict';
const STATUS = { running: 'En cours', paused: 'En pause', assembling: 'Assemblage', done: 'Terminée', error: 'Erreur' };
const MODE_LABEL = { chain: 'chaînée', anchor: 'ancrée', none: 'indépendantes' };
const MODE_HINT = {
  chain: 'Chaque image part de la précédente : fluide, mais séquentiel.',
  anchor: 'Chaque image part de la 1ʳᵉ de la scène : plusieurs images en parallèle.',
  none: 'Aucune référence entre images : rapide mais peu cohérent.',
};
let server = { jobs: [], settings: null, latency: {} };
let connected = null;

/* ---------- Onglets ---------- */
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'library') renderLibrary();
  if (name === 'jobs') renderJobs();
  if (name === 'settings') renderSettings();
  history.replaceState(null, '', '#' + name);
  window.scrollTo(0, 0);
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

/* ---------- Références ---------- */
function refsHtml(ids, scope) {
  return `<div class="refs" data-scope="${scope}">` +
    ids.map((id) => `<div class="th"><img src="/api/assets/${id}" alt="" loading="lazy"><button class="rm" data-act="rmref" data-scope="${scope}" data-id="${id}" title="Retirer" aria-label="Retirer">${ico('x')}</button></div>`).join('') +
    `<label class="add" title="Ajouter des images">${ico('plus')}<span>Image</span><input type="file" accept="image/*" multiple hidden data-scope="${scope}"></label>` +
    (ids.length ? '' : '<span class="hint">Glisse des images ici : personnage, décor, style… (optionnel)</span>') + '</div>';
}
const refList = (scope) => (scope === 'global' ? draft.globalRefs : draft.scenes[+scope].refs);
async function addRefs(scope, files) {
  const list = refList(scope);
  let failed = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try { list.push((await api('POST', '/api/assets', f, true)).id); } catch (e) { failed++; toast(`${f.name} : ${e.message}`, 'err'); }
  }
  if (failed < files.length) { saveDraft(); renderStudio(); }
}
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('.refs input[type=file]')) { addRefs(el.dataset.scope, [...el.files]); el.value = ''; }
});
['dragover', 'dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  const z = e.target.closest && e.target.closest('.refs');
  if (!z) return;
  e.preventDefault();
  z.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop') addRefs(z.dataset.scope, [...e.dataTransfer.files]);
}));

/* ---------- Studio ---------- */
const providers = () => (server.settings ? server.settings.providers : {});
function ensureProvider() {
  const ps = providers();
  if (!ps[draft.provider]) draft.provider = (server.settings && server.settings.defaultProvider) || Object.keys(ps)[0] || '';
}
const sceneFrames = (s) => Math.max(1, Math.round((+s.duration || 0) * draft.fps));


const IDEAS = ['Un astronaute marche sur la lune', 'Un dragon survole un village médiéval au lever du soleil', 'Une voiture de sport roule dans une ville néon sous la pluie', 'Un chat joue avec une pelote de laine, style dessin animé', 'Des vagues sur une plage tropicale au coucher du soleil', 'Une fleur qui s\'ouvre en accéléré'];
const DURS = [3, 5, 10, 20, 30, 60];
const SPEEDS = [
  ['quality', 'Qualité', { mode: 'chain', concurrency: 1, keyEvery: 1 }, 'Chaque image part de la précédente : le plus cohérent, mais le plus lent.'],
  ['balanced', 'Équilibré', { mode: 'anchor', concurrency: 3, keyEvery: 1 }, '3 images en parallèle à partir de la 1ʳᵉ de la scène : environ 3× plus rapide.'],
  ['turbo', 'Turbo', { mode: 'anchor', concurrency: 4, keyEvery: 2 }, 'Parallèle + 1 image IA sur 2, les autres sont interpolées : environ 6× plus rapide.'],
];
const speedOf = () => { const m = SPEEDS.find(([, , c]) => c.mode === draft.mode && c.keyEvery === +draft.keyEvery && (c.mode === 'chain' || c.concurrency === +draft.concurrency)); return m ? m[0] : ''; };
const SIZES = [['1024x576', '16:9', 'Paysage', [30, 17]], ['576x1024', '9:16', 'Vertical', [17, 30]], ['1024x1024', '1:1', 'Carré', [22, 22]]];
const totalDur = () => draft.scenes.reduce((a, s) => a + (+s.duration || 0), 0);
function setTotal(sec) {
  sec = clamp(Math.round(+sec) || 1, 1, 600);
  const sc = draft.scenes, S = totalDur();
  if (sc.length === 1) sc[0].duration = sec;
  else {
    let acc = 0;
    sc.forEach((s, i) => {
      if (i === sc.length - 1) s.duration = Math.max(0.5, Math.round((sec - acc) * 2) / 2);
      else { s.duration = Math.max(0.5, Math.round((S ? s.duration / S : 1 / sc.length) * sec * 2) / 2); acc += s.duration; }
    });
  }
  saveDraft(); renderStudio();
}
const chip = (key, val, html, on, extra = '') => `<button class="chip-btn ${on ? 'on' : ''} ${extra}" data-chip="${key}" data-val="${esc(val)}">${html}</button>`;
function renderSimple() {
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'simple') === !!draft.simple));
  $('#simpleView').hidden = !draft.simple; $('#advView').hidden = !!draft.simple;
  const multi = draft.scenes.length > 1, sp = $('#sPrompt');
  sp.disabled = multi;
  sp.placeholder = multi ? 'Plusieurs scènes : modifie-les en mode Avancé' : sp.placeholder;
  if (document.activeElement !== sp) sp.value = multi ? '' : draft.scenes[0].prompt;
  const mn = $('#multiNote'); mn.hidden = !multi;
  mn.innerHTML = multi ? `Ton storyboard contient ${draft.scenes.length} scènes. <a href="#" data-mode-link="advanced">Les modifier en mode Avancé</a> — la durée choisie ci-dessous est répartie entre elles.` : '';
  $('#ideas').innerHTML = multi ? '' : IDEAS.map((t) => `<button data-idea="${esc(t)}">${esc(t)}</button>`).join('');
  $('#durChips').innerHTML = DURS.map((v) => chip('dur', v, v < 60 ? v + ' s' : '1 min', false)).join('');
  $('#sizeChips').innerHTML = SIZES.map(([v, r, l, [w, h]]) => chip('size', v, `<i style="width:${w}px;height:${h}px"></i>${l} <small>${r}</small>`, draft.size === v)).join('');
  const noRefs = (providers()[draft.provider] || {}).refMode === 'none';
  $('#speedChips').innerHTML = SPEEDS.map(([id, l, c]) => chip('speed', id, l, speedOf() === id)).join('');
  $('#speedHint').textContent = noRefs ? 'Cette IA ne gère pas les images de référence : les images sont indépendantes et générées en parallèle.' : (SPEEDS.find(([id]) => id === speedOf()) || [0, 0, 0, 'Réglage personnalisé (mode Avancé).'])[3];
  $('#resChips').innerHTML = [['std', 'Standard'], ['draft', 'Brouillon · plus rapide']].map(([v, l]) => chip('res', v, l, draft.res === v)).join('');
  $('#fpsChips').innerHTML = [[12, 'Standard · 12 img/s'], [18, 'Fluide · 18 img/s'], [24, 'Cinéma · 24 img/s']].map(([v, l]) => chip('fps', v, l, draft.fps === v)).join('');
  $('#provChips').innerHTML = Object.entries(providers()).map(([id, p]) => chip('prov', id, esc(p.label) + (p.hasKey ? '' : ' <small>clé à ajouter</small>'), draft.provider === id)).join('');
  $('#sRefs').innerHTML = refsHtml(draft.globalRefs, 'global');
  const p = providers()[draft.provider], kp = $('#keyPrompt');
  kp.hidden = !p || p.hasKey;
  if (p && !p.hasKey) kp.innerHTML = `<h3>Dernière étape : ta clé gratuite ${esc(p.label)}</h3><p>1. <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">Crée ta clé gratuite ici</a> &nbsp;2. Colle-la ci-dessous, c'est tout. Elle est gardée sur ton serveur.</p><div class="row"><input id="quickKey" type="password" autocomplete="off" placeholder="Colle ta clé API ici"><button class="btn primary" data-act="quickKey">Enregistrer</button></div>`;
  renderDurUi();
}
function renderDurUi() {
  const t = totalDur(), frames = draft.scenes.reduce((a, s) => a + sceneFrames(s), 0);
  $$('#durChips [data-chip=dur]').forEach((b) => b.classList.toggle('on', +b.dataset.val === t));
  const sd = $('#sDur'); if (document.activeElement !== sd) sd.value = +t.toFixed(1);
  const td = $('#totalDur'); if (td && document.activeElement !== td) td.value = +t.toFixed(1);
  $('#durHint').textContent = `${frames} images à générer (${draft.fps} images par seconde).`;
}

function renderStudio() {
  ensureProvider();
  const sel = $('[data-d=provider]');
  sel.innerHTML = Object.entries(providers()).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.hasKey ? '' : ' (clé manquante)'}</option>`).join('');
  $$('[data-d]').forEach((el) => { const v = draft[el.dataset.d]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; });
  $('[data-d=concurrency]').disabled = draft.mode === 'chain';
  $('#modeHint').textContent = MODE_HINT[draft.mode];
  $('#globalRefs').innerHTML = refsHtml(draft.globalRefs, 'global');
  $('#scenes').innerHTML = draft.scenes.map((s, i) => `
    <div class="scene" data-i="${i}">
      <div class="scene-head">
        <span class="num">${i + 1}</span>
        <input class="title-input" type="text" data-f="name" value="${esc(s.name)}" placeholder="Nom de la scène" aria-label="Nom de la scène">
        <span class="chip" data-frames>${sceneFrames(s)} images</span>
        <div class="tools">
          <button class="icon-btn" data-act="sceneUp" title="Monter">${ico('up')}</button>
          <button class="icon-btn" data-act="sceneDown" title="Descendre">${ico('down')}</button>
          <button class="icon-btn" data-act="sceneDup" title="Dupliquer">${ico('copy')}</button>
          <button class="icon-btn" data-act="sceneSave" title="Sauvegarder dans la bibliothèque">${ico('save')}</button>
          <button class="icon-btn danger" data-act="sceneDel" title="Supprimer">${ico('trash')}</button>
        </div>
      </div>
      <label>Prompt
        <textarea data-f="prompt" rows="3" placeholder="Décris ce qu'on voit : sujet, décor, ambiance…">${esc(s.prompt)}</textarea>
      </label>
      <div class="actions tight">
        <button class="btn sm" data-act="enhance">${ico('sparkles')}Enrichir le prompt</button>
        ${s.promptOriginal ? `<button class="btn sm ghost" data-act="unenhance">${ico('undo')}Prompt d'origine</button>` : ''}
      </div>
      <div class="three">
        <label>Mouvement / action <span class="opt">optionnel</span><input type="text" data-f="motion" value="${esc(s.motion)}" placeholder="ex : la caméra avance lentement"></label>
        <label>État final <span class="opt">optionnel</span><input type="text" data-f="endPrompt" value="${esc(s.endPrompt)}" placeholder="ex : le soleil se couche"></label>
        <label>Durée (s)<input type="number" data-f="duration" min="0.5" max="600" step="0.5" value="${s.duration}"></label>
      </div>
      ${refsHtml(s.refs, i)}
    </div>`).join('');
  $('#libPick').innerHTML = '<option value="">Ajouter depuis la bibliothèque…</option>' + library.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  renderProviderHint();
  renderSimple();
  renderEstimate();
}
function renderProviderHint() {
  const p = providers()[draft.provider];
  const h = $('#providerHint');
  h.innerHTML = p && !p.hasKey ? `<a href="#settings" data-go="settings" class="warn-link">Ajouter la clé ${esc(p.label)}</a>` : '';
}

const genCount = (n, ke) => Math.floor((n - 1) / ke) + 1 + ((n - 1) % ke !== 0 ? 1 : 0);
const effSize = () => {
  if (draft.res !== 'draft') return draft.size;
  const [w, h] = draft.size.split('x').map(Number);
  return `${Math.round(w * 0.625 / 8) * 8}x${Math.round(h * 0.625 / 8) * 8}`;
};
function estimate() {
  const frames = draft.scenes.reduce((a, s) => a + sceneFrames(s), 0);
  const ke = clamp(+draft.keyEvery || 1, 1, 6);
  const gen = draft.scenes.reduce((a, s) => a + genCount(sceneFrames(s), ke), 0);
  const videoSec = frames / draft.fps;
  const p = providers()[draft.provider] || { rpm: 10 };
  const lat = ((server.latency || {})[draft.provider] || 8000) / 1000;
  const noRefs = p.refMode === 'none';
  const conc = noRefs ? Math.max(3, draft.concurrency) : draft.mode === 'chain' ? 1 : clamp(draft.concurrency, 1, 6);
  const running = server.jobs.filter((j) => j.status === 'running' && j.provider === draft.provider).length;
  const quotaSpf = 60 / (p.rpm / (running + 1));
  const latSpf = lat / conc;
  const spf = Math.max(quotaSpf, latSpf);
  return { frames, genFrames: gen, ke, videoSec, spf, lat, running, rpm: p.rpm, measured: !!(server.latency || {})[draft.provider], gen: gen * spf, total: gen * spf + (ke > 1 ? frames * 0.05 : 0) + 5 + frames / 120, calls: gen + (draft.enrichAuto ? 1 : 0), quotaBound: quotaSpf >= latSpf };
}
function renderEstimate() {
  const e = estimate();
  $('#estimate').innerHTML = `
    <div class="total"><span>Temps total estimé</span><strong>~${fmtDur(e.total)}</strong></div>
    <dl class="est">
      <dt>Images de la vidéo</dt><dd>${e.frames}</dd>
      <dt>Images générées par l'IA</dt><dd>${e.genFrames}${e.ke > 1 ? ` <small style="display:inline">(1 sur ${e.ke})</small>` : ''}</dd>
      <dt>Durée de la vidéo</dt><dd>${e.videoSec.toFixed(1)} s</dd>
      <dt>Appels API</dt><dd>${e.calls}</dd>
      <dt>Temps par image</dt><dd>~${e.spf.toFixed(1)} s</dd>
      <dt>Génération</dt><dd>~${fmtDur(e.gen)}</dd>
    </dl>
    <p class="fine">${e.measured ? `Latence mesurée : ${e.lat.toFixed(1)} s/image.` : 'Latence par défaut (8 s) — lance un aperçu pour la mesurer.'}
      Limité par ${e.quotaBound ? `le quota (${e.rpm} img/min${e.running ? `, partagé avec ${e.running} instance(s)` : ''})` : 'la latence de l\'API'}.</p>
    ${e.frames > 5000 ? '<p class="note warn">Plus de 5 000 images : impossible. Réduis la durée ou les images par seconde.</p>' : ''}
    ${e.frames > 1500 ? '<p class="note warn">Plus de 1 500 images : attention aux limites quotidiennes du fournisseur.</p>' : ''}
    ${draft.mode === 'chain' && e.frames > 120 ? '<p class="note warn">Mode chaîné = séquentiel. « Ancrée » + parallèle va plus vite.</p>' : ''}`;
  renderDurUi();
  $$('.scene').forEach((el) => { $('[data-frames]', el).textContent = sceneFrames(draft.scenes[+el.dataset.i]) + ' images'; });
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'sPrompt') { draft.scenes[0].prompt = el.value; saveDraft(); return; }
  if (el.dataset.d) {
    const k = el.dataset.d;
    draft[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.dataset.num ? +el.value : el.value;
    if (k === 'mode') { $('[data-d=concurrency]').disabled = draft.mode === 'chain'; $('#modeHint').textContent = MODE_HINT[draft.mode]; }
    if (k === 'provider') renderProviderHint();
    saveDraft(); if (k !== 'title') renderEstimate();
  } else if (el.dataset.f) {
    draft.scenes[+el.closest('.scene').dataset.i][el.dataset.f] = el.type === 'number' ? +el.value : el.value;
    saveDraft(); renderEstimate();
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'sDur' || el.id === 'totalDur') setTotal(el.value);
  if (el.dataset.d === 'fps') { draft.fps = clamp(Math.round(+el.value) || 12, 12, 60); el.value = draft.fps; saveDraft(); renderEstimate(); }
  if (el.dataset.d === 'concurrency') { draft.concurrency = clamp(Math.round(+el.value) || 1, 1, 6); el.value = draft.concurrency; saveDraft(); renderEstimate(); }
  if (el.dataset.f === 'duration') { const s = draft.scenes[+el.closest('.scene').dataset.i]; s.duration = clamp(+el.value || 1, 0.5, 600); el.value = s.duration; saveDraft(); renderEstimate(); }
  if (el.id === 'libPick' && el.value) {
    const l = library.find((x) => x.id === el.value);
    if (l) { draft.scenes.push({ ...JSON.parse(JSON.stringify(l)), id: uid(), libId: l.id, promptOriginal: '' }); saveDraft(); renderStudio(); }
    el.value = '';
  }
});

async function withBusy(btn, label, fn) {
  const html = btn.innerHTML;
  btn.disabled = true; if (label) btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}
async function enhanceScene(i, btn) {
  const s = draft.scenes[i];
  if (!s.prompt.trim()) return toast('Écris d\'abord un prompt', 'err');
  try {
    const { text } = await withBusy(btn, 'Enrichissement…', () => api('POST', '/api/enhance', { provider: draft.provider, text: s.prompt }));
    if (!s.promptOriginal) s.promptOriginal = s.prompt;
    s.prompt = text; saveDraft(); renderStudio();
  } catch (e) { toast('Enrichissement : ' + e.message, 'err'); }
}
async function previewFrame(btn) {
  const s = draft.scenes[0];
  if (!s.prompt.trim()) return toast('Écris un prompt dans la 1ʳᵉ scène', 'err');
  try {
    const r = await withBusy(btn, 'Génération…', () => api('POST', '/api/preview', { provider: draft.provider, size: effSize(), style: draft.style, fps: draft.fps, scene: s, globalRefs: draft.globalRefs }));
    openModal(`<h2>Aperçu · première image</h2><img class="preview-img" src="${r.image}" alt="Aperçu"><p class="fine">Généré en ${(r.ms / 1000).toFixed(1)} s.<br>Prompt envoyé : <code>${esc(r.prompt)}</code></p>`);
    poll(true);
  } catch (e) { toast('Aperçu : ' + e.message, 'err'); }
}
async function launch(btn) {
  const bad = draft.scenes.findIndex((s) => !s.prompt.trim());
  if (bad >= 0) return toast(`La scène ${bad + 1} n'a pas de prompt`, 'err');
  const p = providers()[draft.provider];
  if (p && !p.hasKey) { toast(`Ajoute d'abord la clé ${p.label}`, 'err'); return showTab('settings'); }
  try {
    const job = await withBusy(btn, 'Lancement…', () => api('POST', '/api/jobs', { ...draft, size: effSize(), title: (!draft.title || draft.title === 'Ma vidéo') ? draft.scenes[0].prompt.trim().slice(0, 50) : draft.title, scenes: draft.scenes.map(({ name, prompt, motion, endPrompt, duration, refs }) => ({ name, prompt, motion, endPrompt, duration, refs })) }));
    server.jobs.unshift(job);
    toast(`« ${job.title} » lancée : ${job.done.length} images. Tu peux quitter la page.`, 'ok');
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    showTab('jobs');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- Instances ---------- */
function jobCardHtml(j) {
  return `<article class="job" data-id="${j.id}">
    <div class="thumb"><img hidden alt=""><video controls loop playsinline preload="metadata" hidden></video><div class="ph">${ico('image', 'xl')}<span>En attente de la 1ʳᵉ image…</span></div></div>
    <div class="jinfo">
      <div class="jtop"><h3 data-r="title"></h3><span class="pill" data-r="status"></span></div>
      <div class="meta" data-r="meta"></div>
      <span class="series-chip" data-r="series" hidden></span>
      <div class="bar"><i data-r="bar"></i></div>
      <div class="prog" data-r="prog"></div>
      <div class="note" data-r="note"></div>
      <div class="actions tight">
        <button class="btn sm" data-act="jobToggle" data-r="toggle"></button>
        <button class="btn sm" data-act="jobAssemble" data-r="asm">${ico('clapper')}Assembler</button>
        <a class="btn sm primary" data-r="dl" download>${ico('download')}Vidéo</a>
        <button class="btn sm" data-act="jobFrames">${ico('image')}Images</button>
        <button class="btn sm" data-act="jobConsole">${ico('terminal')}Console</button>
        <button class="btn sm" data-act="jobSeries">${ico('layers')}Série</button>
        <button class="icon-btn" data-act="jobClone" title="Relancer une copie">${ico('copy')}</button>
        <button class="icon-btn danger" data-act="jobDel" title="Supprimer">${ico('trash')}</button>
      </div>
    </div></article>`;
}
const jobCard = (id) => $(`.job[data-id="${id}"]`);

function updateJobCard(j) {
  const c = jobCard(j.id);
  if (!c) return;
  const r = (k) => $(`[data-r=${k}]`, c);
  const n = (j.done.match(/1/g) || []).length, total = (j.done.match(/[01]/g) || []).length, vframes = j.done.length, remaining = total - n;
  const label = (providers()[j.provider] || {}).label || j.provider;
  r('title').textContent = j.title;
  const st = r('status'); st.textContent = STATUS[j.status] || j.status; st.className = 'pill ' + j.status;
  r('meta').textContent = `${label} · ${j.fps} fps · ${j.size} · ${j.scenes.length} scène(s) · ${MODE_LABEL[j.mode]}${j.keyEvery > 1 ? ` · 1 image IA sur ${j.keyEvery}` : ''} · ${(vframes / j.fps).toFixed(1)} s`;
  const sc = r('series'); sc.hidden = !j.series; if (j.series) sc.textContent = `Série « ${j.series.title} » · épisode ${j.series.ep}/${j.series.of}`;
  const pct = j.status === 'assembling' ? (j.assemble || 0) * 100 : (n / total) * 100;
  r('bar').style.width = pct + '%';
  c.classList.toggle('live', j.status === 'running' || j.status === 'assembling');
  const spf = j.spf || estimate().spf;
  r('prog').textContent = j.status === 'assembling' ? `Assemblage de la vidéo… ${Math.round(pct)} %`
    : `${n}/${total} images · ${Math.round(pct)} %` + (j.status === 'running' && remaining ? ` · reste ~${fmtDur(remaining * spf)}` : '');
  const note = r('note'); note.textContent = j.error || j.note || ''; note.classList.toggle('err', !!j.error);
  const t = r('toggle');
  t.hidden = j.status === 'done' || j.status === 'assembling';
  t.innerHTML = j.status === 'running' ? ico('pause') + 'Pause' : j.status === 'error' ? ico('refresh') + 'Réessayer' : ico('play') + 'Reprendre';
  r('asm').hidden = !n || j.status === 'assembling' || j.status === 'running' || (j.status === 'done' && !!j.video);
  const dl = r('dl'); dl.hidden = !j.video; if (j.video) dl.href = `/api/jobs/${j.id}/video?dl=1`;
  const img = $('img', c), vid = $('video', c), ph = $('.ph', c);
  if (j.video) {
    const v = String(j.video.at);
    if (c.dataset.video !== v) { c.dataset.video = v; vid.poster = `/api/jobs/${j.id}/frame/${Math.max(0, j.lastFrame)}`; vid.src = `/api/jobs/${j.id}/video?v=${v}`; }
    vid.hidden = false; img.hidden = true; ph.hidden = true;
  } else if (j.lastFrame >= 0) {
    if (c.dataset.frame !== String(j.lastFrame)) { c.dataset.frame = String(j.lastFrame); img.src = `/api/jobs/${j.id}/frame/${j.lastFrame}`; }
    img.hidden = false; vid.hidden = true; ph.hidden = true;
  }
}
function renderBadge() {
  const run = server.jobs.filter((j) => j.status === 'running' || j.status === 'assembling').length;
  const b = $('#jobsBadge'); b.hidden = !run; b.textContent = run;
  $('#jobsSummary').textContent = `${server.jobs.length} instance(s) · ${run} active(s). Les instances tournent sur le serveur, tu peux fermer cet onglet.`;
}
function renderJobs() {
  const box = $('#jobList');
  $('#jobsEmpty').hidden = !!server.jobs.length;
  const ids = new Set(server.jobs.map((j) => j.id));
  $$('.job', box).forEach((c) => { if (!ids.has(c.dataset.id)) c.remove(); });
  server.jobs.forEach((j) => {
    if (!jobCard(j.id)) box.insertAdjacentHTML('beforeend', jobCardHtml(j));
    updateJobCard(j);
  });
  server.jobs.forEach((j, i) => { const c = jobCard(j.id); if (box.children[i] !== c) box.insertBefore(c, box.children[i] || null); });
  renderBadge();
}
async function openGallery(j) {
  openModal(`<h2>${esc(j.title)} · images</h2><p class="fine">Clique sur une image pour la télécharger.</p><div class="gal">${[...j.done].map((d, i) => d === '1'
    ? `<a href="/api/jobs/${j.id}/frame/${i}?dl=1" download><img src="/api/jobs/${j.id}/frame/${i}" loading="lazy" alt=""><span>${i + 1}</span></a>`
    : `<a class="missing" title="${d === '-' ? 'image interpolée' : 'pas encore générée'}"><span>${i + 1}</span>${d === '-' ? '≈' : '…'}</a>`).join('')}</div>`);
}
async function jobAction(j, action) {
  try { Object.assign(j, await api('POST', `/api/jobs/${j.id}/${action}`)); updateJobCard(j); renderBadge(); } catch (e) { toast(e.message, 'err'); }
  poll(true);
}
const notified = new Set();


/* ---------- Console d'une instance ---------- */
function openConsole(j) {
  let since = 0, alive = true;
  const lines = [];
  openModal(`<h2>Console · ${esc(j.title)}</h2><div class="console" id="con" aria-live="polite"></div>
    <div class="actions tight"><label class="check"><input id="conAuto" type="checkbox" checked><span>Défilement automatique</span></label><button class="btn sm" data-act="conCopy">Copier</button><small style="margin:0 0 0 auto">Mise à jour en direct · dernières 400 lignes</small></div>`, () => { alive = false; });
  const box = $('#con');
  const fmt = (x) => { const d = new Date(x.t); return `[${d.toLocaleTimeString('fr-FR')}] ${x.m}`; };
  window.__copyConsole = () => navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Console copiée', 'ok'));
  (async function tick() {
    while (alive) {
      try {
        const r = await api('GET', `/api/jobs/${j.id}/log?since=${since}`);
        if (!alive) return;
        if (r.lines.length) {
          for (const x of r.lines) {
            lines.push(fmt(x));
            const el = document.createElement('span');
            el.className = 'ln ' + x.l; el.textContent = fmt(x);
            box.appendChild(el);
          }
          since = r.last;
          if ($('#conAuto') && $('#conAuto').checked) box.scrollTop = box.scrollHeight;
        } else if (!since && !box.children.length) box.innerHTML = '<span class="ln dbg">Aucun événement pour l\'instant…</span>';
      } catch { /* serveur indisponible : on réessaie */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
}

/* ---------- Série : idées de prochains épisodes ---------- */
let ser = null;
function serRender() {
  const n = ser.ideas.filter((e) => e.prompt.trim()).length;
  $('#serList').innerHTML = ser.busy ? '<p class="fine">✨ Écriture des épisodes en cours…</p>'
    : ser.ideas.map((e, i) => `<div class="ep" data-i="${i}"><span class="num">${i + 2}</span><div><input type="text" data-ep="title" value="${esc(e.title)}" placeholder="Titre de l'épisode"><textarea data-ep="prompt" rows="3" placeholder="Prompt de l'épisode">${esc(e.prompt)}</textarea></div><button class="icon-btn danger" data-act="serDel" title="Retirer">${ico('trash')}</button></div>`).join('') || '<p class="fine">Aucune idée pour l\'instant.</p>';
  $('#serGo').textContent = `Lancer ${n} épisode${n > 1 ? 's' : ''}`;
  $('#serGo').disabled = !n || ser.busy;
  $('#serGen').disabled = ser.busy;
}
async function serGenerate() {
  ser.busy = true; serRender();
  try { ser.ideas = (await api('POST', `/api/jobs/${ser.job.id}/series`, { ideas: true, count: +$('#serCount').value })).ideas; }
  catch (e) { toast('Idées de série : ' + e.message, 'err'); }
  ser.busy = false; if (ser && !$('#modal').hidden) serRender();
}
function openSeries(j) {
  ser = { job: j, ideas: [], busy: false };
  openModal(`<h2>Convertir en série</h2>
    <p class="fine" style="margin-top:0">« ${esc(j.title)} » devient l'épisode 1. L'IA propose la suite : modifie, retire ou ajoute des épisodes, puis lance-les tous en une fois (chacun devient une instance).</p>
    <div class="actions"><label style="display:flex;gap:8px;align-items:center">Épisodes à proposer
      <select id="serCount" class="compact" style="margin:0"><option>3</option><option selected>5</option><option>8</option><option>12</option></select></label>
      <button class="btn" id="serGen" data-act="serGen">${ico('sparkles')}Proposer d'autres idées</button></div>
    <div id="serList"></div>
    <label class="check" style="margin-top:12px"><input id="serKeep" type="checkbox" checked><span>Garder la cohérence : réutiliser les références et la dernière image de l'épisode 1</span></label>
    <div class="actions sticky-foot"><button class="btn sm" data-act="serAdd">${ico('plus')}Épisode manuel</button><button class="btn primary" id="serGo" data-act="serLaunch" style="margin-left:auto"></button></div>`, () => { ser = null; });
  serGenerate();
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.ep && ser) { ser.ideas[+el.closest('.ep').dataset.i][el.dataset.ep] = el.value; const n = ser.ideas.filter((x) => x.prompt.trim()).length; $('#serGo').textContent = `Lancer ${n} épisode${n > 1 ? 's' : ''}`; $('#serGo').disabled = !n; }
});

/* ---------- Bibliothèque ---------- */
function renderLibrary() {
  $('#libEmpty').hidden = !!library.length;
  $('#libList').innerHTML = library.map((l) => `
    <div class="libitem" data-id="${l.id}">
      ${l.refs.length ? `<div class="strip">${l.refs.slice(0, 4).map((id) => `<img src="/api/assets/${id}" alt="">`).join('')}</div>` : ''}
      <h3>${esc(l.name)}</h3><p>${esc(l.prompt)}</p>
      <div class="meta">${l.duration} s · ${l.refs.length} référence(s)</div>
      <div class="actions tight"><button class="btn sm primary" data-act="libUse">${ico('plus')}Au storyboard</button><button class="icon-btn danger" data-act="libDel" title="Supprimer">${ico('trash')}</button></div>
    </div>`).join('');
}

/* ---------- Réglages ---------- */
function field(pid, k, label, v, type = 'text', extra = '') {
  return `<label>${label}<input data-p="${pid}" data-k="${k}" type="${type}" value="${esc(v)}" ${extra}></label>`;
}
function renderSettings() {
  const s = server.settings;
  if (!s) return;
  const open = new Set($$('#settingsBody details.prov[open]').map((d) => d.dataset.pid));
  const sel = (id, k, v, opts) => `<select data-p="${id}" data-k="${k}">${opts.map(([val, l]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('#settingsBody').innerHTML = Object.entries(s.providers).map(([id, p]) => `
    <details class="card prov" data-pid="${id}" ${(open.size ? open.has(id) : p.hasKey || id === s.defaultProvider) ? 'open' : ''}>
      <summary><span class="sum-l"><span class="card-title" style="margin:0">${esc(p.label)}</span>
        <span class="pill ${p.hasKey ? 'done' : 'paused'}">${p.hasKey ? 'Clé configurée ' + esc(p.keyHint) + (p.keyFromEnv ? ' (env)' : '') : 'Clé manquante'}</span>
        ${p.refMode === 'none' ? '<span class="pill">sans références</span>' : ''}</span></summary>
      <p class="fine" style="margin:0 0 14px">${esc(p.help || '')}</p>
      <div class="grid">
        ${p.custom ? field(id, 'label', 'Nom', p.label) : ''}
        <label class="wide">Clé API / token<input data-p="${id}" data-k="apiKey" type="password" autocomplete="off" placeholder="${p.hasKey ? 'Laisser vide pour conserver la clé actuelle' : 'Colle ta clé ici'}"></label>
        ${field(id, 'imageModel', 'Modèle image', p.imageModel, 'text', 'placeholder="(modèle par défaut)"')}
        ${p.type === 'openai' ? field(id, 'editModel', 'Modèle avec références', p.editModel, 'text', 'placeholder="(même modèle)"') : ''}
        ${p.type === 'openai' ? field(id, 'chatModel', 'Modèle texte (enrichissement, séries)', p.chatModel, 'text', 'placeholder="(aucun)"') : ''}
        ${field(id, 'rpm', 'Quota : images / minute', p.rpm, 'number', 'min="1" max="600"')}
      </div>
      <details><summary>Avancé</summary>
        <div class="grid">
          ${field(id, 'baseUrl', 'URL de base de l\'API', p.baseUrl)}
          ${p.type === 'openai' ? `<label>Envoi des références${sel(id, 'refMode', p.refMode, [['field', 'Dans la requête JSON (champ)'], ['edits', 'Endpoint /images/edits (multipart)'], ['none', 'Non supporté (texte → image)']])}</label>
          ${field(id, 'refField', 'Champ JSON des références', p.refField)}
          <label class="check"><input data-p="${id}" data-k="refArray" type="checkbox" ${p.refArray ? 'checked' : ''}><span>Références sous forme de tableau</span></label>
          <label>Taille envoyée${sel(id, 'sizeMode', p.sizeMode, [['size', 'size: "1024x576"'], ['wh', 'width + height']])}</label>` : ''}
          ${field(id, 'extraBody', 'Paramètres supplémentaires (JSON)', p.extraBody, 'text', 'placeholder=\'{"steps":4}\'')}
        </div>
      </details>
      <div class="actions">
        <button class="btn primary" data-act="saveProv">Enregistrer</button>
        <button class="btn" data-act="testProv">Tester la connexion</button>
        <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener" class="btn">Obtenir une clé gratuite</a>
        ${p.hasKey && !p.keyFromEnv ? '<button class="btn ghost danger" data-act="clearKey">Supprimer la clé</button>' : ''}
      </div>
    </details>`).join('') + `
    <div class="card">
      <div class="card-title">Général</div>
      <div class="grid">
        <label>Fournisseur par défaut<select id="gDefault">${Object.entries(s.providers).map(([id, p]) => `<option value="${id}" ${s.defaultProvider === id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <label>Références max / requête<input id="gMaxRefs" type="number" min="1" max="10" value="${s.maxRefs}"></label>
        <label class="wide">Consigne d'enrichissement des prompts<textarea id="gEnhance" rows="4">${esc(s.enhancePrompt)}</textarea></label>
      </div>
      <div class="actions"><button class="btn primary" data-act="saveGeneral">Enregistrer</button><button class="btn ghost danger" data-act="resetLocal">Vider le brouillon et la bibliothèque</button></div>
    </div>`;
}
function provPatch(card) {
  const pid = card.dataset.pid, o = {};
  $$('[data-k]', card).forEach((el) => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value; });
  return { providers: { [pid]: o } };
}
async function saveSettings(patch, msg = 'Réglages enregistrés') {
  server.settings = await api('PUT', '/api/settings', patch);
  renderSettings(); renderStudio(); toast(msg, 'ok');
}

/* ---------- Modal ---------- */
let modalCleanup = null;
function openModal(html, cleanup) { closeModal(); $('#modalBody').innerHTML = html; $('#modal').hidden = false; modalCleanup = cleanup || null; }
function closeModal() { if (modalCleanup) { modalCleanup(); modalCleanup = null; } $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- Actions ---------- */
document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); return showTab(go.dataset.go); }
  const ml = e.target.closest('[data-mode-link]');
  if (ml) { e.preventDefault(); draft.simple = false; saveDraft(); return renderStudio(); }
  const md = e.target.closest('#modeSeg button');
  if (md) { draft.simple = md.dataset.mode === 'simple'; saveDraft(); return renderStudio(); }
  const idea = e.target.closest('[data-idea]');
  if (idea) { draft.scenes[0].prompt = idea.dataset.idea; draft.scenes[0].promptOriginal = ''; saveDraft(); return renderStudio(); }
  const ch = e.target.closest('[data-chip]');
  if (ch) {
    const v = ch.dataset.val;
    if (ch.dataset.chip === 'dur') return setTotal(+v);
    if (ch.dataset.chip === 'size') draft.size = v;
    if (ch.dataset.chip === 'fps') draft.fps = +v;
    if (ch.dataset.chip === 'res') draft.res = v;
    if (ch.dataset.chip === 'speed') Object.assign(draft, SPEEDS.find(([id]) => id === v)[2]);
    if (ch.dataset.chip === 'prov') draft.provider = v;
    saveDraft(); return renderStudio();
  }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const scene = b.closest('.scene'), si = scene ? +scene.dataset.i : -1;
  const jobEl = b.closest('.job'), job = jobEl ? server.jobs.find((j) => j.id === jobEl.dataset.id) : null;
  const move = (d) => { const t = si + d; if (t < 0 || t >= draft.scenes.length) return; [draft.scenes[si], draft.scenes[t]] = [draft.scenes[t], draft.scenes[si]]; saveDraft(); renderStudio(); };
  try {
    switch (act) {
      case 'addScene': draft.scenes.push(newScene(draft.scenes.length + 1)); saveDraft(); renderStudio(); break;
      case 'sceneUp': move(-1); break;
      case 'sceneDown': move(1); break;
      case 'sceneDup': draft.scenes.splice(si + 1, 0, { ...JSON.parse(JSON.stringify(draft.scenes[si])), id: uid(), libId: null, name: draft.scenes[si].name + ' (copie)' }); saveDraft(); renderStudio(); break;
      case 'sceneDel': if (draft.scenes.length === 1) draft.scenes[0] = newScene(1); else draft.scenes.splice(si, 1); saveDraft(); renderStudio(); break;
      case 'sceneSave': {
        const s = draft.scenes[si];
        if (!s.prompt.trim()) return toast('Prompt vide', 'err');
        const item = { id: s.libId || uid(), name: s.name, prompt: s.prompt, motion: s.motion, endPrompt: s.endPrompt, duration: s.duration, refs: [...s.refs] };
        const k = library.findIndex((l) => l.id === item.id);
        if (k >= 0) library[k] = item; else library.push(item);
        s.libId = item.id; saveLibrary(); saveDraft(); renderStudio(); toast('Scène sauvegardée dans la bibliothèque', 'ok'); break;
      }
      case 'enhance': enhanceScene(si, b); break;
      case 'unenhance': { const s = draft.scenes[si]; s.prompt = s.promptOriginal; s.promptOriginal = ''; saveDraft(); renderStudio(); break; }
      case 'rmref': { const l = refList(b.dataset.scope); l.splice(l.indexOf(b.dataset.id), 1); saveDraft(); renderStudio(); break; }
      case 'preview': previewFrame(b); break;
      case 'sEnhance': enhanceScene(0, b); break;
      case 'quickKey': {
        const key = $('#quickKey').value.trim();
        if (!key) return toast('Colle ta clé API', 'err');
        await withBusy(b, 'Enregistrement…', () => saveSettings({ providers: { [draft.provider]: { apiKey: key } } }, 'Clé enregistrée'));
        break;
      }
      case 'launch': launch(b); break;
      case 'jobToggle': jobAction(job, job.status === 'running' ? 'pause' : 'resume'); break;
      case 'jobAssemble': jobAction(job, 'assemble'); break;
      case 'jobFrames': openGallery(job); break;
      case 'jobConsole': openConsole(job); break;
      case 'jobSeries': openSeries(job); break;
      case 'conCopy': window.__copyConsole(); break;
      case 'serGen': serGenerate(); break;
      case 'serAdd': ser.ideas.push({ title: '', prompt: '' }); serRender(); break;
      case 'serDel': ser.ideas.splice(+b.closest('.ep').dataset.i, 1); serRender(); break;
      case 'serLaunch': {
        const eps = ser.ideas.filter((x) => x.prompt.trim());
        const r = await withBusy(b, 'Lancement…', () => api('POST', `/api/jobs/${ser.job.id}/series`, { episodes: eps, keepContinuity: $('#serKeep').checked }));
        r.jobs.reverse().forEach((x) => server.jobs.unshift(x));
        closeModal(); poll(true);
        toast(`${r.jobs.length} épisodes lancés`, 'ok'); showTab('jobs'); break;
      }
      case 'jobClone': { const c = await api('POST', `/api/jobs/${job.id}/clone`); server.jobs.unshift(c); renderJobs(); toast('Copie lancée', 'ok'); break; }
      case 'jobDel':
        if (!confirm(`Supprimer « ${job.title} », ses images et sa vidéo ?`)) return;
        await api('DELETE', `/api/jobs/${job.id}`); server.jobs = server.jobs.filter((j) => j !== job); renderJobs(); break;
      case 'libUse': { const l = library.find((x) => x.id === b.closest('.libitem').dataset.id); draft.scenes.push({ ...JSON.parse(JSON.stringify(l)), id: uid(), libId: l.id, promptOriginal: '' }); saveDraft(); renderStudio(); toast('Ajoutée au storyboard', 'ok'); break; }
      case 'libDel': { const id = b.closest('.libitem').dataset.id; library = library.filter((x) => x.id !== id); saveLibrary(); renderLibrary(); break; }
      case 'closeModal': closeModal(); break;
      case 'saveProv': await withBusy(b, 'Enregistrement…', () => saveSettings(provPatch(b.closest('.prov')))); break;
      case 'clearKey': await saveSettings({ providers: { [b.closest('.prov').dataset.pid]: { clearKey: true } } }, 'Clé supprimée'); break;
      case 'testProv': {
        const card = b.closest('.prov');
        await saveSettings(provPatch(card), 'Réglages enregistrés, test en cours…');
        const again = $(`.prov[data-pid="${card.dataset.pid}"] [data-act=testProv]`);
        const r = await withBusy(again, 'Test…', () => api('POST', '/api/test', { provider: card.dataset.pid }));
        toast('Connexion OK ✔ ' + r.sample.slice(0, 60), 'ok'); break;
      }
      case 'saveGeneral': await saveSettings({ defaultProvider: $('#gDefault').value, maxRefs: +$('#gMaxRefs').value, enhancePrompt: $('#gEnhance').value }); break;
      case 'resetLocal':
        if (!confirm('Vider le brouillon et la bibliothèque de scènes de ce navigateur ?')) return;
        draft = newDraft(); library = []; LS.set('draft', draft); LS.set('library', library); renderStudio(); renderLibrary(); toast('Brouillon et bibliothèque vidés', 'ok'); break;
    }
  } catch (err) { toast(err.message, 'err'); }
});

/* ---------- Synchronisation avec le serveur ---------- */
let polling = false;
async function poll(once) {
  if (polling && !once) return;
  polling = true;
  try {
    const first = !server.settings;
    const prev = new Map(server.jobs.map((j) => [j.id, j.status]));
    const s = await api('GET', '/api/state');
    server = s;
    for (const j of s.jobs) {
      if (j.status === 'done' && prev.has(j.id) && prev.get(j.id) !== 'done' && !notified.has(j.id)) {
        notified.add(j.id);
        toast(`« ${j.title} » est terminée`, 'ok');
        if ('Notification' in window && Notification.permission === 'granted') new Notification('Frame Studio', { body: `« ${j.title} » est terminée` });
      }
    }
    setConn(true);
    if (first) { renderStudio(); renderSettings(); }
    if ($('#tab-jobs').classList.contains('active')) renderJobs(); else renderBadge();
    if ($('#tab-studio').classList.contains('active') && !first) renderEstimate();
  } catch (e) {
    setConn(false, e.message);
  }
  polling = false;
  if (!once) setTimeout(poll, document.hidden ? 8000 : 2000);
}
function setConn(ok, msg) {
  if (connected === ok) return;
  connected = ok;
  $('#connDot').className = 'dot ' + (ok ? 'on' : 'off');
  $('#connText').textContent = ok ? 'Serveur connecté' : 'Serveur injoignable';
  const bn = $('#banner'); bn.hidden = ok;
  bn.textContent = ok ? '' : `${msg || 'Serveur injoignable'} — reconnexion automatique… (tes instances continuent de tourner côté serveur)`;
}

/* ---------- Init ---------- */
renderStudio();
renderJobs();
const startTab = location.hash.slice(1);
if (['studio', 'jobs', 'library', 'settings'].includes(startTab)) showTab(startTab);
poll();
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });
