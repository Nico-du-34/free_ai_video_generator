// Faux serveur d'API (Agnes/Pollinations) pour tester sans clé : node dev/mock-api.js, puis URL de base http://127.0.0.1:9099/v1 dans Réglages
const http = require('http');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const bx = Math.abs(x - ((seed * 12) % w)) < 20 && Math.abs(y - h / 2) < 20;
      raw[o] = bx ? 255 : (x * 255) / w; raw[o + 1] = bx ? 255 : (y * 255) / h; raw[o + 2] = (seed * 9) % 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const { execFileSync } = require('child_process');
const tone = (f, d) => execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=f=${f}:d=${d}`, '-f', 'mp3', 'pipe:1'], { maxBuffer: 1e7 });
const mp4 = () => execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 1e8 });
const polls = {};
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.setEncoding('latin1'); req.on('data', (d) => (body += d));
  req.on('end', () => {
    const j = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-ratelimit-limit-requests', '100'); res.setHeader('x-ratelimit-remaining-requests', String(Math.max(0, 100 - n))); res.setHeader('x-ratelimit-reset-requests', '20s');
    if (!/translate_tts|\/files\/|\/search\/text\/|\/tracks\//.test(req.url) && !/Bearer .+/.test(req.headers.authorization || '')) { res.statusCode = 401; return res.end('{"error":{"message":"no key"}}'); }
    if (/translate_tts/.test(req.url)) { console.log('tts google', decodeURIComponent(req.url).slice(0, 90)); res.setHeader('content-type', 'audio/mpeg'); return res.end(tone(300, 2)); }
    if (/\/audio\/speech/.test(req.url)) { console.log('tts openai', body.slice(0, 80)); res.setHeader('content-type', 'audio/mpeg'); return res.end(tone(350, 3)); }
    if (/melotts/.test(req.url)) { console.log('tts cloudflare', body.slice(0, 80)); return res.end(JSON.stringify({ result: { audio: tone(400, 2).toString('base64') } })); }
    if (/\/search\/text\//.test(req.url)) { console.log('freesound search', req.url.slice(0, 80)); return res.end(JSON.stringify({ results: [{ id: 1, name: 'x', previews: { 'preview-hq-mp3': 'http://127.0.0.1:9099/files/amb.mp3' } }] })); }
    if (/\/tracks\//.test(req.url)) { console.log('jamendo search', req.url.slice(0, 80)); return res.end(JSON.stringify({ results: [{ audio: 'http://127.0.0.1:9099/files/amb.mp3' }] })); }
    if (/\/files\/amb\.mp3/.test(req.url)) { res.setHeader('content-type', 'audio/mpeg'); return res.end(tone(120, 5)); }
    if (/\/v1\/models$/.test(req.url)) return res.end(JSON.stringify({ data: ['agnes-image-2.1-flash', 'agnes-2.5-flash', 'flux', 'kontext', 'gpt-image-1', 'openai-fast'].map((id) => ({ id })) }));
    if (/\/account\/balance/.test(req.url)) return res.end(JSON.stringify({ balance: 42.5, accountBalance: { total: 120, tier: 'seed', paid: 0 } }));
    if (/\/account\/key\/usage/.test(req.url)) return res.end(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ timestamp: new Date(Date.now() - (i % 3) * 864e5).toISOString(), model: i % 2 ? 'flux' : 'kontext', cost_usd: 0.002 }))));
    if (/\/account\/key$/.test(req.url)) return res.end(JSON.stringify({ valid: true, type: 'secret', name: 'ma-cle', pollenBudget: 50, expiresAt: null, permissions: ['generate', 'account:usage'], rateLimitEnabled: true }));
    if (/\/account\/profile/.test(req.url)) return res.end(JSON.stringify({ githubUsername: 'tester', name: 'Test', email: 'secret@example.com' }));
    if (/\/v1\/credits$/.test(req.url)) return res.end(JSON.stringify({ balance: 7, currency: 'credits' }));
    if (/tokens\/verify/.test(req.url)) return res.end(JSON.stringify({ success: true, result: { status: 'active', expires_on: '2027-01-01T00:00:00Z' } }));
    if (/whoami-v2/.test(req.url)) return res.end(JSON.stringify({ name: 'tester', type: 'user', isPro: false }));
    if (/\/v1\/videos$/.test(req.url)) { const id = 'vid_' + (++n); polls[id] = 0; console.log('video submit', id, body.slice(0, 160)); return res.end(JSON.stringify({ video_id: id, task_id: 't_' + id, status: 'queued' })); }
    if (/\/agnesapi\?video_id=/.test(req.url)) { const id = /video_id=([^&]+)/.exec(req.url)[1]; polls[id] = (polls[id] || 0) + 1; console.log('video poll', id, polls[id]); return res.end(JSON.stringify(polls[id] < 2 ? { status: 'processing', progress: 40 } : { status: 'succeeded', data: { video_url: 'http://127.0.0.1:9099/files/clip.mp4' } })); }
    if (/\/files\/clip\.mp4/.test(req.url)) { res.setHeader('content-type', 'video/mp4'); return res.end(mp4()); }
    if (/^\/video\//.test(req.url)) { console.log('video pollinations', decodeURIComponent(req.url).slice(0, 150)); res.setHeader('content-type', 'video/mp4'); return setTimeout(() => res.end(mp4()), 800); }
    const edits = req.url.endsWith('/images/edits');
    if (req.url.endsWith('/images/generations') || edits) {
      n++;
      const size = edits ? (/name="size"\r\n\r\n([^\r]+)/.exec(body) || [])[1] : j.size || (j.width ? j.width + 'x' + j.height : '');
      const refs = edits ? (body.match(/name="image(\[\])?"/g) || []).length : Array.isArray(j.image) ? j.image.length : j.image ? 1 : 0;
      const prompt = edits ? (/name="prompt"\r\n\r\n([^\r]+)/.exec(body) || [])[1] : j.prompt;
      console.log(edits ? 'edit' : 'image', n, size, 'refs:', refs, '|', (prompt || '').slice(0, 70));
      const [w, h] = (size || '320x180').split('x').map((v) => Math.round(+v / 4));
      return setTimeout(() => res.end(JSON.stringify({ data: [{ b64_json: png(w, h, n).toString('base64') }] })), 300);
    }
    if (req.url.endsWith('/chat/completions')) {
      const sys = (j.messages || [])[0]?.content || '', u = (j.messages || []).slice(-1)[0]?.content || '';
      let out = 'Enhanced: ' + u;
      if (/screenwriter/.test(sys)) { const c = +(/exactly (\d+)/.exec(sys) || [])[1] || 3; out = 'Voici : ' + JSON.stringify(Array.from({ length: c }, (_, i) => ({ title: 'Suite ' + (i + 1), prompt: 'Episode idea ' + (i + 1) + ' based on ' + u.slice(0, 30) }))); }
      else if (/JSON array/.test(sys)) out = JSON.stringify(JSON.parse(u).map((t) => 'Enhanced: ' + t));
      return res.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
    }
    if (/\/run\//.test(req.url) || /\/models\//.test(req.url)) {      // cloudflare / hugging face
      n++; console.log('raw', n, req.url.slice(0, 60), body.slice(0, 80));
      const cf = /\/run\//.test(req.url), png1 = png(64, 36, n);
      res.setHeader('content-type', cf ? 'application/json' : 'image/png');
      return setTimeout(() => res.end(cf ? JSON.stringify({ result: { image: png1.toString('base64') }, success: true }) : png1), 300);
    }
    res.statusCode = 404; res.end('{}');
  });
}).listen(9099, '127.0.0.1', () => console.log('mock API on :9099'));
