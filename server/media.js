'use strict';
// Petites opérations ffmpeg (conversion / redimensionnement / assemblage).
const { spawn } = require('child_process');

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

module.exports = { ffmpeg, toPng, toJpeg, encodeVideo, duration, toMp3 };
