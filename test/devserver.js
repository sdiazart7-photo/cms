// Servidor local para ver el panel sin Netlify ni GitHub: usa el sitio de
// ejemplo en memoria. Uso: SITE_DIR=/ruta/al/sitio PORT=8888 node test/devserver.js
// Contraseña de prueba: clave-de-prueba

const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = process.env.SITE_DIR || path.join(__dirname, '..', '..', 'finite-estudio-web');
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clave-de-prueba';
process.env.GITHUB_TOKEN = 'token-falso';
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '123';
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'secreto';

const fake = require('./fake-github').install(SITE);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = /^\/\.netlify\/functions\/([a-z-]+)$/.exec(url.pathname);
  if (m) {
    let body = '';
    for await (const c of req) body += c;
    try {
      const out = await require(`../netlify/functions/${m[1]}`).handler({
        httpMethod: req.method, headers: req.headers, body: body || null,
        queryStringParameters: Object.fromEntries(url.searchParams),
      });
      res.writeHead(out.statusCode, out.headers || {});
      res.end(out.body);
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (url.pathname === '/__state') { res.end(JSON.stringify({ commits: fake.commits.map((c) => c.message) })); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(__dirname, '..', 'index.html')));
}).listen(process.env.PORT || 8888, () => console.log(`Panel de prueba en http://localhost:${process.env.PORT || 8888}`));
