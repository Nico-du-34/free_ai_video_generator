'use strict';
const STATUS = { running: 'En cours', paused: 'En pause', assembling: 'Assemblage', done: 'Terminée', error: 'Erreur' };

/* ---------- Onglets ---------- */
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'library') renderLibrary();
  if (name === 'jobs') renderJobs();
  history.replaceState(null, '', '#' + name);
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

/* ---------- Références (images) ---------- */
function refsHtml(ids, scope) {
  return `<div class="refs" data-scope="${scope}">` +
    ids.map((id) => `<div class="th"><img data-asset="${id}" alt=""><button data-act="rmref" data-scope="${scope}" data-id="${id}" title="Retirer">×</button></div>`).join('') +
    `<label class="add">＋ image<input type="file" accept="image/*" multiple hidden data-scope="${scope}"></label>` +
    (ids.length ? '' : '<span class="hint">Références de personnage, décor, style… (optionnel)</span>') + '</div>';
}
async function hydrate(root) {
  for (const img of $$('img[data-asset]', root)) {
    const u = await Assets.url(img.dataset.asset);
    if (u) img.src = u;
  }
}
const refList = (scope) => (scope === 'global' ? draft.globalRefs : draft.scenes[+scope].refs);
async function addRefs(scope, files) {
  const list = refList(scope);
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try { list.push(await Assets.add(f)); } catch (e) { toast('Image illisible : ' + f.name, 'err'); }
  }
  saveDraft();
  renderStudio();
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
function sceneFrames(s) { return Math.max(1, Math.round((+s.duration || 0) * draft.fps)); }

function renderStudio() {
  $$('[data-d]').forEach((el) => {
    const v = draft[el.dataset.d];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  $('[data-d=concurrency]').disabled = draft.mode === 'chain';
  $('#globalRefs').innerHTML = refsHtml(draft.globalRefs, 'global');
  $('#scenes').innerHTML = draft.scenes.map((s, i) => `
    <div class="scene" data-i="${i}">
      <div class="scene-head">
        <span class="n">#${i + 1}</span>
        <input type="text" data-f="name" value="${esc(s.name)}" placeholder="Nom de la scène">
        <span class="n" data-frames>${sceneFrames(s)} images</span>
        <button class="btn sm" data-act="sceneUp" title="Monter">↑</button>
        <button class="btn sm" data-act="sceneDown" title="Descendre">↓</button>
        <button class="btn sm" data-act="sceneDup" title="Dupliquer">⧉</button>
        <button class="btn sm" data-act="sceneSave" title="Sauver dans la bibliothèque">💾</button>
        <button class="btn sm danger" data-act="sceneDel" title="Supprimer">🗑</button>
      </div>
      <label>Prompt de la scène
        <textarea data-f="prompt" rows="3" placeholder="Décris ce qu'on voit : sujet, décor, ambiance…">${esc(s.prompt)}</textarea>
      </label>
      <div class="actions" style="margin-top:6px">
        <button class="btn sm" data-act="enhance">✨ Enrichir le prompt</button>
        ${s.promptOriginal ? '<button class="btn sm" data-act="unenhance">↩ Prompt d\'origine</button>' : ''}
      </div>
      <div class="two">
        <label>Mouvement / action (optionnel)<input type="text" data-f="motion" value="${esc(s.motion)}" placeholder="ex : la caméra avance lentement"></label>
        <label>État final (optionnel)<input type="text" data-f="endPrompt" value="${esc(s.endPrompt)}" placeholder="ex : le soleil se couche"></label>
        <label>Durée (s)<input type="number" data-f="duration" min="0.5" max="60" step="0.5" value="${s.duration}"></label>
      </div>
      ${refsHtml(s.refs, i)}
    </div>`).join('');
  hydrate(document);
  const sel = $('#libPick');
  sel.innerHTML = '<option value="">📚 Ajouter depuis la bibliothèque…</option>' + library.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  renderEstimate();
}

function estimate() {
  const frames = draft.scenes.reduce((a, s) => a + sceneFrames(s), 0);
  const videoSec = frames / draft.fps;
  const lat = (stats.latency || 8000) / 1000;
  const conc = draft.mode === 'chain' ? 1 : clamp(draft.concurrency, 1, 6);
  const running = jobs.filter((j) => j.status === 'running').length;
  const quotaSpf = 60 / (settings.rpm / (running + 1));
  const latSpf = lat / conc;
  const spf = Math.max(quotaSpf, latSpf);
  return {
    frames, videoSec, spf, lat, running, measured: !!stats.latency,
    gen: frames * spf, total: frames * spf + videoSec + 3,
    calls: frames + (draft.enrichAuto ? draft.scenes.length : 0), quotaBound: quotaSpf >= latSpf,
  };
}
function renderEstimate() {
  const e = estimate();
  $('#estimate').innerHTML = `
    <dl class="est">
      <dt>Images à générer</dt><dd>${e.frames}</dd>
      <dt>Durée de la vidéo</dt><dd>${e.videoSec.toFixed(1)} s</dd>
      <dt>Appels API</dt><dd>${e.calls}</dd>
      <dt>Temps / image</dt><dd>~${e.spf.toFixed(1)} s</dd>
      <dt>Génération</dt><dd>~${fmtDur(e.gen)}</dd>
      <dt>Assemblage</dt><dd>~${fmtDur(e.videoSec + 3)}</dd>
      <dt>Total estimé</dt><dd class="big">~${fmtDur(e.total)}</dd>
    </dl>
    <div class="muted" style="margin-top:8px;font-size:12px">
      ${e.measured ? `Latence mesurée : ${e.lat.toFixed(1)} s/image.` : 'Latence par défaut (8 s) – lance un aperçu pour mesurer.'}
      Limité par : ${e.quotaBound ? `le quota (${settings.rpm} img/min${e.running ? `, partagé avec ${e.running} instance(s)` : ''})` : 'la latence de l\'API'}.
    </div>
    ${e.frames > 1500 ? '<div class="warn">⚠ Plus de 1 500 images : la limite gratuite est de 4 000 images / jour.</div>' : ''}
    ${draft.mode === 'chain' && e.frames > 120 ? '<div class="warn">Mode chaîné = séquentiel. Passe en « ancrée » + parallèle pour aller plus vite.</div>' : ''}`;
  $$('.scene').forEach((el) => { $('[data-frames]', el).textContent = sceneFrames(draft.scenes[+el.dataset.i]) + ' images'; });
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.d) {
    const k = el.dataset.d;
    draft[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
    if (k === 'mode') $('[data-d=concurrency]').disabled = draft.mode === 'chain';
    saveDraft(); if (k !== 'title') renderEstimate();
  } else if (el.dataset.f) {
    const s = draft.scenes[+el.closest('.scene').dataset.i];
    s[el.dataset.f] = el.type === 'number' ? +el.value : el.value;
    saveDraft(); renderEstimate();
  } else if (el.dataset.s) {
    settings[el.dataset.s] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
    saveSettings(); renderKeyState();
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.d === 'fps') { draft.fps = clamp(Math.round(+el.value) || 12, 12, 60); el.value = draft.fps; saveDraft(); renderEstimate(); }
  if (el.dataset.d === 'concurrency') { draft.concurrency = clamp(Math.round(+el.value) || 1, 1, 6); el.value = draft.concurrency; saveDraft(); renderEstimate(); }
  if (el.dataset.f === 'duration') { const s = draft.scenes[+el.closest('.scene').dataset.i]; s.duration = clamp(+el.value || 1, 0.5, 60); el.value = s.duration; saveDraft(); renderEstimate(); }
  if (el.id === 'libPick' && el.value) {
    const l = library.find((x) => x.id === el.value);
    if (l) { draft.scenes.push({ ...JSON.parse(JSON.stringify(l)), id: uid(), libId: l.id, promptOriginal: '' }); saveDraft(); renderStudio(); }
    el.value = '';
  }
});

async function enhanceScene(i, btn) {
  const s = draft.scenes[i];
  if (!s.prompt.trim()) return toast('Écris d\'abord un prompt', 'err');
  btn.disabled = true; btn.textContent = '✨ …';
  try {
    const out = await Api.enhance(s.prompt);
    if (!s.promptOriginal) s.promptOriginal = s.prompt;
    s.prompt = out; saveDraft(); renderStudio();
  } catch (e) { toast('Enrichissement : ' + e.message, 'err'); btn.disabled = false; btn.textContent = '✨ Enrichir le prompt'; }
}

async function previewFrame(btn) {
  const s = draft.scenes[0];
  if (!s.prompt.trim()) return toast('Écris un prompt dans la 1ʳᵉ scène', 'err');
  btn.disabled = true; btn.textContent = 'Génération…';
  try {
    const refs = [];
    for (const id of [...s.refs, ...draft.globalRefs]) refs.push(await Assets.dataUrl(id));
    const job = { style: draft.style, mode: 'none' };
    const prompt = Engine.framePrompt(job, s, 0, sceneFrames(s));
    const t0 = Date.now();
    const blob = await Api.retry(async () => {
      await Limiter.acquire();
      return Api.image({ prompt, size: draft.size, refs: refs.filter(Boolean).slice(0, settings.maxRefs) });
    });
    noteLatency(Date.now() - t0);
    const url = URL.createObjectURL(blob);
    openModal(`<h2>Aperçu – première image</h2><img class="preview-img" src="${url}"><p class="muted">Généré en ${((Date.now() - t0) / 1000).toFixed(1)} s. Prompt envoyé :<br><code>${esc(prompt)}</code></p>`, () => URL.revokeObjectURL(url));
    renderEstimate();
  } catch (e) { toast('Aperçu : ' + e.message, 'err'); }
  btn.disabled = false; btn.textContent = '🔍 Aperçu (1 image test)';
}

async function launch(btn) {
  if (!settings.apiKey) { toast('Ajoute ta clé API dans Réglages', 'err'); return showTab('settings'); }
  const bad = draft.scenes.findIndex((s) => !s.prompt.trim());
  if (bad >= 0) return toast(`La scène #${bad + 1} n'a pas de prompt`, 'err');
  btn.disabled = true;
  try {
    const scenes = JSON.parse(JSON.stringify(draft.scenes)).map((s) => ({ name: s.name, prompt: s.prompt, motion: s.motion, endPrompt: s.endPrompt, duration: s.duration, refs: s.refs }));
    if (draft.enrichAuto) {
      btn.textContent = 'Enrichissement des prompts…';
      for (const s of scenes) { try { s.prompt = await Api.enhance(s.prompt); } catch (e) { toast('Enrichissement ignoré : ' + e.message, 'err'); break; } }
    }
    const job = {
      id: uid(), title: draft.title || 'Vidéo', createdAt: Date.now(), status: 'paused', fps: Math.max(12, draft.fps), size: draft.size,
      mode: draft.mode, concurrency: draft.concurrency, style: draft.style, globalRefs: [...draft.globalRefs], scenes,
      done: '', error: '', note: '', video: null, lastFrame: -1,
    };
    job.done = '0'.repeat(Engine.plan(job).length);
    jobs.unshift(job);
    saveJobs();
    Engine.start(job);
    toast(`Instance « ${job.title} » lancée (${job.done.length} images)`, 'ok');
    showTab('jobs');
  } finally { btn.disabled = false; btn.textContent = '🚀 Lancer la génération'; }
}

/* ---------- Instances ---------- */
function jobCardHtml(j) {
  return `<article class="job" data-id="${j.id}">
    <div class="thumb"><img hidden alt=""><video controls loop hidden></video><span class="empty">En attente de la 1ʳᵉ image…</span></div>
    <div class="jinfo">
      <h3><span data-r="title"></span><span class="pill" data-r="status"></span></h3>
      <div class="muted" data-r="meta"></div>
      <div class="bar"><i data-r="bar"></i></div>
      <div data-r="prog"></div>
      <div class="note" data-r="note"></div>
      <div class="actions">
        <button class="btn sm" data-act="jobToggle" data-r="toggle"></button>
        <button class="btn sm" data-act="jobAssemble" data-r="asm">🎬 Assembler</button>
        <button class="btn sm primary" data-act="jobDownload" data-r="dl">⬇ Vidéo</button>
        <button class="btn sm" data-act="jobFrames">🖼 Images</button>
        <button class="btn sm" data-act="jobClone" title="Relancer une copie">⧉</button>
        <button class="btn sm danger" data-act="jobDel" title="Supprimer">🗑</button>
      </div>
    </div></article>`;
}
const jobCard = (id) => $(`.job[data-id="${id}"]`);

async function updateJobCard(j) {
  const c = jobCard(j.id);
  if (!c) return;
  const r = (k) => $(`[data-r=${k}]`, c);
  const n = Engine.doneCount(j), total = j.done.length;
  const remaining = total - n;
  r('title').textContent = j.title;
  const st = $('[data-r=status]', c); st.textContent = STATUS[j.status] || j.status; st.className = 'pill ' + j.status;
  r('meta').textContent = `${j.fps} fps · ${j.size} · ${j.scenes.length} scène(s) · ${{ chain: 'chaînée', anchor: 'ancrée', none: 'indépendantes' }[j.mode]} · ${(total / j.fps).toFixed(1)} s`;
  const pct = j.status === 'assembling' ? (j.assemble || 0) * 100 : (n / total) * 100;
  r('bar').style.width = pct + '%';
  const spf = j.spf || estimate().spf;
  r('prog').textContent = j.status === 'assembling' ? `Assemblage de la vidéo… ${Math.round(pct)} %`
    : `${n}/${total} images (${Math.round((n / total) * 100)} %)` + (j.status === 'running' && remaining ? ` · reste ~${fmtDur(remaining * spf)}` : '');
  const note = r('note'); note.textContent = j.error || j.note || ''; note.classList.toggle('err', !!j.error);
  const t = r('toggle');
  t.hidden = j.status === 'done' || j.status === 'assembling';
  t.textContent = j.status === 'running' ? '⏸ Pause' : j.status === 'error' ? '↻ Réessayer' : '▶ Reprendre';
  r('asm').hidden = !n || j.status === 'assembling' || j.status === 'running';
  r('dl').hidden = !j.video;
  const img = $('img', c), vid = $('video', c), empty = $('.empty', c);
  if (j.video && c.dataset.video !== String(j.video.at)) {
    c.dataset.video = String(j.video.at);
    const b = await DB.get(`${j.id}:video`);
    if (b) { if (vid.src) URL.revokeObjectURL(vid.src); vid.src = URL.createObjectURL(b); vid.hidden = false; img.hidden = true; empty.hidden = true; }
  } else if (!j.video && j.lastFrame >= 0 && c.dataset.frame !== String(j.lastFrame) && !c._loading) {
    c._loading = true; c.dataset.frame = String(j.lastFrame);
    const b = await DB.get(`${j.id}:f:${j.lastFrame}`);
    if (b) { if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); img.src = URL.createObjectURL(b); img.hidden = false; empty.hidden = true; }
    c._loading = false;
  }
  renderBadge();
}
function renderBadge() {
  const run = jobs.filter((j) => j.status === 'running' || j.status === 'assembling').length;
  const b = $('#jobsBadge'); b.hidden = !run; b.textContent = run;
  $('#jobsSummary').textContent = `${jobs.length} instance(s) · ${run} active(s) · quota ${settings.rpm} img/min partagé`;
}
function renderJobs() {
  const box = $('#jobList');
  $('#jobsEmpty').hidden = !!jobs.length;
  const ids = new Set(jobs.map((j) => j.id));
  $$('.job', box).forEach((c) => { if (!ids.has(c.dataset.id)) c.remove(); });
  jobs.forEach((j) => {
    if (!jobCard(j.id)) box.insertAdjacentHTML('beforeend', jobCardHtml(j));
    updateJobCard(j);
  });
  // ordre : plus récent d'abord
  jobs.forEach((j) => box.appendChild(jobCard(j.id)));
  renderBadge();
}
Engine.onChange = (j) => { if ($('#tab-jobs').classList.contains('active')) { if (!jobCard(j.id)) renderJobs(); else updateJobCard(j); } else renderBadge(); };

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function openGallery(j) {
  const urls = [];
  openModal(`<h2>${esc(j.title)} – images</h2><p class="muted">Clique sur une image pour la télécharger.</p><div class="gal">${[...j.done].map((d, i) => `<a data-i="${i}" ${d === '1' ? '' : 'style="display:grid;place-items:center"'}>${d === '1' ? '' : '…'}<span>${i + 1}</span></a>`).join('')}</div>`,
    () => urls.forEach((u) => URL.revokeObjectURL(u)));
  const links = $$('.gal a');
  for (let i = 0; i < links.length; i++) {
    if (j.done[i] !== '1') continue;
    const b = await DB.get(`${j.id}:f:${i}`);
    if (!b || $('#modal').hidden) continue;
    const u = URL.createObjectURL(b); urls.push(u);
    links[i].insertAdjacentHTML('afterbegin', `<img src="${u}" loading="lazy">`);
    links[i].href = u; links[i].download = `${slug(j.title)}-${String(i + 1).padStart(4, '0')}.png`;
  }
}
async function deleteJob(j) {
  if (!confirm(`Supprimer « ${j.title} » et ses images ?`)) return;
  Engine.pause(j);
  jobs.splice(jobs.indexOf(j), 1);
  saveJobs();
  await DB.delPrefix(j.id + ':');
  renderJobs();
}
function cloneJob(j) {
  const c = JSON.parse(JSON.stringify(j));
  Object.assign(c, { id: uid(), title: j.title + ' (copie)', createdAt: Date.now(), status: 'paused', done: '0'.repeat(j.done.length), error: '', note: '', video: null, lastFrame: -1, spf: 0 });
  jobs.unshift(c); saveJobs(); Engine.start(c); renderJobs();
}

/* ---------- Bibliothèque ---------- */
function renderLibrary() {
  $('#libEmpty').hidden = !!library.length;
  $('#libList').innerHTML = library.map((l) => `
    <div class="libitem" data-id="${l.id}">
      <h3>${esc(l.name)}</h3><p>${esc(l.prompt)}</p>
      <div class="muted" style="margin-bottom:8px">${l.duration}s · ${l.refs.length} référence(s)</div>
      <div class="actions"><button class="btn sm primary" data-act="libUse">＋ Au storyboard</button><button class="btn sm danger" data-act="libDel">Supprimer</button></div>
    </div>`).join('');
}

/* ---------- Réglages ---------- */
function renderSettings() {
  $$('[data-s]').forEach((el) => { const v = settings[el.dataset.s]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; });
  renderKeyState();
}
function renderKeyState() { $('#keyState').textContent = settings.apiKey ? '🔑 clé enregistrée' : '⚠ pas de clé API'; }

/* ---------- Modal ---------- */
let modalCleanup = null;
function openModal(html, cleanup) { closeModal(); $('#modalBody').innerHTML = html; $('#modal').hidden = false; modalCleanup = cleanup; }
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; if (modalCleanup) { modalCleanup(); modalCleanup = null; } }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- Actions (délégation) ---------- */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const scene = b.closest('.scene'), si = scene ? +scene.dataset.i : -1;
  const jobEl = b.closest('.job'), job = jobEl ? jobs.find((j) => j.id === jobEl.dataset.id) : null;
  const move = (d) => { const t = si + d; if (t < 0 || t >= draft.scenes.length) return; [draft.scenes[si], draft.scenes[t]] = [draft.scenes[t], draft.scenes[si]]; saveDraft(); renderStudio(); };
  switch (act) {
    case 'addScene': draft.scenes.push(newScene(draft.scenes.length + 1)); saveDraft(); renderStudio(); break;
    case 'sceneUp': move(-1); break;
    case 'sceneDown': move(1); break;
    case 'sceneDup': draft.scenes.splice(si + 1, 0, { ...JSON.parse(JSON.stringify(draft.scenes[si])), id: uid(), libId: null, name: draft.scenes[si].name + ' (copie)' }); saveDraft(); renderStudio(); break;
    case 'sceneDel':
      if (draft.scenes.length === 1) draft.scenes[0] = newScene(1); else draft.scenes.splice(si, 1);
      saveDraft(); renderStudio(); break;
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
    case 'launch': launch(b); break;
    case 'jobToggle': if (job.status === 'running') Engine.pause(job); else Engine.start(job); break;
    case 'jobAssemble': Engine.assemble(job); break;
    case 'jobDownload': { const blob = await DB.get(`${job.id}:video`); if (blob) download(blob, `${slug(job.title)}.${job.video.ext}`); break; }
    case 'jobFrames': openGallery(job); break;
    case 'jobClone': cloneJob(job); break;
    case 'jobDel': deleteJob(job); break;
    case 'libUse': { const l = library.find((x) => x.id === b.closest('.libitem').dataset.id); draft.scenes.push({ ...JSON.parse(JSON.stringify(l)), id: uid(), libId: l.id, promptOriginal: '' }); saveDraft(); renderStudio(); toast('Ajoutée au storyboard', 'ok'); break; }
    case 'libDel': { const id = b.closest('.libitem').dataset.id; library = library.filter((x) => x.id !== id); saveLibrary(); renderLibrary(); break; }
    case 'closeModal': closeModal(); break;
    case 'testKey': {
      b.disabled = true;
      try { const out = await Api.enhance('a red apple'); toast('Clé OK ✔ — ' + out.slice(0, 60), 'ok'); } catch (err) { toast('Échec : ' + err.message, 'err'); }
      b.disabled = false; break;
    }
    case 'wipe':
      if (!confirm('Effacer clé, scènes, instances, images et vidéos de ce navigateur ?')) return;
      jobs.forEach((j) => Engine.pause(j));
      Object.keys(localStorage).filter((k) => k.startsWith('afvg.')).forEach((k) => localStorage.removeItem(k));
      wiping = true;
      { const rq = indexedDB.deleteDatabase('afvg'); rq.onsuccess = rq.onerror = rq.onblocked = () => location.reload(); }
      break;
  }
});

/* ---------- Init ---------- */
let wiping = false;
window.addEventListener('beforeunload', () => { if (!wiping) { LS.set('jobs', jobs); LS.set('draft', draft); } });
renderSettings();
renderStudio();
renderJobs();
Assets.gc().catch(() => {});
const startTab = location.hash.slice(1);
if (['studio', 'jobs', 'library', 'settings'].includes(startTab)) showTab(startTab);
