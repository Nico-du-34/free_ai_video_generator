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
  if (name === 'usage') startUsage(); else stopUsage();
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
      <label style="margin-top:12px">Narration <span class="opt">voix off, optionnel</span>
        <textarea data-f="narration" rows="2" placeholder="Ce que la voix dit pendant cette scène">${esc(s.narration || '')}</textarea></label>
      ${refsHtml(s.refs, i)}
    </div>`).join('');
  $('#libPick').innerHTML = '<option value="">Ajouter depuis la bibliothèque…</option>' + library.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  renderProviderHint();
  renderSimple();
  renderSound();
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
    const job = await withBusy(btn, 'Lancement…', () => api('POST', '/api/jobs', { ...draft, size: effSize(), title: (!draft.title || draft.title === 'Ma vidéo') ? draft.scenes[0].prompt.trim().slice(0, 50) : draft.title, scenes: draft.scenes.map(({ name, prompt, motion, endPrompt, duration, refs, narration }) => ({ name, prompt, motion, endPrompt, duration, refs, narration })) }));
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
        <button class="btn sm" data-act="jobAudio">${ico('volume')}Audio</button>
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
  r('meta').textContent = `${label} · ${j.fps} fps · ${j.size} · ${j.scenes.length} scène(s) · ${MODE_LABEL[j.mode]}${j.keyEvery > 1 ? ` · 1 image IA sur ${j.keyEvery}` : ''} · ${(vframes / j.fps).toFixed(1)} s${j.video && j.video.audio ? ' · 🔊 audio' : ''}`;
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


/* ---------- Son : voix off + ambiance ---------- */
const ENGINES = [['google', 'Google Traduction (gratuit)'], ['local', 'Voix locale (hors-ligne)'], ['cloudflare', 'Cloudflare MeloTTS'], ['openai', 'API compatible OpenAI']];
const LANGS = [['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português']];
const AMBIENTS = [['rain', 'Pluie'], ['wind', 'Vent'], ['ocean', 'Océan'], ['fire', 'Feu de camp'], ['forest', 'Forêt la nuit'], ['city', 'Ville (grondement)'], ['space', 'Espace (nappe)'], ['pad', 'Musique douce (nappe)']];
let modalAudio = null, player = null;
function audioUiHtml(a, target) {
  const o = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  const k = a.ambient.kind, au = (server.settings && server.settings.audio) || {};
  const missing = (k === 'freesound' && !au.freesoundKeySet) ? 'Freesound' : (k === 'jamendo' && !au.jamendoClientIdSet) ? 'Jamendo' : '';
  return `<div class="audio-ui" data-target="${target}"><div class="grid">
    <label>Voix<select data-au="voice.engine">${ENGINES.map(([v, l]) => o(v, l, a.voice.engine)).join('')}</select></label>
    <label>Langue<select data-au="voice.lang">${LANGS.map(([v, l]) => o(v, l, a.voice.lang)).join('')}</select></label>
    <label>Volume de la voix<input type="range" data-au="voice.volume" min="0" max="150" step="5" value="${Math.round(a.voice.volume * 100)}"></label>
    <label>Ambiance<select data-au="ambient.kind">${o('none', 'Aucune', k)}${o('synth', 'Sons générés (gratuit)', k)}${o('freesound', 'Freesound (recherche)', k)}${o('jamendo', 'Jamendo (musique)', k)}</select>
      ${missing ? `<a href="#settings" data-go="settings" class="warn-link">Ajouter la clé ${missing} dans Réglages › Audio</a>` : ''}</label>
    ${k === 'synth' ? `<label>Type de son<select data-au="ambient.preset">${AMBIENTS.map(([v, l]) => o(v, l, a.ambient.preset)).join('')}</select></label>` : ''}
    ${k === 'freesound' || k === 'jamendo' ? `<label>Recherche<input type="text" data-au="ambient.query" value="${esc(a.ambient.query)}" placeholder="ex : forêt, pluie, piano calme"></label>` : ''}
    ${k !== 'none' ? `<label>Volume de l'ambiance<input type="range" data-au="ambient.volume" min="0" max="100" step="5" value="${Math.round(a.ambient.volume * 100)}"></label>` : ''}
    <label class="check wide"><input type="checkbox" data-au="duck" ${a.duck ? 'checked' : ''}><span>Baisser l'ambiance quand la voix parle</span></label>
  </div>
  <div class="actions tight"><button class="btn sm" data-act="voicePreview">${ico('volume')}Aperçu de la voix</button>${k !== 'none' ? `<button class="btn sm" data-act="ambPreview">${ico('volume')}Aperçu de l'ambiance</button>` : ''}</div></div>`;
}
const audioOf = (el) => (el.closest('.audio-ui').dataset.target === 'draft' ? draft.audio : modalAudio);
function renderSound() {
  const multi = draft.scenes.length > 1, sn = $('#sNarr');
  $('#narrArea').hidden = !(draft.simple && !multi);
  if (document.activeElement !== sn) sn.value = draft.scenes[0].narration || '';
  if (!$('#soundUi').contains(document.activeElement)) $('#soundUi').innerHTML = audioUiHtml(draft.audio, 'draft');
}
function setAu(a, path, v) { const [g, k] = path.split('.'); if (k) a[g][k] = v; else a[g] = v; saveDraft(); }
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'sNarr') { draft.scenes[0].narration = el.value; saveDraft(); }
  if (el.dataset.mn !== undefined) return;
  if (el.dataset.au && (el.type === 'range' || el.type === 'text')) setAu(audioOf(el), el.dataset.au, el.type === 'range' ? +el.value / 100 : el.value);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.dataset.au || el.type === 'range' || el.type === 'text') return;
  const a = audioOf(el), box = el.closest('.audio-ui');
  setAu(a, el.dataset.au, el.type === 'checkbox' ? el.checked : el.value);
  if (el.dataset.au === 'ambient.kind') box.outerHTML = audioUiHtml(a, box.dataset.target);
});
function playDataUrl(u) { if (player) player.pause(); player = new Audio(u); player.play().catch(() => toast('Lecture bloquée par le navigateur', 'err')); }
async function narrateInto(scenes, lang, apply, btn) {
  if (scenes.some((s) => !s.prompt.trim())) return toast('Chaque scène doit avoir un prompt', 'err');
  try {
    const r = await withBusy(btn, 'Écriture…', () => api('POST', '/api/narrate', { provider: draft.provider, lang, scenes: scenes.map((s) => ({ prompt: s.prompt, duration: s.duration })) }));
    apply(r.narrations);
  } catch (e) { toast('Narration : ' + e.message, 'err'); }
}
function openAudio(job) {
  modalAudio = JSON.parse(JSON.stringify(job.audio || newAudio()));
  openModal(`<h2>Audio · ${esc(job.title)}</h2>
    <p class="fine" style="margin-top:0">Modifie la voix et l'ambiance, puis applique : la vidéo est remixée sans régénérer les images.${job.video ? '' : ' (Pas encore de vidéo : pris en compte à l\'assemblage.)'}</p>
    ${job.scenes.map((s, i) => `<label style="margin-top:12px">Narration · ${esc(s.name)} <span class="opt">${s.duration} s</span><textarea data-mn="${i}" rows="2" placeholder="(sans voix)">${esc(s.narration || '')}</textarea></label>`).join('')}
    <div class="actions tight"><button class="btn sm" data-act="mNarrate">${ico('sparkles')}Écrire la narration avec l'IA</button></div>
    <div style="margin-top:14px">${audioUiHtml(modalAudio, 'modal')}</div>
    <div class="actions sticky-foot"><button class="btn primary" data-act="audioApply" style="margin-left:auto">Appliquer à la vidéo</button></div>`, () => { modalAudio = null; if (player) player.pause(); });
  $('#modalBody').dataset.job = job.id;
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


/* ---------- Usage & IA ---------- */
let usageData = null, usageKey = '', usageTimer = null;
const modelFilter = {};
const ago = (t) => { if (!t) return 'jamais'; const s = Math.round((Date.now() - t) / 1000); return s < 5 ? 'à l\'instant' : s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.round(s / 60)} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`; };
const bytes = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(2) + ' Go' : n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR');
function meter(label, used, limit, right) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return `<div class="meter"><div class="row"><span>${label}</span><b>${right}</b></div><div class="track"><i class="${pct >= 100 ? 'full' : pct >= 70 ? 'hot' : ''}" style="width:${pct}%"></i></div></div>`;
}
function spark(series) {
  const max = Math.max(1, ...series.map((x) => x.ok + x.err));
  const short = (d) => d.slice(8) + '/' + d.slice(5, 7);
  return `<div><div class="spark" role="img" aria-label="Appels par jour sur 14 jours">${series.map((x) => `<i class="${x.ok + x.err ? '' : 'zero'} ${x.err ? 'err' : ''}" style="height:${Math.max(5, ((x.ok + x.err) / max) * 100)}%" title="${x.d} : ${x.ok} réussis, ${x.err} erreurs"></i>`).join('')}</div>
    <div class="spark-l"><span>${short(series[0].d)}</span><span>appels / jour · pic ${max}</span><span>aujourd'hui</span></div></div>`;
}
function modelRows(pid) {
  const c = usageData.providers.find((x) => x.id === pid).check;
  const f = (modelFilter[pid] || '').toLowerCase();
  const list = c.models.filter((m) => m.toLowerCase().includes(f));
  return list.map((m) => `<div class="mrow"><code>${esc(m)}</code><button class="btn" data-act="useModel" data-pid="${pid}" data-model="${esc(m)}" data-as="imageModel">Image</button><button class="btn" data-act="useModel" data-pid="${pid}" data-model="${esc(m)}" data-as="editModel">Réf.</button><button class="btn" data-act="useModel" data-pid="${pid}" data-model="${esc(m)}" data-as="chatModel">Texte</button></div>`).join('') || '<p class="fine">Aucun modèle ne correspond.</p>';
}
function checkHtml(c, pid) {
  if (!c) return '';
  const badge = c.valid === true ? '<span class="pill done">Valide</span>' : c.valid === false ? '<span class="pill error">Refusée</span>' : '<span class="pill paused">Non vérifiable</span>';
  const kv = Object.entries(c.info || {});
  return `<div class="chk"><div class="uc-head" style="align-items:center"><div>${badge} <span style="font-size:13px">${esc(c.detail)}</span></div><span class="fine" style="margin:0">${ago(c.at)}</span></div>
    ${kv.length ? `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    ${pid && c.models && c.models.length ? `<details style="margin-top:10px"><summary style="margin:0">Modèles disponibles (${c.models.length})</summary>
      <input type="text" data-mf="${pid}" placeholder="Filtrer (ex : flux, image, kontext)" value="${esc(modelFilter[pid] || '')}" style="margin-top:8px">
      <div class="models" id="ml-${pid}">${modelRows(pid)}</div><p class="fine">Clique sur un rôle pour définir ce modèle comme modèle image, avec références ou texte.</p></details>` : ''}</div>`;
}

function acctHtml(p) {
  const a = p.account, lim = p.live;
  let h = '';
  if (lim || a || p.limitsNote) {
    h += '<div class="chk"><div class="uc-head" style="align-items:center"><b style="font-size:13px">Valeurs réelles du fournisseur</b>' + (a ? `<span class="fine" style="margin:0">compte lu ${ago(a.at)}</span>` : '') + '</div>';
    if (lim && lim.parsed.length) h += lim.parsed.map((x) => meter(`Quota annoncé · ${esc(x.name)}${x.reset ? ' · remise à zéro dans ' + esc(x.reset) : ''}`, x.limit - x.remaining, x.limit, `${x.remaining} restant(s) / ${x.limit}`)).join('');
    else if (lim) h += '<p class="fine" style="margin:6px 0 0">Le fournisseur renvoie des en-têtes de quota mais sans paire limite/restant exploitable.</p>';
    else h += '<p class="fine" style="margin:6px 0 0">Aucun en-tête de quota reçu pour l\'instant (il apparaît après le premier appel).</p>';
    if (lim) h += `<details style="margin-top:8px"><summary style="margin:0;font-size:12px">En-têtes bruts reçus (${ago(lim.at)})</summary><dl class="kv">${Object.entries(lim.headers).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`;
    if (a && a.error) h += `<div class="lasterr" style="margin-top:8px">${esc(a.error)}</div>`;
    const kv = a ? Object.entries(a.kv) : [];
    if (kv.length) h += `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    if (a && a.models && a.models.length) h += `<table class="utable" style="margin-top:8px"><thead><tr><th>Modèle (côté fournisseur)</th><th>Requêtes</th><th>Coût (USD)</th></tr></thead><tbody>${a.models.map((m) => `<tr><td>${esc(m.model)}</td><td>${m.requests}</td><td>${m.cost}</td></tr>`).join('')}</tbody></table>`;
    if (a && a.series) h += `<div style="margin-top:10px"><div class="fine" style="margin:0 0 4px">${esc(a.seriesLabel)}</div>${spark(a.series)}</div>`;
    if (a) h += a.notes.map((n) => `<p class="fine" style="margin:8px 0 0">${esc(n)}</p>`).join('');
    if (p.limitsNote) h += `<p class="fine" style="margin:8px 0 0">${esc(p.limitsNote)}</p>`;
    if (!a && p.hasKey) h += '<p class="fine" style="margin:8px 0 0">Lecture du compte en cours…</p>';
    if (p.dashUrl) h += `<p style="margin:8px 0 0"><a href="${esc(p.dashUrl)}" target="_blank" rel="noopener" style="font-size:12px">Ouvrir le tableau de bord du fournisseur →</a></p>`;
    h += '</div>';
  }
  return h;
}
function provCard(p) {
  const t = p.today, q = p.quota;
  const lat = p.latencyMs ? (p.latencyMs / 1000).toFixed(1) + ' s' : '—';
  return `<div class="uc" data-pid="${p.id}">
    <div class="uc-head"><div><h3>${esc(p.label)}</h3><div class="meta">image : ${esc(p.imageModel || 'défaut')} · texte : ${esc(p.chatModel || '—')}</div></div>
      <span class="pill ${p.hasKey ? 'done' : 'paused'}">${p.hasKey ? 'Clé ' + esc(p.keyHint) + (p.keyFromEnv ? ' (env)' : '') : 'Sans clé'}</span></div>
    ${meter('Quota cette minute' + (q.cooling ? ` · ralenti après un 429 (${Math.ceil(q.cooling / 1000)} s)` : ''), q.used, q.limit, `${q.used} / ${q.limit}`)}
    ${p.dailyLimit ? meter('Images aujourd\'hui', t.image.ok, p.dailyLimit, `${t.image.ok} / ${p.dailyLimit}`) : `<div class="meter"><div class="row"><span>Images aujourd'hui</span><b>${t.image.ok}</b></div><div class="fine" style="margin:0">Pas de limite quotidienne configurée (Réglages › Avancé).</div></div>`}
    <div class="stats">
      <div class="stat"><span>Images</span><b>${t.image.ok}</b>${t.image.err ? `<em>${t.image.err} err.</em>` : ''}</div>
      <div class="stat"><span>Texte (IA)</span><b>${t.chat.ok}</b>${t.chat.err ? `<em>${t.chat.err} err.</em>` : ''}</div>
      <div class="stat"><span>Voix</span><b>${t.tts.ok}</b>${t.tts.err ? `<em>${t.tts.err} err.</em>` : ''}</div>
    </div>
    <div class="fine" style="margin:0">7 jours : ${p.week.ok} réussis · ${p.week.err} erreurs · latence image ~${lat} · dernier appel ${ago(p.last && p.last.at)}</div>
    ${spark(p.series)}
    ${p.last && p.last.err ? `<div class="lasterr"><b>Dernière erreur</b> (${ago(p.last.err.at)}${p.last.err.status ? ', HTTP ' + p.last.err.status : ''}) : ${esc(p.last.err.msg)}</div>` : ''}
    ${acctHtml(p)}
    ${checkHtml(p.check, p.id)}
    <div class="actions tight" style="margin-top:0"><button class="btn sm" data-act="usageCheck" data-pid="${p.id}" ${p.hasKey ? '' : 'disabled'}>${ico('refresh')}Actualiser : clé, compte et modèles</button><button class="btn sm ghost" data-go="settings">Configurer</button></div>
  </div>`;
}
function renderUsage() {
  const u = usageData;
  if (!u) return;
  const label = Object.fromEntries([...u.providers, ...u.services].map((x) => [x.id, x.label]));
  const kind = { image: 'image', chat: 'texte', tts: 'voix', search: 'recherche' };
  $('#usageBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Requêtes aujourd'hui</span><strong>${u.totals.calls}</strong><small>${u.totals.errors} erreur(s)${u.totals.calls ? ` · ${Math.round((u.totals.errors / u.totals.calls) * 100)} %` : ''}</small></div>
      <div class="kpi"><span>Images générées aujourd'hui</span><strong>${u.totals.images}</strong></div>
      <div class="kpi"><span>Instances actives</span><strong>${u.jobs.running + u.jobs.assembling}</strong><small>${u.jobs.total} au total${u.jobs.error ? ` · ${u.jobs.error} en erreur` : ''}</small></div>
      <div class="kpi"><span>Stockage utilisé</span><strong>${bytes(u.storage.bytes)}</strong><small>${u.storage.videos} vidéo(s) · ${u.storage.assets} référence(s)</small></div>
    </div>
    <div class="section-head" style="margin-top:0"><h2>Fournisseurs d'images et de texte</h2></div>
    <div class="uprov">${u.providers.map(provCard).join('')}</div>
    <div class="section-head"><h2>Services audio</h2></div>
    <div class="card"><table class="utable"><thead><tr><th>Service</th><th>Clé</th><th>Aujourd'hui</th><th>7 jours</th><th>Dernier appel</th><th></th></tr></thead><tbody>
      ${u.services.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.keySet === null ? '<span class="muted">sans clé</span>' : x.keySet ? '<span class="good">configurée</span>' : '<span class="muted">manquante</span>'}</td>
        <td>${x.today.ok} <span class="${x.today.err ? 'bad' : ''}">${x.today.err ? '· ' + x.today.err + ' err.' : ''}</span></td><td>${x.week.ok} · ${x.week.err} err.</td><td>${ago(x.last && x.last.at)}${x.last && x.last.err ? `<div class="bad">${esc(x.last.err.msg.slice(0, 80))}</div>` : ''}</td>
        <td>${x.keySet ? `<button class="btn sm" data-act="usageCheck" data-service="${x.id}">Vérifier</button>` : ''}</td></tr>
        ${x.check ? `<tr><td colspan="6">${checkHtml(x.check)}</td></tr>` : ''}`).join('')}
    </tbody></table><p class="fine">Les voix Cloudflare et « API OpenAI » sont comptées dans la ligne « Voix » du fournisseur correspondant.</p></div>
    <div class="section-head"><h2>Activité récente</h2><button class="btn sm ghost danger" data-act="usageReset">Réinitialiser les statistiques</button></div>
    <div class="card" style="overflow:auto;max-height:440px">${u.events.length ? `<table class="utable"><thead><tr><th>Heure</th><th>Service</th><th>Type</th><th>Résultat</th><th>Durée</th><th>Détail</th></tr></thead><tbody>
      ${u.events.map((e) => `<tr><td>${hhmm(e.t)}</td><td>${esc(label[e.service] || e.service)}</td><td>${kind[e.kind] || e.kind}</td><td class="${e.ok ? 'good' : 'bad'}">${e.ok ? 'OK' : 'Erreur' + (e.status ? ' ' + e.status : '')}</td><td>${e.ms ? (e.ms / 1000).toFixed(1) + ' s' : ''}</td><td class="${e.ok ? '' : 'bad'}">${esc(e.msg || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0">Aucun appel enregistré pour l\'instant.</p>'}</div>`;
}
async function loadUsage(force) {
  try {
    const d = await api('GET', '/api/usage');
    const k = JSON.stringify(d.events) + JSON.stringify(d.providers.map((p) => [p.quota, p.today, p.check, p.last, p.account && p.account.at, p.live && p.live.at])) + JSON.stringify(d.services) + JSON.stringify(d.totals) + JSON.stringify(d.storage) + JSON.stringify(d.jobs);
    usageData = d;
    // pas de re-rendu pendant la saisie / quand un panneau est ouvert et rien n'a changé
    if (force || (k !== usageKey && !$('#usageBody').contains(document.activeElement))) { const open = $$('#usageBody details[open]').map((x) => x.closest('.uc') ? x.closest('.uc').dataset.pid : 'svc'); renderUsage(); open.forEach((pid) => { const el = $(`#usageBody .uc[data-pid="${pid}"] details`); if (el) el.open = true; }); }
    usageKey = k;
  } catch (e) { if (!usageData) $('#usageBody').innerHTML = `<p class="note warn">${esc(e.message)}</p>`; }
}
function startUsage() { stopUsage(); loadUsage(true); usageTimer = setInterval(() => { if (!document.hidden) loadUsage(); }, 3000); }
function stopUsage() { clearInterval(usageTimer); usageTimer = null; }
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.mf) { modelFilter[el.dataset.mf] = el.value; $(`#ml-${el.dataset.mf}`).innerHTML = modelRows(el.dataset.mf); }
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
          ${field(id, 'dailyLimit', 'Limite quotidienne d\'images (0 = aucune)', p.dailyLimit || 0, 'number', 'min="0"')}
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
    </div>
    <div class="card" id="audioSettings">
      <div class="card-title">Audio · voix et ambiance</div>
      <p class="fine" style="margin-top:0">Voix : Google Traduction (gratuit, sans clé), voix locale espeak (incluse dans Docker), Cloudflare MeloTTS (même clé que ci-dessus) ou endpoint <code>/audio/speech</code> d'un fournisseur compatible OpenAI. Ambiances : sons générés (gratuit, sans clé), <a href="https://freesound.org/apiv2/apply" target="_blank" rel="noopener">Freesound</a> (clé gratuite) et <a href="https://devportal.jamendo.com" target="_blank" rel="noopener">Jamendo</a> (client ID gratuit).</p>
      <div class="grid">
        <label>Clé Freesound<input data-a="freesoundKey" type="password" autocomplete="off" placeholder="${s.audio.freesoundKeySet ? 'Clé ' + esc(s.audio.freesoundKeyHint) + ' enregistrée' : 'Colle ta clé'}"></label>
        <label>Client ID Jamendo<input data-a="jamendoClientId" type="password" autocomplete="off" placeholder="${s.audio.jamendoClientIdSet ? 'ID ' + esc(s.audio.jamendoClientIdHint) + ' enregistré' : 'Colle ton client ID'}"></label>
        <label>Fournisseur de voix « OpenAI »<select data-a="ttsProvider">${Object.entries(s.providers).filter(([, p]) => p.type === 'openai').map(([id, p]) => `<option value="${id}" ${s.audio.ttsProvider === id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <label>Modèle de voix<input data-a="ttsModel" type="text" value="${esc(s.audio.ttsModel)}"></label>
        <label>Nom de la voix<input data-a="ttsVoice" type="text" value="${esc(s.audio.ttsVoice)}"></label>
        <label>Vitesse de la voix locale<input data-a="localSpeed" type="number" min="80" max="300" value="${s.audio.localSpeed}"><small>mots par minute (espeak)</small></label>
      </div>
      <details><summary>Avancé</summary><div class="grid">
        <label>URL Google TTS<input data-a="googleUrl" type="text" value="${esc(s.audio.googleUrl)}"></label>
        <label>URL API Freesound<input data-a="freesoundUrl" type="text" value="${esc(s.audio.freesoundUrl)}"></label>
        <label>URL API Jamendo<input data-a="jamendoUrl" type="text" value="${esc(s.audio.jamendoUrl)}"></label>
      </div></details>
      <div class="actions"><button class="btn primary" data-act="saveAudio">Enregistrer</button>
        ${s.audio.freesoundKeySet ? '<button class="btn ghost danger" data-act="clearAudioKey" data-k="freesoundKey">Supprimer la clé Freesound</button>' : ''}
        ${s.audio.jamendoClientIdSet ? '<button class="btn ghost danger" data-act="clearAudioKey" data-k="jamendoClientId">Supprimer l\'ID Jamendo</button>' : ''}</div>
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
      case 'usageRefresh': loadUsage(true); break;
      case 'usageCheck': {
        const body = b.dataset.service ? { service: b.dataset.service } : { provider: b.dataset.pid };
        const r = await withBusy(b, 'Vérification…', () => api('POST', '/api/usage/check', body));
        await loadUsage(true);
        toast(r.valid === true ? 'Clé valide ✔' : r.valid === false ? 'Clé refusée' : r.detail, r.valid === true ? 'ok' : 'err'); break;
      }
      case 'useModel': {
        await saveSettings({ providers: { [b.dataset.pid]: { [b.dataset.as]: b.dataset.model } } }, `${b.dataset.model} défini comme modèle ${{ imageModel: 'image', editModel: 'avec références', chatModel: 'texte' }[b.dataset.as]}`);
        loadUsage(true); break;
      }
      case 'usageReset':
        if (!confirm('Remettre à zéro tous les compteurs d\'usage ?')) return;
        await api('POST', '/api/usage/reset'); await loadUsage(true); break;
      case 'jobAudio': openAudio(job); break;
      case 'narrate': narrateInto(draft.scenes, draft.audio.voice.lang, (n) => { n.forEach((t, i) => { draft.scenes[i].narration = t; }); saveDraft(); renderStudio(); toast('Narration écrite', 'ok'); }, b); break;
      case 'mNarrate': {
        const j = server.jobs.find((x) => x.id === $('#modalBody').dataset.job);
        narrateInto(j.scenes, modalAudio.voice.lang, (n) => $$('[data-mn]').forEach((t, i) => { t.value = n[i]; }), b); break;
      }
      case 'voicePreview': {
        const box = b.closest('.audio-ui'), a = audioOf(b), isDraft = box.dataset.target === 'draft';
        const text = isDraft ? draft.scenes[0].narration : ($('[data-mn]') || {}).value;
        const r = await withBusy(b, 'Génération…', () => api('POST', '/api/audio/preview', { voice: a.voice, text: (text || '').slice(0, 300) }));
        playDataUrl(r.audio); break;
      }
      case 'ambPreview': { const r = await withBusy(b, 'Génération…', () => api('POST', '/api/audio/ambient-preview', { ambient: audioOf(b).ambient })); playDataUrl(r.audio); break; }
      case 'audioApply': {
        const id = $('#modalBody').dataset.job;
        const j = await withBusy(b, 'Application…', () => api('POST', `/api/jobs/${id}/audio`, { audio: modalAudio, narrations: $$('[data-mn]').map((t) => t.value) }));
        const cur = server.jobs.find((x) => x.id === id); if (cur) Object.assign(cur, j);
        closeModal(); renderJobs(); poll(true); toast('Audio appliqué, remixage en cours…', 'ok'); break;
      }
      case 'saveAudio': {
        const o = {};
        $$('[data-a]').forEach((el) => { const k = el.dataset.a; if (el.type === 'password') { if (el.value.trim()) o[k] = el.value; } else o[k] = el.type === 'number' ? +el.value : el.value; });
        await saveSettings({ audio: o }, 'Réglages audio enregistrés'); break;
      }
      case 'clearAudioKey': await saveSettings({ audio: { ['clear_' + b.dataset.k]: true } }, 'Clé supprimée'); break;
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
if (['studio', 'jobs', 'usage', 'library', 'settings'].includes(startTab)) showTab(startTab);
poll();
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });
