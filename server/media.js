'use strict';
// Petites opérations ffmpeg (conversion / redimensionnement / assemblage).
const { spawn } = require('child_process');
const fs = require('fs');

function ffmpeg(args, { input, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '', buf = '';
    p.stdout.on('data', (d) => {
      if (onLine) { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, k)); buf = buf.slice(k + 1); } } else out.push(d);
    });
    p.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'ffmpeg introuvable (installe-le ou utilise Docker)' : e.message)));
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg : ' + (err.trim().split('\n').pop() || 'code ' + code)))));
    p.stdin.on('error', () => {});
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** Normalise n'importe quelle image en PNG (nécessaire pour l'assemblage). */
async function toPng(buf) {
  if (isPng(buf)) return buf;
  const out = await ffmpeg(['-i', 'pipe:0', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { input: buf });
  if (!out.length) throw new Error('Image reçue illisible');
  return out;
}

/** JPEG dont le grand côté est ≤ max (jamais d'agrandissement). */
async function toJpeg(buf, max) {
  const vf = `scale='if(gt(iw,ih),min(${max},iw),-2)':'if(gt(iw,ih),-2,min(${max},ih))'`;
  const out = await ffmpeg(['-i', 'pipe:0', '-frames:v', '1', '-vf', vf, '-pix_fmt', 'yuvj420p', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { input: buf });
  if (!out.length) throw new Error('Image illisible');
  return out;
}

async function encodeVideo(seqPattern, o, outFile, total, onProgress) {
  const filters = [];
  if (o.interp === 'mci') filters.push(`minterpolate=fps=${o.outFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
  else if (o.interp === 'blend') filters.push(`minterpolate=fps=${o.outFps}:mi_mode=blend`);
  if (o.interp) filters.push(`tpad=stop_mode=clone:stop=${total}`);   // l'interpolation raccourcit la fin : on complète puis on coupe
  for (const f of o.pre || []) if (f) filters.push(f);
  filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2', 'format=yuv420p');
  await ffmpeg([
    '-y', '-framerate', String(o.inFps), '-i', seqPattern,
    '-vf', filters.join(','), ...(o.interp ? ['-frames:v', String(total)] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart',
    '-progress', 'pipe:1', outFile,
  ], { onLine: (l) => { const m = /^frame=(\d+)/.exec(l); if (m && onProgress) onProgress(Math.min(1, +m[1] / total)); } });
}

function duration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'ffprobe introuvable' : e.message)));
    p.on('close', () => { const v = parseFloat(out); v > 0 ? resolve(v) : reject(new Error('audio illisible')); });
  });
}
async function toMp3(buf) {
  const out = await ffmpeg(['-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '4', '-f', 'mp3', 'pipe:1'], { input: buf });
  if (!out.length) throw new Error('Audio illisible');
  return out;
}

/** Dernière image d'un clip (JPEG ≤ 768 px), pour enchaîner le clip suivant. */
async function lastFrame(file) {
  const out = await ffmpeg(['-sseof', '-0.2', '-i', file, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),min(768,iw),-2)':'if(gt(iw,ih),-2,min(768,ih))'", '-pix_fmt', 'yuvj420p', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']);
  if (!out.length) throw new Error('image finale introuvable');
  return out;
}
const X264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart'];
function progressLine(total, cb) { return (l) => { const m = /^frame=(\d+)/.exec(l); if (m && cb) cb(Math.min(1, +m[1] / total)); }; }

/** Concatène des clips vidéo IA : recadrés à W×H, cadence fps, figés sur la dernière image s'ils sont trop courts, coupés à `secs`. */
async function encodeClips(files, secs, W, H, fps, outFile, onProgress, pre = []) {
  const args = ['-y'];
  files.forEach((f) => args.push('-i', f));
  const parts = files.map((f, i) => `[${i}:v]tpad=stop_mode=clone:stop_duration=8,trim=duration=${secs[i].toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1,format=yuv420p[v${i}]`);
  parts.push(`${files.map((f, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[cc]`);
  parts.push(`[cc]${[...pre, 'format=yuv420p'].join(',')}[out]`);
  const total = Math.max(1, Math.round(secs.reduce((a, b) => a + b, 0) * fps));
  await ffmpeg([...args, '-filter_complex', parts.join(';'), '-map', '[out]', ...X264, '-progress', 'pipe:1', outFile], { onLine: progressLine(total, onProgress) });
}

/** Images fixes → vidéo : mouvements de caméra (zoom / panoramique) + fondus enchaînés. */
async function encodeSlides(files, secs, W, H, fps, outFile, onProgress, per = []) {
  const fxlib = require('./fxlib');
  const n = files.length;
  const defT = Math.min(0.6, Math.max(0.1, Math.min(...secs) / 2));
  const FX = ['push', 'pull', 'panr', 'panl', 'tiltup'];
  const tin = (i) => {      // transition d'entrée dans l'image i
    const t = per[i] && per[i].trans;
    const name = t ? (t.name === 'cut' ? 'fade' : t.name) : i % 2 ? 'fade' : 'dissolve';
    return { name, dur: Math.max(0.04, Math.min(t ? t.dur : defT, secs[i - 1] / 2, secs[i] / 2)) };
  };
  const args = ['-y'];
  files.forEach((f) => args.push('-i', f));
  const parts = files.map((f, i) => {
    const N = Math.max(2, Math.round((secs[i] + (i === n - 1 ? 0 : tin(i + 1).dur)) * fps));
    const cam = fxlib.camSlide((per[i] && per[i].cam) || FX[i % FX.length], N) || fxlib.camSlide('push', N);
    const vf = per[i] && per[i].vf ? ',' + per[i].vf : '';
    return `[${i}:v]scale=${2 * W}:${2 * H}:force_original_aspect_ratio=increase,crop=${2 * W}:${2 * H},zoompan=z='${cam.z}':x='${cam.x}':y='${cam.y}':d=${N}:s=${W}x${H}:fps=${fps}${vf},setsar=1,format=yuv420p[s${i}]`;
  });
  let cur = 's0', acc = 0;
  for (let i = 1; i < n; i++) {
    acc += secs[i - 1];
    const t = tin(i);
    parts.push(`[${cur}][s${i}]xfade=transition=${t.name}:duration=${t.dur.toFixed(3)}:offset=${acc.toFixed(3)}[x${i}]`);
    cur = 'x' + i;
  }
  const total = Math.max(1, Math.round(secs.reduce((a, b) => a + b, 0) * fps));
  await ffmpeg([...args, '-filter_complex', parts.join(';'), '-map', `[${cur}]`, ...X264, '-progress', 'pipe:1', outFile], { onLine: progressLine(total, onProgress) });
}

/** Assemble des segments (un par scène) avec une transition par frontière : trans[i] = { name, dur } pour passer du segment i-1 au segment i. */
async function joinSegments(files, trans, fps, outFile, onProgress) {
  if (files.length === 1) { await fs.promises.copyFile(files[0], outFile); return [0]; }
  const durs = await Promise.all(files.map(duration));
  const args = ['-y'];
  files.forEach((f) => args.push('-i', f));
  const parts = [];
  let cur = '0:v', merged = durs[0];
  const starts = [0];
  for (let i = 1; i < files.length; i++) {
    const t = trans[i] || { name: 'fade', dur: 0.04 };
    const d = Math.min(t.dur, merged / 2, durs[i] / 2);
    const label = `x${i}`;
    parts.push(`[${cur}][${i}:v]xfade=transition=${t.name === 'cut' ? 'fade' : t.name}:duration=${d.toFixed(3)}:offset=${(merged - d).toFixed(3)}[${label}]`);
    starts.push(merged - d);
    merged = merged + durs[i] - d;
    cur = label;
  }
  await ffmpeg([...args, '-filter_complex', parts.join(';'), '-map', `[${cur}]`, '-r', String(fps), ...X264, '-progress', 'pipe:1', outFile], { onLine: progressLine(Math.max(1, Math.round(merged * fps)), onProgress) });
  return starts;
}

const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
/** Déforme (zoom + translation, bords miroir) une image PNG et la renvoie en JPEG ≤ 640 px : référence « déjà en mouvement » pour l'image suivante. */
async function warpFrame(buf, { z = 1, dx = 0, dy = 0 }) {
  const src = pngSize(buf), sc = 640 / Math.max(src.w, src.h);
  const w = Math.max(2, Math.round((src.w * Math.min(1, sc)) / 2) * 2), h = Math.max(2, Math.round((src.h * Math.min(1, sc)) / 2) * 2);
  const P = Math.round(0.3 * Math.max(w, h)) & ~1;
  const cw = Math.max(2, Math.round(w / z / 2) * 2), ch = Math.max(2, Math.round(h / z / 2) * 2);
  const clampv = (v, a, b) => Math.min(b, Math.max(a, v));
  const x = clampv(Math.round(P + (w - cw) / 2 + dx), 0, w + 2 * P - cw), y = clampv(Math.round(P + (h - ch) / 2 + dy), 0, h + 2 * P - ch);
  const vf = `scale=${w}:${h},pad=${w + 2 * P}:${h + 2 * P}:${P}:${P},fillborders=left=${P}:right=${P}:top=${P}:bottom=${P}:mode=mirror,crop=${cw}:${ch}:${x}:${y},scale=${w}:${h}:flags=lanczos`;
  const out = await ffmpeg(['-i', 'pipe:0', '-frames:v', '1', '-vf', vf, '-pix_fmt', 'yuvj420p', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { input: buf });
  if (!out.length) throw new Error('déformation impossible');
  return out;
}

module.exports = { warpFrame, joinSegments, lastFrame, encodeClips, encodeSlides, ffmpeg, toPng, toJpeg, encodeVideo, duration, toMp3 };
