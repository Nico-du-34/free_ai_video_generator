'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const dirs = { root: DATA, jobs: path.join(DATA, 'jobs'), assets: path.join(DATA, 'assets') };
Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));

const ID_RE = /^[a-z0-9_]{3,40}$/i;

function readJSON(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
function writeJSON(file, obj, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

const DEFAULT_ENHANCE = 'You are a prompt engineer for an AI image generator that produces the frames of a video. ' +
  'Rewrite the user\'s scene description as ONE vivid, detailed English prompt (subject, setting, lighting, camera angle, art style). ' +
  'Keep the user\'s intent and any named characters. Maximum 80 words. Output only the prompt, no quotes, no explanation.';

const DEFAULTS = {
  defaultProvider: 'agnes',
  maxRefs: 4,
  enhancePrompt: DEFAULT_ENHANCE,
  providers: {
    agnes: {
      label: 'Agnes AI', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: '',
      imageModel: 'agnes-image-2.1-flash', editModel: '', chatModel: 'agnes-2.5-flash',
      rpm: 15, refMode: 'field', refField: 'image', refArray: true,
      keyUrl: 'https://platform.agnes-ai.com',
    },
    pollinations: {
      label: 'Pollinations AI', baseUrl: 'https://gen.pollinations.ai/v1', apiKey: '',
      imageModel: '', editModel: 'kontext', chatModel: 'openai-fast',
      rpm: 10, refMode: 'edits', refField: 'image', refArray: true,
      keyUrl: 'https://enter.pollinations.ai',
    },
  },
};
const ENV_KEYS = { agnes: 'AGNES_API_KEY', pollinations: 'POLLINATIONS_API_KEY' };

let settings = load();
function load() {
  const saved = readJSON(path.join(DATA, 'settings.json'), {});
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of ['defaultProvider', 'maxRefs', 'enhancePrompt']) if (saved[k] !== undefined) s[k] = saved[k];
  for (const id of Object.keys(s.providers)) Object.assign(s.providers[id], (saved.providers || {})[id] || {});
  return s;
}
const getSettings = () => settings;
function providerCfg(id) {
  const p = settings.providers[id];
  if (!p) throw new Error('Fournisseur inconnu : ' + id);
  // la variable d'environnement sert de clé par défaut
  return p.apiKey ? p : { ...p, apiKey: process.env[ENV_KEYS[id]] || '' };
}
function publicSettings() {
  const out = JSON.parse(JSON.stringify(settings));
  for (const id of Object.keys(out.providers)) {
    const k = providerCfg(id).apiKey;
    delete out.providers[id].apiKey;
    out.providers[id].hasKey = !!k;
    out.providers[id].keyHint = k ? '…' + k.slice(-4) : '';
    out.providers[id].keyFromEnv = !settings.providers[id].apiKey && !!k;
  }
  return out;
}
function updateSettings(patch) {
  if (patch.defaultProvider && settings.providers[patch.defaultProvider]) settings.defaultProvider = patch.defaultProvider;
  if (patch.maxRefs !== undefined) settings.maxRefs = Math.min(10, Math.max(1, Math.round(+patch.maxRefs) || 4));
  if (typeof patch.enhancePrompt === 'string' && patch.enhancePrompt.trim()) settings.enhancePrompt = patch.enhancePrompt;
  for (const [id, pp] of Object.entries(patch.providers || {})) {
    const p = settings.providers[id];
    if (!p || !pp) continue;
    for (const k of ['imageModel', 'editModel', 'chatModel', 'refField']) if (typeof pp[k] === 'string') p[k] = pp[k].trim();
    if (typeof pp.baseUrl === 'string') {
      if (!/^https?:\/\/[^\s]+$/i.test(pp.baseUrl.trim())) throw Object.assign(new Error('URL de base invalide'), { status: 400 });
      p.baseUrl = pp.baseUrl.trim().replace(/\/+$/, '');
    }
    if (pp.rpm !== undefined) p.rpm = Math.min(600, Math.max(1, Math.round(+pp.rpm) || 10));
    if (pp.refMode === 'field' || pp.refMode === 'edits') p.refMode = pp.refMode;
    if (typeof pp.refArray === 'boolean') p.refArray = pp.refArray;
    if (typeof pp.apiKey === 'string' && pp.apiKey.trim()) p.apiKey = pp.apiKey.trim();
    if (pp.clearKey) p.apiKey = '';
  }
  writeJSON(path.join(DATA, 'settings.json'), settings, 0o600);
}

const statsFile = path.join(DATA, 'stats.json');
const stats = readJSON(statsFile, { latency: {} });
function noteLatency(provider, ms) {
  const cur = stats.latency[provider];
  stats.latency[provider] = cur ? cur * 0.7 + ms * 0.3 : ms;
  try { writeJSON(statsFile, stats); } catch { /* non bloquant */ }
}

module.exports = { DATA, dirs, ID_RE, readJSON, writeJSON, getSettings, providerCfg, publicSettings, updateSettings, stats, noteLatency };
