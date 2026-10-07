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

async function encodeVideo(seqPattern, fps, outFile, total, onProgress) {
  await ffmpeg([
    '-y', '-framerate', String(fps), '-i', seqPattern,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart',
    '-progress', 'pipe:1', outFile,
  ], { onLine: (l) => { const m = /^frame=(\d+)/.exec(l); if (m && onProgress) onProgress(Math.min(1, +m[1] / total)); } });
}

module.exports = { ffmpeg, toPng, toJpeg, encodeVideo };
