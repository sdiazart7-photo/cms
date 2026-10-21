// GitHub simulado en memoria, para probar sin tocar el repositorio real.
// Carga los archivos del sitio desde una carpeta local y atiende las llamadas
// de la API que usan las funciones (leer, crear árbol, commit, mover rama).

const fs = require('fs');
const path = require('path');

function install(SITE) {
const files = new Map();
(function load(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(full).isDirectory()) load(full, r);
    else if (/\.(html|xml|txt|js|json|md|toml)$|^_redirects$/.test(name)) files.set(r, fs.readFileSync(full, 'utf8'));
  }
})(SITE);

let headN = 0;
let commits = [];
const trees = new Map();
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const res = (status, body, text) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => (text !== undefined ? text : JSON.stringify(body)),
  });
  const p = u.pathname;
  const method = opts.method || 'GET';
  if (p.endsWith('/git/ref/heads/main')) return res(200, { object: { sha: `c${headN}` } });
  let m;
  if ((m = /\/git\/commits\/(c\d+)$/.exec(p)) && method === 'GET') return res(200, { tree: { sha: `t${m[1]}` } });
  if (p.endsWith('/git/trees') && method === 'POST') {
    const id = `tree${trees.size}`;
    trees.set(id, JSON.parse(opts.body).tree);
    return res(201, { sha: id });
  }
  if (p.endsWith('/git/commits') && method === 'POST') {
    const b = JSON.parse(opts.body);
    commits.push({ message: b.message, tree: trees.get(b.tree) });
    return res(201, { sha: `c${headN + 1}`, html_url: `https://github.com/x/y/commit/c${headN + 1}` });
  }
  if (p.endsWith('/git/refs/heads/main') && method === 'PATCH') {
    const last = commits[commits.length - 1];
    for (const e of last.tree) { if (e.sha === null) files.delete(e.path); else files.set(e.path, e.content); }
    headN++;
    return res(200, {});
  }
  if ((m = /\/contents\/(.+)$/.exec(p))) {
    const rel = decodeURIComponent(m[1]);
    return files.has(rel) ? res(200, null, files.get(rel)) : res(404, { message: 'Not Found' }, 'Not Found');
  }
  return res(500, { message: `ruta no simulada ${method} ${p}` });
};


  return { files, get commits() { return commits; } };
}

module.exports = { install };
