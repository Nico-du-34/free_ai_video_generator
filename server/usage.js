'use strict';
// Suivi d'usage (appels, erreurs, latence, quotas) et vérification des clés / comptes.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');

const FILE = path.join(store.DATA, 'usage.json');
const data = store.readJSON(FILE, { days: {}, last: {}, events: [], checks: {} });
data.days = data.days || {}; data.last = data.last || {}; data.events = data.events || []; data.checks = data.checks || {}; data.accounts = data.accounts || {};

const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
let timer;
function save() { clearTimeout(timer); timer = setTimeout(() => { try { store.writeJSON(FILE, data); } catch { /* non bloquant */ } }, 1500); }
function flush() { try { store.writeJSON(FILE, data); } catch { /* ignoré */ } }

const SERVICES = {
  'google-tts': { label: 'Google Traduction (voix)' },
  espeak: { label: 'Voix locale (espeak)' },
  freesound: { label: 'Freesound', key: 'freesoundKey' },
  jamendo: { label: 'Jamendo', key: 'jamendoClientId' },
};

/** Enregistre un appel externe. kind : image | chat | tts | search | other */
function record({ service, kind = 'image', ok, ms = 0, status = 0, msg = '' }) {
  const t = Date.now();
  const day = (data.days[dayKey(t)] = data.days[dayKey(t)] || {});
  const k = ((day[service] = day[service] || {})[kind] = day[service][kind] || { ok: 0, err: 0, ms: 0, e429: 0 });
  if (ok) { k.ok++; k.ms += ms; } else { k.err++; if (status === 429) k.e429++; }
  const l = (data.last[service] = data.last[service] || {});
  l.at = t;
  if (!ok) l.err = { at: t, status, msg: String(msg).slice(0, 220) };
  data.events.unshift({ t, service, kind, ok, ms, status, msg: ok ? '' : String(msg).slice(0, 160) });
  if (data.events.length > 80) data.events.length = 80;
  const keep = Object.keys(data.days).sort().slice(-60);
  for (const d of Object.keys(data.days)) if (!keep.includes(d)) delete data.days[d];
  save();
}
const today = (service, kind = 'image') => ((data.days[dayKey()] || {})[service] || {})[kind] || { ok: 0, err: 0 };
const imagesToday = (service) => today(service, 'image').ok;

function sum(o) { return Object.values(o || {}).reduce((a, k) => ({ ok: a.ok + k.ok, err: a.err + k.err, ms: a.ms + k.ms }), { ok: 0, err: 0, ms: 0 }); }
function lastDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(dayKey(Date.now() - i * 864e5)); return out; }

let diskCache = { at: 0 };
async function disk() {
  if (Date.now() - diskCache.at < 30000) return diskCache.v;
  let bytes = 0, videos = 0, jobs = 0, assets = 0;
  const walk = async (dir, onFile) => {
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, onFile);
      else if (e.isFile()) { try { const st = await fsp.stat(p); bytes += st.size; onFile && onFile(e.name); } catch { /* ignoré */ } }
    }
  };
  await walk(store.dirs.jobs, (n) => { if (n === 'video.mp4') videos++; if (n === 'job.json') jobs++; });
  await walk(store.dirs.assets, () => assets++);
  diskCache = { at: Date.now(), v: { bytes, videos, jobs, assets } };
  return diskCache.v;
}

async function overview(quotaOf) {
  const s = store.getSettings(), ac = store.audioCfg(), days = lastDays(14);
  const series = (id) => days.map((d) => { const t = sum((data.days[d] || {})[id]); return { d, ok: t.ok, err: t.err }; });
  for (const [id] of Object.entries(s.providers)) {      // rafraîchit en arrière-plan les valeurs du compte (toutes les 5 min)
    const a = data.accounts[id];
    if (store.providerCfg(id).apiKey && (!a || Date.now() - a.at > 300000) && !inflight.has(id)) refreshAccount(id).catch(() => {});
  }
  const providers = Object.entries(s.providers).map(([id, p]) => {
    const pc = store.providerCfg(id), td = (data.days[dayKey()] || {})[id] || {};
    const week = days.slice(-7).reduce((a, d) => { const t = sum((data.days[d] || {})[id]); return { ok: a.ok + t.ok, err: a.err + t.err }; }, { ok: 0, err: 0 });
    return {
      id, label: p.label, type: p.type, hasKey: !!pc.apiKey, keyHint: pc.apiKey ? '…' + pc.apiKey.slice(-4) : '', keyFromEnv: !p.apiKey && !!pc.apiKey,
      rpm: p.rpm, dailyLimit: p.dailyLimit || 0, quota: quotaOf(id), imageModel: p.imageModel, chatModel: p.chatModel,
      today: { image: td.image || { ok: 0, err: 0 }, chat: td.chat || { ok: 0, err: 0 }, tts: td.tts || { ok: 0, err: 0 } },
      week, latencyMs: Math.round(store.stats.latency[id] || 0), last: data.last[id] || null, series: series(id), check: data.checks[id] || null,
      dashUrl: p.dashUrl || '', limitsNote: p.limitsNote || '', accountKind: p.account || 'none',
      account: data.accounts[id] || null, live: live[id] ? { at: live[id].at, headers: live[id].headers, parsed: parseLimits(live[id].headers) } : null,
    };
  });
  const services = Object.entries(SERVICES).map(([id, d]) => {
    const t = sum((data.days[dayKey()] || {})[id]);
    return { id, label: d.label, keySet: d.key ? !!ac[d.key] : null, today: t, week: days.slice(-7).reduce((a, x) => { const y = sum((data.days[x] || {})[id]); return { ok: a.ok + y.ok, err: a.err + y.err }; }, { ok: 0, err: 0 }), last: data.last[id] || null, check: data.checks[id] || null, series: series(id) };
  });
  const all = Object.keys(data.days[dayKey()] || {}).reduce((a, id) => { const t = sum(data.days[dayKey()][id]); return { ok: a.ok + t.ok, err: a.err + t.err }; }, { ok: 0, err: 0 });
  return {
    days, providers, services, events: data.events.slice(0, 40),
    totals: { calls: all.ok + all.err, errors: all.err, images: Object.keys(s.providers).reduce((a, id) => a + imagesToday(id), 0) },
    storage: await disk(),
  };
}


/* ---------- Valeurs réelles côté fournisseur ---------- */
const live = {};                       // pid → { at, headers } : derniers en-têtes de quota reçus
function noteHeaders(pid, headers) {
  const out = {};
  headers.forEach((v, k) => { if (/ratelimit|rate-limit|remaining|reset|credit|balance|quota|usage|retry-after/i.test(k)) out[k] = String(v).slice(0, 80); });
  if (Object.keys(out).length) live[pid] = { at: Date.now(), headers: out };
}
/** Extrait des paires limite/restant des en-têtes (conventions OpenAI, Together, IETF). */
function parseLimits(h) {
  const out = [];
  for (const k of Object.keys(h)) {
    const m = /^(?:x-)?ratelimit-limit(?:-(.+))?$/.exec(k);
    if (!m) continue;
    const suf = m[1] ? '-' + m[1] : '';
    const rem = h[`x-ratelimit-remaining${suf}`] ?? h[`ratelimit-remaining${suf}`];
    const reset = h[`x-ratelimit-reset${suf}`] ?? h[`ratelimit-reset${suf}`];
    const limit = parseFloat(h[k]), remaining = parseFloat(rem);
    if (Number.isFinite(limit) && Number.isFinite(remaining)) out.push({ name: m[1] || 'requêtes', limit, remaining, reset: reset || '' });
  }
  return out;
}
const SECRETISH = /email|mail|token|secret|password/i;
function kvAdd(into, key, val) { if (val === undefined || val === null || val === '' || SECRETISH.test(key)) return; if (typeof val === 'object') val = Array.isArray(val) ? val.join(', ') : JSON.stringify(val); into[key] = String(val).slice(0, 140); }
function flatInto(o, prefix, into, depth = 0) {
  if (Array.isArray(o)) { if (o.every((x) => typeof x !== 'object')) kvAdd(into, prefix, o.join(', ')); else into[prefix] = o.length + ' élément(s)'; return; }
  if (o && typeof o === 'object') { if (depth > 1) return; for (const [k, v] of Object.entries(o)) flatInto(v, prefix ? `${prefix} · ${k}` : k, into, depth + 1); return; }
  kvAdd(into, prefix, o);
}
const PROBES = ['/dashboard/billing/subscription', '/dashboard/billing/usage', '/user/balance', '/balance', '/credits', '/key', '/usage', '/me', '/account'];
const inflight = new Set();

/** Interroge l'API du compte du fournisseur quand elle existe. Retourne et mémorise les valeurs réelles. */
async function fetchAccount(pid) {
  const get = (u, h) => getRaw(u, h, pid);
  const s = store.getSettings(), cfg = s.providers[pid];
  if (!cfg) throw httpErr(400, 'Fournisseur inconnu');
  const p = store.providerCfg(pid);
  if (!p.apiKey) throw httpErr(400, `Clé API ${p.label} manquante`);
  const H = { Authorization: 'Bearer ' + p.apiKey };
  const o = { at: Date.now(), kv: {}, series: null, seriesLabel: '', models: null, notes: [], error: '' };
  const origin = new URL(p.baseUrl).origin;
  try {
    if (cfg.account === 'pollinations') {
      const g = (pth) => get(origin + pth, H).catch(() => null);
      const [key, bal, ku, prof, daily] = await Promise.all([g('/account/key'), g('/account/balance'), g('/account/key/usage'), g('/account/profile'), g('/account/usage/daily')]);
      if (key && key.ok && key.json) {
        const k = key.json;
        kvAdd(o.kv, 'Clé valide', k.valid === undefined ? undefined : k.valid ? 'oui' : 'non'); kvAdd(o.kv, 'Type de clé', k.type); kvAdd(o.kv, 'Nom de la clé', k.name);
        kvAdd(o.kv, 'Budget de la clé (pollen)', k.pollenBudget); kvAdd(o.kv, 'Expire le', k.expiresAt); kvAdd(o.kv, 'Permissions', k.permissions);
        if (k.rateLimitEnabled !== undefined) kvAdd(o.kv, 'Limitation de débit', k.rateLimitEnabled ? 'active' : 'inactive');
      } else if (key && denied(key)) o.error = 'Clé refusée par Pollinations (HTTP ' + key.status + ')';
      if (bal && bal.ok && bal.json) {
        kvAdd(o.kv, 'Solde (pollen)', bal.json.balance);
        const ab = bal.json.accountBalance;
        if (ab && typeof ab === 'object') { kvAdd(o.kv, 'Solde du compte (total)', ab.total); kvAdd(o.kv, 'Palier', ab.tier); kvAdd(o.kv, 'Pollen payant', ab.paid); }
      } else if (bal && !bal.ok) o.notes.push(`Solde indisponible (HTTP ${bal.status}) : la clé n'a peut-être pas le droit « account:usage ».`);
      if (prof && prof.ok && prof.json) { kvAdd(o.kv, 'Compte GitHub', prof.json.githubUsername); kvAdd(o.kv, 'Nom', prof.json.name); }
      const rows = ku && ku.ok && Array.isArray(ku.json) ? ku.json : null;
      if (rows) {
        const byModel = {}, byDay = {};
        let cost = 0;
        for (const r of rows) {
          const m = (byModel[r.model || '?'] = byModel[r.model || '?'] || { model: r.model || '?', requests: 0, cost: 0 });
          m.requests++; m.cost += +r.cost_usd || 0; cost += +r.cost_usd || 0;
          const d = String(r.timestamp || '').slice(0, 10);
          if (d) { byDay[d] = byDay[d] || { requests: 0, cost: 0 }; byDay[d].requests++; byDay[d].cost += +r.cost_usd || 0; }
        }
        kvAdd(o.kv, 'Requêtes de cette clé (historique)', rows.length); kvAdd(o.kv, 'Coût de cette clé (USD)', cost.toFixed(4));
        o.models = Object.values(byModel).sort((a, b) => b.requests - a.requests).slice(0, 8).map((m) => ({ ...m, cost: +m.cost.toFixed(4) }));
        o.series = lastDays(14).map((d) => ({ d, ok: (byDay[d] || {}).requests || 0, err: 0, cost: +((byDay[d] || {}).cost || 0).toFixed(4) }));
        o.seriesLabel = 'Requêtes de cette clé côté Pollinations';
      }
      if (daily && daily.ok && Array.isArray(daily.json) && daily.json.length) {
        const byDay = {};
        for (const r of daily.json) { const d = String(r.date || '').slice(0, 10); if (d) byDay[d] = (byDay[d] || 0) + (+r.requests || 0); }
        o.series = lastDays(14).map((d) => ({ d, ok: byDay[d] || 0, err: 0 }));
        o.seriesLabel = 'Requêtes de tout le compte côté Pollinations';
      }
    } else if (cfg.account === 'hf') {
      const host = new URL(p.baseUrl).host;
      const r = await get((host === 'router.huggingface.co' ? 'https://huggingface.co' : origin) + '/api/whoami-v2', H);
      if (denied(r)) o.error = 'Token refusé par Hugging Face (HTTP ' + r.status + ')';
      else if (r.ok && r.json) {
        const j = r.json;
        kvAdd(o.kv, 'Compte', j.name); kvAdd(o.kv, 'Nom complet', j.fullname); kvAdd(o.kv, 'Type', j.type);
        kvAdd(o.kv, 'Abonnement Pro', j.isPro === undefined ? undefined : j.isPro ? 'oui' : 'non'); kvAdd(o.kv, 'Moyen de paiement', j.canPay === undefined ? undefined : j.canPay ? 'oui' : 'non');
        kvAdd(o.kv, 'Fin de période de facturation', j.periodEnd);
        const t = j.auth && j.auth.accessToken;
        if (t) { kvAdd(o.kv, 'Token', t.displayName); kvAdd(o.kv, 'Rôle du token', t.role); kvAdd(o.kv, 'Token créé le', t.createdAt); }
      }
      o.notes.push('Les crédits d\'inférence restants se consultent sur huggingface.co/settings/billing (pas d\'API publique de solde).');
    } else if (cfg.account === 'cloudflare') {
      const r = await get(origin + '/client/v4/user/tokens/verify', H);
      if (denied(r)) o.error = 'Token refusé par Cloudflare (HTTP ' + r.status + ')';
      else if (r.json && r.json.result) { kvAdd(o.kv, 'Token', r.json.result.status); kvAdd(o.kv, 'Expire le', r.json.result.expires_on); kvAdd(o.kv, 'Valide depuis', r.json.result.not_before); }
    } else if (cfg.account === 'probe') {
      let found = 0;
      for (const pth of PROBES) {
        try {
          const r = await get(p.baseUrl + pth, H);
          if (r.ok && r.json && typeof r.json === 'object') { found++; flatInto(r.json, pth.slice(1), o.kv); }
        } catch { /* endpoint absent */ }
      }
      o.notes.push(found ? `${found} endpoint(s) non documenté(s) ont répondu : valeurs ci-dessus lues telles quelles.` : 'Aucun endpoint de solde ou d\'usage n\'est exposé par ce fournisseur (9 chemins courants testés).');
    }
  } catch (e) { o.error = 'Lecture du compte impossible : ' + ((e.cause && e.cause.message) || e.message); }
  const lim = live[pid];
  o.limits = lim ? { at: lim.at, headers: lim.headers, parsed: parseLimits(lim.headers) } : null;
  data.accounts[pid] = o; save();
  return o;
}
function refreshAccount(pid) {
  if (inflight.has(pid)) return Promise.resolve(data.accounts[pid]);
  inflight.add(pid);
  return fetchAccount(pid).finally(() => inflight.delete(pid));
}

/* ---------- Vérification des clés ---------- */
const httpErr = (status, message) => Object.assign(new Error(message), { status });
async function getRaw(url, headers, pid) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (pid) noteHeaders(pid, r.headers);
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: r.status, ok: r.ok, json, text };
}
const get = (url, headers) => getRaw(url, headers);
const denied = (r) => r.status === 401 || r.status === 403;

async function checkProvider(pid) {
  const get = (u, h) => getRaw(u, h, pid);
  const s = store.getSettings();
  if (!s.providers[pid]) throw httpErr(400, 'Fournisseur inconnu');
  const p = store.providerCfg(pid);
  if (!p.apiKey) throw httpErr(400, `Clé API ${p.label} manquante`);
  const H = { Authorization: 'Bearer ' + p.apiKey };
  const out = { at: Date.now(), valid: null, detail: '', models: [], info: {} };
  try {
    if (p.type === 'cloudflare') {
      const r = await get(new URL(p.baseUrl).origin + '/client/v4/user/tokens/verify', H);
      const res = r.json && r.json.result;
      out.valid = denied(r) || (r.json && r.json.success === false) ? false : r.ok;
      out.detail = out.valid ? `Token ${res && res.status ? res.status : 'valide'}` : `Token refusé (HTTP ${r.status})`;
      if (res) { if (res.expires_on) out.info['Expire le'] = res.expires_on; if (res.not_before) out.info['Valide depuis'] = res.not_before; }
    } else if (p.type === 'hf') {
      const host = new URL(p.baseUrl).host;
      const r = await get((host === 'router.huggingface.co' ? 'https://huggingface.co' : new URL(p.baseUrl).origin) + '/api/whoami-v2', H);
      out.valid = denied(r) ? false : r.ok;
      out.detail = out.valid ? 'Token valide' : `Token refusé (HTTP ${r.status})`;
      if (r.ok && r.json) { out.info.Compte = r.json.name; out.info.Type = r.json.type; if (r.json.isPro !== undefined) out.info.Pro = r.json.isPro ? 'oui' : 'non'; }
    } else {
      const r = await get(p.baseUrl + '/models', H);
      if (denied(r)) { out.valid = false; out.detail = `Clé refusée (HTTP ${r.status})`; } else if (r.ok) {
        out.valid = true;
        const arr = Array.isArray(r.json) ? r.json : (r.json && (r.json.data || r.json.models)) || [];
        out.models = [...new Set(arr.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean))].slice(0, 300);
        out.detail = `Clé valide · ${out.models.length} modèle(s) disponible(s)`;
      } else out.detail = `Ce fournisseur n'expose pas /models (HTTP ${r.status}) : la clé ne peut être validée qu'en générant`;
    }
  } catch (e) { out.valid = null; out.detail = 'Vérification impossible : ' + ((e.cause && e.cause.message) || e.message); }
  data.checks[pid] = out; save();
  return out;
}
function flat(o, prefix, into, depth = 0) {
  if (Array.isArray(o)) { into[prefix] = o.length + ' élément(s)'; return; }
  if (o && typeof o === 'object') { if (depth > 1) return; for (const [k, v] of Object.entries(o)) flat(v, depth === 0 && prefix ? `${prefix} · ${k}` : `${prefix} · ${k}`, into, depth + 1); return; }
  if (o !== null && o !== undefined && String(o).length < 120) into[prefix] = String(o);
}

async function checkService(id) {
  const ac = store.audioCfg();
  const out = { at: Date.now(), valid: null, detail: '', models: [], info: {} };
  try {
    if (id === 'freesound') {
      if (!ac.freesoundKey) throw httpErr(400, 'Clé Freesound manquante');
      const r = await get(`${ac.freesoundUrl}/search/text/?query=rain&page_size=1&fields=id&token=${encodeURIComponent(ac.freesoundKey)}`, {});
      out.valid = denied(r) ? false : r.ok; out.detail = out.valid ? 'Clé valide' : `Clé refusée (HTTP ${r.status})`;
      if (r.ok && r.json && r.json.count !== undefined) out.info['Sons indexés'] = String(r.json.count);
    } else if (id === 'jamendo') {
      if (!ac.jamendoClientId) throw httpErr(400, 'Client ID Jamendo manquant');
      const r = await get(`${ac.jamendoUrl}/tracks/?client_id=${encodeURIComponent(ac.jamendoClientId)}&format=json&limit=1`, {});
      const code = r.json && r.json.headers && r.json.headers.code;
      out.valid = denied(r) ? false : r.ok && (code === undefined || code === 0); out.detail = out.valid ? 'Client ID valide' : `Client ID refusé${code ? ' (code ' + code + ')' : ' (HTTP ' + r.status + ')'}`;
    } else throw httpErr(400, 'Service non vérifiable');
  } catch (e) { if (e.status === 400) throw e; out.detail = 'Vérification impossible : ' + ((e.cause && e.cause.message) || e.message); }
  data.checks[id] = out; save();
  return out;
}

function reset() { data.days = {}; data.last = {}; data.events = []; data.accounts = {}; flush(); }

module.exports = { noteHeaders, refreshAccount, record, imagesToday, overview, checkProvider, checkService, reset, flush };
