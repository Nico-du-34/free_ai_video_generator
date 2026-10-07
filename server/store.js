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
  audio: {
    freesoundKey: '', jamendoClientId: '',
    ttsProvider: 'pollinations', ttsModel: 'tts-1', ttsVoice: 'nova', localSpeed: 160,
    googleUrl: 'https://translate.google.com/translate_tts',
    freesoundUrl: 'https://freesound.org/apiv2', jamendoUrl: 'https://api.jamendo.com/v3.0',
  },
  providers: {
    agnes: {
      label: 'Agnes AI', type: 'openai', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: '',
      imageModel: 'agnes-image-2.1-flash', editModel: '', chatModel: 'agnes-2.5-flash',
      rpm: 15, dailyLimit: 4000, refMode: 'field', refField: 'image', refArray: true, sizeMode: 'size', extraBody: '',
      keyUrl: 'https://platform.agnes-ai.com',
      help: 'Texte → image et références. Clé gratuite à la création du compte.',
    },
    pollinations: {
      label: 'Pollinations AI', type: 'openai', baseUrl: 'https://gen.pollinations.ai/v1', apiKey: '',
      imageModel: '', editModel: 'kontext', chatModel: 'openai-fast',
      rpm: 10, refMode: 'edits', refField: 'image', refArray: true, sizeMode: 'size', extraBody: '',
      keyUrl: 'https://enter.pollinations.ai',
      help: 'Références via /images/edits. Les noms de modèles évoluent : ajuste-les si besoin.',
    },
    together: {
      label: 'Together AI', type: 'openai', baseUrl: 'https://api.together.xyz/v1', apiKey: '',
      imageModel: 'black-forest-labs/FLUX.1-schnell-Free', editModel: '', chatModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
      rpm: 6, refMode: 'none', refField: 'image', refArray: true, sizeMode: 'wh', extraBody: '{"steps":4}',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      help: 'FLUX.1 schnell gratuit (très rapide). Texte → image uniquement : pas de références, images indépendantes.',
    },
    cloudflare: {
      label: 'Cloudflare Workers AI', type: 'cloudflare', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/VOTRE_ACCOUNT_ID/ai', apiKey: '',
      imageModel: '@cf/black-forest-labs/flux-1-schnell', editModel: '', chatModel: '',
      rpm: 20, refMode: 'none', refField: 'image', refArray: true, sizeMode: 'size', extraBody: '{"steps":4}',
      keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      help: 'Remplace VOTRE_ACCOUNT_ID dans l\'URL (Avancé) et crée un token « Workers AI ». Quota gratuit quotidien. Texte → image uniquement.',
    },
    huggingface: {
      label: 'Hugging Face', type: 'hf', baseUrl: 'https://router.huggingface.co/hf-inference', apiKey: '',
      imageModel: 'black-forest-labs/FLUX.1-schnell', editModel: '', chatModel: '',
      rpm: 10, refMode: 'none', refField: 'image', refArray: true, sizeMode: 'wh', extraBody: '',
      keyUrl: 'https://huggingface.co/settings/tokens',
      help: 'Crédits gratuits mensuels. Token avec droit « Inference Providers ». Texte → image uniquement.',
    },
    custom: {
      label: 'Personnalisé (compatible OpenAI)', custom: true, type: 'openai', baseUrl: 'https://api.exemple.com/v1', apiKey: '',
      imageModel: '', editModel: '', chatModel: '',
      rpm: 10, refMode: 'field', refField: 'image', refArray: true, sizeMode: 'size', extraBody: '',
      keyUrl: 'https://github.com/public-apis/public-apis#machine-learning',
      help: 'Tout service exposant /images/generations (et /chat/completions pour l\'enrichissement).',
    },
  },
};
const AUDIO_ENV = { freesoundKey: 'FREESOUND_API_KEY', jamendoClientId: 'JAMENDO_CLIENT_ID' };
const audioCfg = () => { const a = { ...settings.audio }; for (const [k, e] of Object.entries(AUDIO_ENV)) if (!a[k]) a[k] = process.env[e] || ''; return a; };
const ENV_KEYS = { agnes: 'AGNES_API_KEY', pollinations: 'POLLINATIONS_API_KEY', together: 'TOGETHER_API_KEY', cloudflare: 'CLOUDFLARE_API_TOKEN', huggingface: 'HF_TOKEN', custom: 'CUSTOM_API_KEY' };

let settings = load();
function load() {
  const saved = readJSON(path.join(DATA, 'settings.json'), {});
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of ['defaultProvider', 'maxRefs', 'enhancePrompt']) if (saved[k] !== undefined) s[k] = saved[k];
  Object.assign(s.audio, saved.audio || {});
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
  const ac = audioCfg();
  for (const k of Object.keys(AUDIO_ENV)) { out.audio[k + 'Set'] = !!ac[k]; out.audio[k + 'Hint'] = ac[k] ? '…' + ac[k].slice(-4) : ''; delete out.audio[k]; }
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
  if (patch.audio) {
    const a = patch.audio, t = settings.audio;
    for (const k of ['ttsProvider', 'ttsModel', 'ttsVoice']) if (typeof a[k] === 'string') t[k] = a[k].trim();
    for (const k of ['googleUrl', 'freesoundUrl', 'jamendoUrl']) if (typeof a[k] === 'string' && /^https?:\/\/\S+$/i.test(a[k].trim())) t[k] = a[k].trim().replace(/\/+$/, '');
    for (const k of Object.keys(AUDIO_ENV)) { if (typeof a[k] === 'string' && a[k].trim()) t[k] = a[k].trim(); if (a['clear_' + k]) t[k] = ''; }
    if (a.localSpeed !== undefined) t.localSpeed = Math.min(300, Math.max(80, Math.round(+a.localSpeed) || 160));
  }
  for (const [id, pp] of Object.entries(patch.providers || {})) {
    const p = settings.providers[id];
    if (!p || !pp) continue;
    for (const k of ['imageModel', 'editModel', 'chatModel', 'refField']) if (typeof pp[k] === 'string') p[k] = pp[k].trim();
    if (p.custom && typeof pp.label === 'string' && pp.label.trim()) p.label = pp.label.trim().slice(0, 60);
    if (typeof pp.extraBody === 'string') {
      const t = pp.extraBody.trim();
      if (t) { try { const o = JSON.parse(t); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0; } catch { throw Object.assign(new Error('« Paramètres supplémentaires » doit être un objet JSON valide'), { status: 400 }); } }
      p.extraBody = t;
    }
    if (pp.sizeMode === 'size' || pp.sizeMode === 'wh') p.sizeMode = pp.sizeMode;
    if (typeof pp.baseUrl === 'string') {
      if (!/^https?:\/\/[^\s]+$/i.test(pp.baseUrl.trim())) throw Object.assign(new Error('URL de base invalide'), { status: 400 });
      p.baseUrl = pp.baseUrl.trim().replace(/\/+$/, '');
    }
    if (pp.dailyLimit !== undefined) p.dailyLimit = Math.min(1e6, Math.max(0, Math.round(+pp.dailyLimit) || 0));
    if (pp.rpm !== undefined) p.rpm = Math.min(600, Math.max(1, Math.round(+pp.rpm) || 10));
    if (['field', 'edits', 'none'].includes(pp.refMode)) p.refMode = pp.refMode;
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

module.exports = { audioCfg, DATA, dirs, ID_RE, readJSON, writeJSON, getSettings, providerCfg, publicSettings, updateSettings, stats, noteLatency };
