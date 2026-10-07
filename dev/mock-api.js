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
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.setEncoding('latin1'); req.on('data', (d) => (body += d));
  req.on('end', () => {
    const j = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    res.setHeader('content-type', 'application/json');
    if (!/Bearer .+/.test(req.headers.authorization || '')) { res.statusCode = 401; return res.end('{"error":{"message":"no key"}}'); }
    const edits = req.url.endsWith('/images/edits');
    if (req.url.endsWith('/images/generations') || edits) {
      n++;
      const size = edits ? (/name="size"\r\n\r\n([^\r]+)/.exec(body) || [])[1] : j.size;
      const refs = edits ? (body.match(/name="image(\[\])?"/g) || []).length : Array.isArray(j.image) ? j.image.length : j.image ? 1 : 0;
      const prompt = edits ? (/name="prompt"\r\n\r\n([^\r]+)/.exec(body) || [])[1] : j.prompt;
      console.log(edits ? 'edit' : 'image', n, size, 'refs:', refs, '|', (prompt || '').slice(0, 70));
      const [w, h] = (size || '320x180').split('x').map((v) => Math.round(+v / 4));
      return setTimeout(() => res.end(JSON.stringify({ data: [{ b64_json: png(w, h, n).toString('base64') }] })), 300);
    }
    if (req.url.endsWith('/chat/completions')) {
      const u = (j.messages || []).slice(-1)[0]?.content || '';
      return res.end(JSON.stringify({ choices: [{ message: { content: 'Enhanced: ' + u } }] }));
    }
    res.statusCode = 404; res.end('{}');
  });
}).listen(9099, '127.0.0.1', () => console.log('mock API on :9099'));
