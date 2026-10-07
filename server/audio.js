'use strict';
// Voix off (TTS) et sons d'ambiance, mixés dans la vidéo avec ffmpeg.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const store = require('./store');
const media = require('./media');
const providers = require('./providers');
const usage = require('./usage');
const { ApiError, retry, clamp } = require('./util');

const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'];
const ENGINES = ['google', 'local', 'cloudflare', 'openai'];
const SYNTH = ['rain', 'wind', 'ocean', 'fire', 'forest', 'city', 'space', 'pad'];
const KINDS = ['none', 'synth', 'freesound', 'jamendo'];
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

/** Normalise la config audio reçue du client. */
function normalize(a) {
  a = a || {};
  const v = a.voice || {}, m = a.ambient || {};
  return {
    voice: { engine: ENGINES.includes(v.engine) ? v.engine : 'google', lang: LANGS.includes(v.lang) ? v.lang : 'fr', speed: clamp(+v.speed || 1, 0.7, 1.4), volume: clamp(v.volume == null ? 1 : +v.volume, 0, 1.5) },
    ambient: { kind: KINDS.includes(m.kind) ? m.kind : 'none', preset: SYNTH.includes(m.preset) ? m.preset : 'rain', query: str(m.query, 80).trim(), volume: clamp(m.volume == null ? 0.3 : +m.volume, 0, 1) },
    duck: a.duck !== false,
  };
}
const hasVoice = (job) => job.scenes.some((s) => s.narration && s.narration.trim());
const hasAmbient = (job) => !!job.audio && ((job.audio.ambient.kind === 'synth') || ((job.audio.ambient.kind === 'freesound' || job.audio.ambient.kind === 'jamendo') && !!job.audio.ambient.query));
const hasAudio = (job) => !!job.audio && (hasVoice(job) || hasAmbient(job));

/* ---------- Synthèse vocale ---------- */
function chunks(text, max = 180) {
  const parts = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…;:,])\s+/);
  const out = [];
  let cur = '';
  const push = (x) => { if (x) out.push(x); };
  for (let p of parts) {
    while (p.length > max) { const cut = p.lastIndexOf(' ', max); push(cur); cur = ''; push(p.slice(0, cut > 40 ? cut : max)); p = p.slice(cut > 40 ? cut + 1 : max); }
    if ((cur + ' ' + p).trim().length > max) { push(cur); cur = p; } else cur = (cur + ' ' + p).trim();
  }
  push(cur);
  return out;
}
async function netFetch(url, opts, signal, service, kind = 'search') {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  const t0 = Date.now();
  let r;
  try { r = await fetch(url, { ...opts, signal: sig }); } catch (e) {
    if (signal && signal.aborted) throw e;
    const msg = 'Réseau : ' + ((e.cause && e.cause.message) || e.message);
    if (service) usage.record({ service, kind, ok: false, msg });
    throw new ApiError(msg, 0);
  }
  if (!r.ok) {
    const text = (await r.text()).slice(0, 160);
    if (service) usage.record({ service, kind, ok: false, status: r.status, msg: text });
    throw new ApiError(`HTTP ${r.status} : ${text}`, r.status);
  }
  if (service) usage.record({ service, kind, ok: true, ms: Date.now() - t0, status: r.status });
  return r;
}
function espeak(text, lang, speed) {
  return new Promise((resolve, reject) => {
    const p = spawn('espeak-ng', ['-v', lang === 'pt' ? 'pt' : lang, '-s', String(Math.round(store.audioCfg().localSpeed * speed)), '--stdout', text]);
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { usage.record({ service: 'espeak', kind: 'tts', ok: false, msg: e.message }); reject(new ApiError(e.code === 'ENOENT' ? 'espeak-ng n\'est pas installé (inclus dans l\'image Docker)' : e.message, 400)); });
    p.on('close', (c) => {
      if (c === 0 && out.length) { usage.record({ service: 'espeak', kind: 'tts', ok: true }); return resolve(Buffer.concat(out)); }
      usage.record({ service: 'espeak', kind: 'tts', ok: false, msg: err.slice(0, 120) });
      reject(new ApiError('espeak-ng : ' + err.slice(0, 120), 400));
    });
  });
}
/** Retourne un Buffer audio (mp3/wav) pour le texte. */
async function tts(voice, text, signal) {
  const cfg = store.audioCfg();
  if (voice.engine === 'local') return espeak(text, voice.lang, voice.speed);
  if (voice.engine === 'google') {
    const bufs = [];
    for (const c of chunks(text)) {
      const r = await netFetch(`${cfg.googleUrl}?ie=UTF-8&client=tw-ob&tl=${voice.lang}&q=${encodeURIComponent(c)}&ttsspeed=1`, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' } }, signal, 'google-tts', 'tts');
      bufs.push(Buffer.from(await r.arrayBuffer()));
    }
    return Buffer.concat(bufs);
  }
  if (voice.engine === 'cloudflare') {
    const p = store.providerCfg('cloudflare');
    const j = providers.asJson(await providers.call('cloudflare', `${p.baseUrl}/run/@cf/myshell-ai/melotts`, { json: { prompt: text, lang: voice.lang } }, signal));
    const b64 = j.result && j.result.audio;
    if (!b64) throw new ApiError('Réponse inattendue : ' + JSON.stringify(j).slice(0, 160));
    return Buffer.from(b64, 'base64');
  }
  // openai : endpoint /audio/speech d'un fournisseur compatible OpenAI
  const pid = store.getSettings().providers[cfg.ttsProvider] ? cfg.ttsProvider : 'pollinations';
  const p = store.providerCfg(pid);
  const r = await providers.call(pid, p.baseUrl + '/audio/speech', { kind: 'tts', json: { model: cfg.ttsModel || 'tts-1', input: text, voice: cfg.ttsVoice || 'nova', response_format: 'mp3', speed: voice.speed } }, signal);
  if (/json/i.test(r.type)) throw new ApiError('Réponse inattendue : ' + r.buf.toString('utf8', 0, 160));
  return r.buf;
}

/* ---------- Ambiances ---------- */
const D = (d) => d.toFixed(2);
const SYNTH_GRAPH = {
  rain: (d) => `anoisesrc=c=pink:a=0.7:d=${D(d)},highpass=f=600,lowpass=f=9500,volume=1.4[a]`,
  wind: (d) => `anoisesrc=c=brown:a=0.9:d=${D(d)},lowpass=f=700,tremolo=f=0.2:d=0.7,volume=2.5[a]`,
  ocean: (d) => `anoisesrc=c=brown:a=0.9:d=${D(d)},lowpass=f=1100,tremolo=f=0.12:d=0.85,volume=2.5[a]`,
  fire: (d) => `anoisesrc=c=pink:a=0.5:d=${D(d)},highpass=f=1200,lowpass=f=7000,tremolo=f=9:d=0.8,volume=1.2[a]`,
  city: (d) => `anoisesrc=c=brown:a=0.8:d=${D(d)},lowpass=f=450,tremolo=f=0.3:d=0.3,volume=2[a]`,
  forest: (d) => `anoisesrc=c=pink:a=0.25:d=${D(d)},lowpass=f=2500[n];sine=f=4300:d=${D(d)},tremolo=f=14:d=1,volume=0.04[c1];sine=f=3900:d=${D(d)},tremolo=f=11:d=1,volume=0.03[c2];[n][c1][c2]amix=inputs=3:normalize=0[a]`,
  space: (d) => `sine=f=55:d=${D(d)}[s1];sine=f=82.4:d=${D(d)}[s2];sine=f=110.3:d=${D(d)}[s3];[s1][s2][s3]amix=inputs=3:normalize=0,tremolo=f=0.1:d=0.4,aecho=0.8:0.7:500:0.4,volume=0.8[a]`,
  pad: (d) => `sine=f=220:d=${D(d)}[s1];sine=f=261.63:d=${D(d)}[s2];sine=f=329.63:d=${D(d)}[s3];sine=f=440:d=${D(d)}[s4];[s1][s2][s3][s4]amix=inputs=4:normalize=0,tremolo=f=0.15:d=0.5,aecho=0.8:0.8:700|1100:0.4|0.3,lowpass=f=1800,volume=0.7[a]`,
};
async function synth(preset, dur, out) {
  await media.ffmpeg(['-y', '-filter_complex', SYNTH_GRAPH[preset](dur) .replace(/\[a\]$/, ',aformat=sample_rates=44100:channel_layouts=stereo[a]'), '-map', '[a]', '-c:a', 'libmp3lame', '-q:a', '5', out]);
}
/** Cherche et télécharge un son (Freesound) ou une musique (Jamendo). */
async function download(kind, query, out, signal) {
  const cfg = store.audioCfg();
  let url;
  if (kind === 'freesound') {
    if (!cfg.freesoundKey) throw new ApiError('Clé Freesound manquante (Réglages › Audio)', 400);
    const j = await (await netFetch(`${cfg.freesoundUrl}/search/text/?query=${encodeURIComponent(query)}&filter=${encodeURIComponent('duration:[8 TO 240]')}&sort=rating_desc&page_size=5&fields=id,name,previews&token=${encodeURIComponent(cfg.freesoundKey)}`, {}, signal, 'freesound')).json();
    const hit = (j.results || []).find((x) => x.previews && (x.previews['preview-hq-mp3'] || x.previews['preview-lq-mp3']));
    if (!hit) throw new ApiError(`Aucun son trouvé sur Freesound pour « ${query} »`, 404);
    url = hit.previews['preview-hq-mp3'] || hit.previews['preview-lq-mp3'];
  } else {
    if (!cfg.jamendoClientId) throw new ApiError('Client ID Jamendo manquant (Réglages › Audio)', 400);
    const j = await (await netFetch(`${cfg.jamendoUrl}/tracks/?client_id=${encodeURIComponent(cfg.jamendoClientId)}&format=json&limit=5&search=${encodeURIComponent(query)}&audioformat=mp32&order=popularity_total`, {}, signal, 'jamendo')).json();
    const hit = (j.results || []).find((x) => x.audio);
    if (!hit) throw new ApiError(`Aucune musique trouvée sur Jamendo pour « ${query} »`, 404);
    url = hit.audio;
  }
  await fsp.writeFile(out, Buffer.from(await (await netFetch(url, {}, signal)).arrayBuffer()));
}
async function ambientFile(dir, amb, dur, signal) {
  await fsp.mkdir(dir, { recursive: true });
  if (amb.kind === 'synth') {
    const f = path.join(dir, `amb_${amb.preset}_${Math.ceil(dur)}.mp3`);
    if (!fs.existsSync(f)) await synth(amb.preset, Math.ceil(dur), f);
    return f;
  }
  const f = path.join(dir, `amb_${amb.kind}_${hash(amb.query)}.mp3`);
  if (!fs.existsSync(f)) await retry(() => download(amb.kind, amb.query, f, signal), signal);
  return f;
}
async function voiceFile(dir, voice, text, signal) {
  await fsp.mkdir(dir, { recursive: true });
  const cfg = store.audioCfg();
  const f = path.join(dir, `v_${hash([voice.engine, voice.lang, voice.speed, text, voice.engine === 'openai' ? [cfg.ttsProvider, cfg.ttsModel, cfg.ttsVoice] : '', voice.engine === 'local' ? cfg.localSpeed : ''])}.mp3`);
  if (!fs.existsSync(f)) {
    const buf = await retry(() => tts(voice, text, signal), signal);
    await fsp.writeFile(f, await media.toMp3(buf));
  }
  return f;
}

/** Prépare les fichiers audio (voix + ambiance) ; idempotent, mis en cache sur disque. */
async function prepare(job, dir, signal) {
  if (!hasAudio(job)) return null;
  const total = job.done.length / job.fps;
  const res = { voices: [], ambient: null };
  if (hasVoice(job)) {
    let t0 = 0;
    for (const s of job.scenes) {
      const dur = s.duration;
      if (s.narration && s.narration.trim()) {
        const file = await voiceFile(dir, job.audio.voice, s.narration.trim(), signal);
        res.voices.push({ file, start: t0, dur, len: await media.duration(file) });
      }
      t0 += dur;
    }
  }
  if (hasAmbient(job)) res.ambient = await ambientFile(dir, job.audio.ambient, total, signal);
  return res;
}

/** Mixe voix + ambiance dans la vidéo muette → outFile. */
async function mix(job, dir, silent, outFile, signal) {
  const prep = await prepare(job, dir, signal);
  if (!prep) throw new Error('pas d\'audio à mixer');
  const T = job.done.length / job.fps;
  const a = job.audio;
  const args = ['-y', '-i', silent];
  const fc = [];
  let n = 0;
  const vlabels = [];
  for (const v of prep.voices) {
    args.push('-i', v.file); n++;
    const tempo = v.len > v.dur ? Math.min(1.6, v.len / v.dur) : 1;
    const ms = Math.round(v.start * 1000);
    fc.push(`[${n}:a]aresample=44100,aformat=channel_layouts=stereo${tempo > 1.01 ? `,atempo=${tempo.toFixed(3)}` : ''},atrim=duration=${D(v.dur)},volume=${a.voice.volume},adelay=${ms}|${ms}[v${n}]`);
    vlabels.push(`[v${n}]`);
  }
  let voice = null;
  if (vlabels.length) { fc.push(vlabels.length === 1 ? `${vlabels[0]}anull[voice]` : `${vlabels.join('')}amix=inputs=${vlabels.length}:normalize=0:duration=longest[voice]`); voice = '[voice]'; }
  let amb = null;
  if (prep.ambient) {
    args.push('-i', prep.ambient); n++;
    fc.push(`[${n}:a]aresample=44100,aformat=channel_layouts=stereo,aloop=loop=-1:size=2000000000,atrim=duration=${D(T)},volume=${a.ambient.volume},afade=t=in:d=1,afade=t=out:st=${D(Math.max(0, T - 2))}:d=2[amb]`);
    amb = '[amb]';
  }
  if (voice && amb) {
    if (a.duck) fc.push(`${voice}asplit=2[vo][vsc];${amb}[vsc]sidechaincompress=threshold=0.04:ratio=9:attack=30:release=500[ad];[vo][ad]amix=inputs=2:normalize=0:duration=longest[mixed]`);
    else fc.push(`${voice}${amb}amix=inputs=2:normalize=0:duration=longest[mixed]`);
  } else fc.push(`${voice || amb}anull[mixed]`);
  fc.push(`[mixed]alimiter=limit=0.95,apad=whole_dur=${D(T)},atrim=duration=${D(T)}[out]`);
  args.push('-filter_complex', fc.join(';'), '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', D(T), '-movflags', '+faststart', outFile);
  await media.ffmpeg(args);
}

/** Aperçu rapide d'une voix. */
async function previewVoice(voiceIn, text) {
  const voice = normalize({ voice: voiceIn }).voice;
  return media.toMp3(await tts(voice, str(text, 400) || 'Bonjour, ceci est un test de la voix.'));
}
async function previewAmbient(ambIn, dir) {
  const amb = normalize({ ambient: ambIn }).ambient;
  if (amb.kind === 'none') throw new ApiError('Aucune ambiance sélectionnée', 400);
  const f = await ambientFile(dir, amb, 8);
  const out = await media.ffmpeg(['-i', f, '-t', '8', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '5', '-f', 'mp3', 'pipe:1']);
  return out;
}

module.exports = { normalize, hasAudio, hasVoice, prepare, mix, previewVoice, previewAmbient, LANGS };
