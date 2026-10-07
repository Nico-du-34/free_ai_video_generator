// Serveur local sans dépendance : fichiers statiques + proxy vers l'API Agnes (évite les soucis de CORS).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const UPSTREAM = (process.env.UPSTREAM || 'https://apihub.agnes-ai.com/v1').replace(/\/$/, '');
const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

function proxy(req, res, target) {
  const u = new URL(target);
  const lib = u.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: u.host };
  for (const h of ['origin', 'referer', 'accept-encoding', 'cookie']) delete headers[h];
  const up = lib.request(u, { method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Proxy: ' + e.message } }));
  });
  req.pipe(up);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    return proxy(req, res, UPSTREAM + url.pathname.slice(4) + url.search);
  }
  if (url.pathname === '/fetch') {
    const t = url.searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(t) || req.method !== 'GET') { res.writeHead(400); return res.end('bad url'); }
    return proxy(req, res, t);
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Free AI Video Generator → http://localhost:${PORT}`);
  console.log(`Proxy API → ${UPSTREAM}`);
});
